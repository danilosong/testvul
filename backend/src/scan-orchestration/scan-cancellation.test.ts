import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import {
  isCancellationRequested,
  requestScanCancellation,
  runCancellableSecurityTestsAndFinalize,
  runSecurityTestQueueWithCancellation,
} from "./scan-cancellation";
import { markRestoreIncident } from "../mutation/restore-incident";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-scan-cancellation-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("requestScanCancellation / isCancellationRequested (Section 14.7)", () => {
  it("is false until explicitly requested", () => {
    const { db, scanRunId } = freshScanRun();
    expect(isCancellationRequested(db, scanRunId)).toBe(false);
    requestScanCancellation(db, scanRunId, "operator@example.com");
    expect(isCancellationRequested(db, scanRunId)).toBe(true);
  });
});

describe("runSecurityTestQueueWithCancellation (Section 14.7) — concurrency test", () => {
  it("an in-flight test's own work always completes, and no test dispatched after cancellation was requested ever starts", async () => {
    const { db, scanRunId } = freshScanRun();
    const log: string[] = [];

    // Test A represents an in-flight mutation cycle; the cancellation
    // request arrives concurrently while it's still running — modeled
    // here as A itself triggering it partway through its own work, the
    // same race a real external "Cancel" request produces.
    const testA = async () => {
      log.push("A-start");
      requestScanCancellation(db, scanRunId, "operator@example.com");
      await delay(20);
      log.push("A-restore-complete");
    };
    const testB = vi.fn(async () => {
      log.push("B-start");
    });

    const result = await runSecurityTestQueueWithCancellation({ db, scanRunId, tests: [testA, testB] });

    expect(log).toEqual(["A-start", "A-restore-complete"]);
    expect(testB).not.toHaveBeenCalled();
    expect(result).toEqual({ startedCount: 1, skippedDueToCancellation: 1 });
  });

  it("starts every test that was still eligible before cancellation, when cancellation never happens", async () => {
    const { db, scanRunId } = freshScanRun();
    const calls: string[] = [];
    const tests = [
      async () => {
        calls.push("A");
      },
      async () => {
        calls.push("B");
      },
      async () => {
        calls.push("C");
      },
    ];
    const result = await runSecurityTestQueueWithCancellation({ db, scanRunId, tests });
    expect(result).toEqual({ startedCount: 3, skippedDueToCancellation: 0 });
    expect(calls.sort()).toEqual(["A", "B", "C"]);
  });
});

describe("runCancellableSecurityTestsAndFinalize (Section 14.7)", () => {
  it("reports CANCELLED once cancellation was requested and every in-flight restore completed cleanly", async () => {
    const { db, scanRunId } = freshScanRun();
    const tests = [
      async () => {
        requestScanCancellation(db, scanRunId, "operator@example.com");
      },
      vi.fn(async () => {}),
    ];

    const { finalState } = await runCancellableSecurityTestsAndFinalize(db, scanRunId, tests, {
      unrecoverableErrorOccurred: false,
      anyQueueTruncated: false,
    });

    expect(finalState).toBe("CANCELLED");
  });

  it("a failed in-flight restore yields RESTORE_REQUIRED instead of CANCELLED", async () => {
    const { db, scanRunId } = freshScanRun();
    db.prepare(
      `INSERT INTO mutation_journal (scan_run_id, target_id, origin, object_type, resource_id, initiator, state)
       VALUES (?, 1, 'https://example.com', 'project', '1', 'API', 'RESTORE_FAILED')`,
    ).run(scanRunId);

    const tests = [
      async () => {
        markRestoreIncident(db, scanRunId);
        requestScanCancellation(db, scanRunId, "operator@example.com");
      },
    ];

    const { finalState } = await runCancellableSecurityTestsAndFinalize(db, scanRunId, tests, {
      unrecoverableErrorOccurred: false,
      anyQueueTruncated: false,
    });

    expect(finalState).toBe("RESTORE_REQUIRED");
    expect(finalState).not.toBe("CANCELLED");
  });
});
