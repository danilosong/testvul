import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { tryAcquireLock, releaseLock } from "./resource-lock-repository";
import { withResourceLock } from "./with-resource-lock";
import { recordJournalState } from "./mutation-journal-repository";
import { LockAcquisitionTimeoutError } from "./resource-lock";
import type { ResourceKey } from "./resource-key";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-lock-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

const RESOURCE: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "123" };

describe("tryAcquireLock / releaseLock", () => {
  it("grants a lock when none exists", () => {
    const { db } = freshScanRun();
    const lock = tryAcquireLock(db, RESOURCE, "API:XSS_SCANNER", 30_000);
    expect(lock).not.toBeNull();
    expect(lock?.holder).toBe("API:XSS_SCANNER");
  });

  it("refuses a second acquisition while the first lock's lease is still valid", () => {
    const { db } = freshScanRun();
    tryAcquireLock(db, RESOURCE, "API:XSS_SCANNER", 30_000);
    const second = tryAcquireLock(db, RESOURCE, "API:GTM_SCANNER", 30_000);
    expect(second).toBeNull();
  });

  it("allows re-acquisition once the lock is released", () => {
    const { db } = freshScanRun();
    const first = tryAcquireLock(db, RESOURCE, "API:XSS_SCANNER", 30_000)!;
    releaseLock(db, first.id);
    const second = tryAcquireLock(db, RESOURCE, "API:GTM_SCANNER", 30_000);
    expect(second).not.toBeNull();
  });

  it("allows re-acquisition once an expired lease has passed, when the journal shows no unresolved state", async () => {
    const { db } = freshScanRun();
    tryAcquireLock(db, RESOURCE, "API:XSS_SCANNER", 5); // 5ms lease
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = tryAcquireLock(db, RESOURCE, "API:GTM_SCANNER", 30_000);
    expect(second).not.toBeNull();
    expect(second?.holder).toBe("API:GTM_SCANNER");
  });

  it("refuses a new lock while the journal shows MUTATION_PENDING, even with no existing lock row at all", () => {
    const { db, scanRunId } = freshScanRun();
    recordJournalState(db, scanRunId, RESOURCE, "API", "MUTATION_PENDING");
    expect(tryAcquireLock(db, RESOURCE, "API:GTM_SCANNER", 30_000)).toBeNull();
  });

  it("an expired lease on a resource still in MUTATION_APPLIED does not allow a new lock to be granted, per the spec's own test requirement", async () => {
    const { db, scanRunId } = freshScanRun();
    tryAcquireLock(db, RESOURCE, "API:XSS_SCANNER", 5); // 5ms lease — will expire
    recordJournalState(db, scanRunId, RESOURCE, "API", "MUTATION_APPLIED"); // then the process "crashes" mid-cycle
    await new Promise((resolve) => setTimeout(resolve, 20)); // lease now expired

    const second = tryAcquireLock(db, RESOURCE, "BROWSER", 30_000);
    expect(second).toBeNull(); // lease expiry does not override the unresolved journal state
  });

  it("refuses a new lock for RESTORE_FAILED/RESTORE_CONFLICT states too, regardless of lease expiry", async () => {
    const { db, scanRunId } = freshScanRun();
    tryAcquireLock(db, RESOURCE, "API:XSS_SCANNER", 5);
    recordJournalState(db, scanRunId, RESOURCE, "API", "RESTORE_CONFLICT");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(tryAcquireLock(db, RESOURCE, "BROWSER", 30_000)).toBeNull();
  });

  it("tracks locks independently per ResourceKey", () => {
    const { db } = freshScanRun();
    const other: ResourceKey = { ...RESOURCE, resourceId: "456" };
    tryAcquireLock(db, RESOURCE, "API:XSS_SCANNER", 30_000);
    expect(tryAcquireLock(db, other, "API:GTM_SCANNER", 30_000)).not.toBeNull();
  });
});

describe("withResourceLock", () => {
  it("serializes two independent mutating clients contending for the same resource, per the spec's own test requirement", async () => {
    const { db } = freshScanRun();
    const events: string[] = [];

    async function mutatingClient(name: string, holdMs: number): Promise<void> {
      await withResourceLock(db, RESOURCE, name, async () => {
        events.push(`${name}:start`);
        await new Promise((resolve) => setTimeout(resolve, holdMs));
        events.push(`${name}:end`);
      });
    }

    await Promise.all([mutatingClient("clientA", 40), mutatingClient("clientB", 10)]);

    // Never interleaved: whichever client starts first must fully finish
    // (both its start AND end) before the other one's start appears.
    const firstStarter = events[0]!.split(":")[0];
    const firstEndIndex = events.indexOf(`${firstStarter}:end`);
    const secondStartIndex = events.indexOf(`${firstStarter === "clientA" ? "clientB" : "clientA"}:start`);
    expect(secondStartIndex).toBeGreaterThan(firstEndIndex);
  });

  it("releases the lock even when the guarded function throws", async () => {
    const { db } = freshScanRun();
    await expect(
      withResourceLock(db, RESOURCE, "API:XSS_SCANNER", async () => {
        throw new Error("mutation failed");
      }),
    ).rejects.toThrow("mutation failed");

    // If the lock wasn't released, this would time out instead of succeeding.
    await expect(withResourceLock(db, RESOURCE, "API:GTM_SCANNER", async () => "ok", { maxWaitMs: 200 })).resolves.toBe("ok");
  });

  it("times out rather than waiting forever when the lock never becomes available", async () => {
    const { db, scanRunId } = freshScanRun();
    recordJournalState(db, scanRunId, RESOURCE, "API", "MUTATION_PENDING"); // permanently unresolved for this test
    await expect(
      withResourceLock(db, RESOURCE, "BROWSER", async () => "unreachable", { maxWaitMs: 60, pollIntervalMs: 10 }),
    ).rejects.toThrow(LockAcquisitionTimeoutError);
  });
});
