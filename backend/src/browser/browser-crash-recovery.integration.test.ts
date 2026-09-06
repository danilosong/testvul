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
import { runRecoveryManager } from "../restore/recovery-manager";
import type { ResourceKey } from "../mutation/resource-key";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let httpClient: SecurityHttpClient;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  httpClient = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
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
  dir = mkdtempSync(join(tmpdir(), "sca-browser-crash-recovery-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  scanRunId = 1;
}

const RESOURCE_URL = () => `http://127.0.0.1:${ports.httpPort}/api/resources/etag/etag-1`;
const RESOURCE: ResourceKey = { targetId: 1, origin: "https://127.0.0.1", objectType: "etag-resource", resourceId: "etag-1" };

describe("A Browser Worker crash mid-mutation is governed by the exact same Recovery Journal/Manager as an API-driven crash (Section 12.27)", () => {
  it("simulates a crash immediately after MUTATION_APPLIED from a BROWSER-initiated mutation — the resource is never treated as safe", async () => {
    freshScanRun();
    const requester = httpClient; // the same SecurityHttpClient-shaped requester a browser-driven mutation cycle uses

    // --- A Browser Worker's mutation cycle, up through MUTATION_APPLIED, then "crashes" ---
    const before = await requester.request(RESOURCE_URL());
    captureBackup(db, scanRunId, RESOURCE, before.body);
    recordJournalState(db, scanRunId, RESOURCE, "BROWSER", "BACKUP_CREATED", { fieldPath: "value" });

    recordJournalState(db, scanRunId, RESOURCE, "BROWSER", "MUTATION_PENDING", { fieldPath: "value" });
    await requester.request(RESOURCE_URL(), {
      method: "PATCH",
      headers: { "If-Match": before.headers.etag as string, "Content-Type": "application/json" },
      body: JSON.stringify({ value: "mutated-by-browser-before-crash" }),
    });
    recordJournalState(db, scanRunId, RESOURCE, "BROWSER", "MUTATION_APPLIED", { fieldPath: "value" });
    // The Browser Worker process "crashes" right here — RESTORE_PENDING is
    // never recorded, restoreResource() is never called — indistinguishable,
    // from the journal's point of view, from an API-driven crash.

    // --- "Restart": the journal entry survives, tagged with its real initiator ---
    const survivedEntry = getLatestJournalEntry(db, RESOURCE);
    expect(survivedEntry?.state).toBe("MUTATION_APPLIED");
    expect(survivedEntry?.initiator).toBe("BROWSER");

    // --- The resource is never treated as safe: new mutations are blocked, from any subsystem ---
    expect(tryAcquireLock(db, RESOURCE, "API:XSS_SCANNER", 30_000)).toBeNull();
    await expect(
      withResourceLock(db, RESOURCE, "BROWSER:save-settings-btn", async () => "unreachable", { maxWaitMs: 60, pollIntervalMs: 10 }),
    ).rejects.toThrow(LockAcquisitionTimeoutError);

    // --- The exact same Recovery Manager (Section 9.9) governs it — no separate browser-specific recovery path ---
    const results = await runRecoveryManager(db, scanRunId, () => RESOURCE_URL(), requester);

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe("REQUIRES_MANUAL_INTERVENTION");

    const finalEntry = getLatestJournalEntry(db, RESOURCE);
    expect(finalEntry?.state).toBe("RESTORE_CONFLICT");
    expect(finalEntry?.requiresManualIntervention).toBe(true);

    const auditEvents = listAuditEvents(db, scanRunId);
    expect(auditEvents.some((e) => e.eventType === "RECOVERY_REQUIRES_MANUAL_INTERVENTION")).toBe(true);

    // Still blocked for new mutations even after recovery ran.
    expect(tryAcquireLock(db, RESOURCE, "API:GTM_SCANNER", 30_000)).toBeNull();
  }, 30_000);
});
