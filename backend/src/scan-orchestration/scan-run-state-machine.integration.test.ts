import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { captureBackup } from "../backup/backup-engine";
import { recordJournalState, getLatestJournalEntry } from "../mutation/mutation-journal-repository";
import { listAuditEvents } from "../mutation/audit-events-repository";
import { runRecoveryManager } from "../restore/recovery-manager";
import type { ResourceKey } from "../mutation/resource-key";
import { finalizeScanRun } from "./scan-run-state-machine";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let client: SecurityHttpClient;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  client = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
});

afterAll(async () => {
  await servers.stop();
});

let dir: string;
let db: Db;
const scanRunId = 1;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): void {
  dir = mkdtempSync(join(tmpdir(), "sca-scan-run-state-machine-integration-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
}

const ETAG_URL = () => `http://127.0.0.1:${ports.httpPort}/api/resources/etag/etag-1`;
const RESOURCE: ResourceKey = { targetId: 1, origin: "https://127.0.0.1", objectType: "etag-resource", resourceId: "etag-1" };

describe("Section 14.6 — the Scan Run State Machine against a real crash-and-recovery scenario (1.6/9.9)", () => {
  it("reaches RESTORE_REQUIRED while a resource's restore incident is unresolved, then COMPLETED_WITH_RECOVERY — never plain COMPLETED — once it's resolved, with the incident's history remaining queryable throughout", async () => {
    freshScanRun();

    // --- A real crash mid-mutation, exactly as Section 9.9 already proves ---
    const before = await client.request(ETAG_URL());
    captureBackup(db, scanRunId, RESOURCE, before.body);
    recordJournalState(db, scanRunId, RESOURCE, "API", "BACKUP_CREATED", { fieldPath: "value" });
    recordJournalState(db, scanRunId, RESOURCE, "API", "MUTATION_PENDING", { fieldPath: "value" });
    await client.request(ETAG_URL(), {
      method: "PATCH",
      headers: { "If-Match": before.headers.etag as string, "Content-Type": "application/json" },
      body: JSON.stringify({ value: "mutated-before-crash" }),
    });
    recordJournalState(db, scanRunId, RESOURCE, "API", "MUTATION_APPLIED", { fieldPath: "value" });
    // The process crashes here.

    // --- Recovery Manager runs: cannot safely verify, flags manual intervention ---
    const results = await runRecoveryManager(db, scanRunId, () => ETAG_URL(), client);
    expect(results[0]!.outcome).toBe("REQUIRES_MANUAL_INTERVENTION");
    expect(getLatestJournalEntry(db, RESOURCE)?.state).toBe("RESTORE_CONFLICT");

    const stateWhileUnresolved = finalizeScanRun(db, scanRunId, {
      cancellationRequestedAndCleanlyCompleted: false,
      unrecoverableErrorOccurred: false,
      anyQueueTruncated: false,
    });
    expect(stateWhileUnresolved).toBe("RESTORE_REQUIRED");

    // --- An operator manually restores the resource, and the tool records the resolution ---
    const currentEtagResponse = await client.request(ETAG_URL());
    await client.request(ETAG_URL(), {
      method: "PATCH",
      headers: { "If-Match": currentEtagResponse.headers.etag as string, "Content-Type": "application/json" },
      body: before.body,
    });
    recordJournalState(db, scanRunId, RESOURCE, "API", "RESTORE_OK");

    const stateAfterResolution = finalizeScanRun(db, scanRunId, {
      cancellationRequestedAndCleanlyCompleted: false,
      unrecoverableErrorOccurred: false,
      anyQueueTruncated: false,
    });
    expect(stateAfterResolution).toBe("COMPLETED_WITH_RECOVERY");
    expect(stateAfterResolution).not.toBe("COMPLETED");

    const finalRow = db.prepare("SELECT state FROM scan_runs WHERE id = ?").get(scanRunId) as { state: string };
    expect(finalRow.state).toBe("COMPLETED_WITH_RECOVERY");

    // --- The incident's full history remains queryable — nothing was ever deleted or overwritten ---
    const journalHistory = db
      .prepare("SELECT state FROM mutation_journal WHERE scan_run_id = ? AND resource_id = 'etag-1' ORDER BY id")
      .all(scanRunId) as { state: string }[];
    expect(journalHistory.map((h) => h.state)).toEqual([
      "BACKUP_CREATED",
      "MUTATION_PENDING",
      "MUTATION_APPLIED",
      "RESTORE_CONFLICT",
      "RESTORE_OK",
    ]);

    const auditEvents = listAuditEvents(db, scanRunId);
    expect(auditEvents.some((e) => e.eventType === "RECOVERY_REQUIRES_MANUAL_INTERVENTION")).toBe(true);
  });
});
