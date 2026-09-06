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
import { tryAcquireLock } from "../mutation/resource-lock-repository";
import { withResourceLock } from "../mutation/with-resource-lock";
import { LockAcquisitionTimeoutError } from "../mutation/resource-lock";
import { listAuditEvents } from "../mutation/audit-events-repository";
import { runRecoveryManager } from "./recovery-manager";
import type { ResourceKey } from "../mutation/resource-key";
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
let scanRunId: number;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): void {
  dir = mkdtempSync(join(tmpdir(), "sca-recovery-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  scanRunId = 1;
}

const ETAG_URL = () => `http://127.0.0.1:${ports.httpPort}/api/resources/etag/etag-1`;
const RESOURCE: ResourceKey = { targetId: 1, origin: "https://127.0.0.1", objectType: "etag-resource", resourceId: "etag-1" };

describe("crash-and-restart recovery against the fixture app, per the spec's own test requirement", () => {
  it("survives a simulated crash between MUTATION_APPLIED and RESTORE_PENDING, blocks new mutations, and completes recovery (or flags manual intervention)", async () => {
    freshScanRun();

    // --- Simulate a normal cycle up through MUTATION_APPLIED, then "crash" ---
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
    // The process "crashes" right here — RESTORE_PENDING is never recorded,
    // restoreResource() is never called.

    // --- "Restart": the journal entry survives ---
    const survivedEntry = getLatestJournalEntry(db, RESOURCE);
    expect(survivedEntry?.state).toBe("MUTATION_APPLIED");

    // --- New mutations are blocked before anything else touches the resource ---
    expect(tryAcquireLock(db, RESOURCE, "BROWSER", 30_000)).toBeNull();
    await expect(
      withResourceLock(db, RESOURCE, "BUSINESS_LOGIC:plan-1", async () => "unreachable", { maxWaitMs: 60, pollIntervalMs: 10 }),
    ).rejects.toThrow(LockAcquisitionTimeoutError);

    // --- Recovery Manager runs and either completes or flags manual intervention ---
    const results = await runRecoveryManager(db, scanRunId, () => ETAG_URL(), client);

    expect(results).toHaveLength(1);
    expect(["RECOVERED", "REQUIRES_MANUAL_INTERVENTION"]).toContain(results[0]!.outcome);
    // The resource was left mutated (never restored) — recovery cannot
    // safely verify it, so it must be the manual-intervention outcome here.
    expect(results[0]!.outcome).toBe("REQUIRES_MANUAL_INTERVENTION");

    const finalEntry = getLatestJournalEntry(db, RESOURCE);
    expect(finalEntry?.state).toBe("RESTORE_CONFLICT");
    expect(finalEntry?.requiresManualIntervention).toBe(true);

    const auditEvents = listAuditEvents(db, scanRunId);
    expect(auditEvents.some((e) => e.eventType === "RECOVERY_REQUIRES_MANUAL_INTERVENTION")).toBe(true);

    // The resource remains blocked for new mutations even after recovery ran.
    expect(tryAcquireLock(db, RESOURCE, "API:GTM_SCANNER", 30_000)).toBeNull();
  });

  it("declares recovery complete when the resource is already back to its backed-up state", async () => {
    freshScanRun();

    const before = await client.request(ETAG_URL());
    captureBackup(db, scanRunId, RESOURCE, before.body);
    recordJournalState(db, scanRunId, RESOURCE, "API", "MUTATION_APPLIED", { fieldPath: "value" });
    // No actual mutation happened this time — the resource is unchanged,
    // as if the restore had actually already completed before the crash.

    const results = await runRecoveryManager(db, scanRunId, () => ETAG_URL(), client);

    expect(results[0]!.outcome).toBe("RECOVERED");
    expect(getLatestJournalEntry(db, RESOURCE)?.state).toBe("RESTORE_OK");
  });
});
