import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { computeScanRunState, finalizeScanRun, hasUnresolvedRestoreIncident, markRestoreIncident } from "./scan-run-state-machine";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-scan-run-state-machine-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

function insertJournalRow(db: Db, scanRunId: number, resourceId: string, state: string): void {
  db.prepare(
    `INSERT INTO mutation_journal (scan_run_id, target_id, origin, object_type, resource_id, initiator, state)
     VALUES (?, 1, 'https://example.com', 'project', ?, 'API', ?)`,
  ).run(scanRunId, resourceId, state);
}

describe("computeScanRunState (Section 14.6, design.md Decision 16 precedence)", () => {
  const BASE = {
    hasUnresolvedRestoreIncident: false,
    hadRestoreIncident: false,
    cancellationRequestedAndCleanlyCompleted: false,
    unrecoverableErrorOccurred: false,
    anyQueueTruncated: false,
  };

  it("RESTORE_REQUIRED overrides every other condition", () => {
    expect(
      computeScanRunState({
        ...BASE,
        hasUnresolvedRestoreIncident: true,
        hadRestoreIncident: true,
        cancellationRequestedAndCleanlyCompleted: true,
        unrecoverableErrorOccurred: true,
        anyQueueTruncated: true,
      }),
    ).toBe("RESTORE_REQUIRED");
  });

  it("COMPLETED_WITH_RECOVERY when the incident is resolved (no longer unresolved) but had_restore_incident stays set", () => {
    expect(computeScanRunState({ ...BASE, hadRestoreIncident: true })).toBe("COMPLETED_WITH_RECOVERY");
  });

  it("CANCELLED when cancellation was requested and completed cleanly", () => {
    expect(computeScanRunState({ ...BASE, cancellationRequestedAndCleanlyCompleted: true })).toBe("CANCELLED");
  });

  it("FAILED on an unrecoverable error", () => {
    expect(computeScanRunState({ ...BASE, unrecoverableErrorOccurred: true })).toBe("FAILED");
  });

  it("PARTIAL when a queue was truncated", () => {
    expect(computeScanRunState({ ...BASE, anyQueueTruncated: true })).toBe("PARTIAL");
  });

  it("COMPLETED when nothing else applies", () => {
    expect(computeScanRunState(BASE)).toBe("COMPLETED");
  });
});

describe("hasUnresolvedRestoreIncident (Section 14.6)", () => {
  it("is false when no journal entry ever left a resource in RESTORE_FAILED/RESTORE_CONFLICT", () => {
    const { db, scanRunId } = freshScanRun();
    insertJournalRow(db, scanRunId, "1", "RESTORE_OK");
    expect(hasUnresolvedRestoreIncident(db, scanRunId)).toBe(false);
  });

  it("is true while a resource's most recent journal entry is still RESTORE_FAILED", () => {
    const { db, scanRunId } = freshScanRun();
    insertJournalRow(db, scanRunId, "1", "BACKUP_CREATED");
    insertJournalRow(db, scanRunId, "1", "RESTORE_FAILED");
    expect(hasUnresolvedRestoreIncident(db, scanRunId)).toBe(true);
  });

  it("becomes false again once the resource's most recent entry moves on to RESTORE_OK", () => {
    const { db, scanRunId } = freshScanRun();
    insertJournalRow(db, scanRunId, "1", "RESTORE_FAILED");
    insertJournalRow(db, scanRunId, "1", "RESTORE_OK"); // e.g. the Recovery Manager resolved it
    expect(hasUnresolvedRestoreIncident(db, scanRunId)).toBe(false);
  });

  it("scopes strictly by scan run — another scan's unresolved incident never leaks in", () => {
    const { db, scanRunId } = freshScanRun();
    db.prepare(
      "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
    ).run();
    db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 2)").run();
    insertJournalRow(db, 2, "1", "RESTORE_FAILED");
    expect(hasUnresolvedRestoreIncident(db, scanRunId)).toBe(false);
  });
});

describe("finalizeScanRun / markRestoreIncident (Section 14.6)", () => {
  it("persists RESTORE_REQUIRED and sets finished_at while an incident is unresolved", () => {
    const { db, scanRunId } = freshScanRun();
    markRestoreIncident(db, scanRunId);
    insertJournalRow(db, scanRunId, "1", "RESTORE_FAILED");

    const state = finalizeScanRun(db, scanRunId, {
      cancellationRequestedAndCleanlyCompleted: false,
      unrecoverableErrorOccurred: false,
      anyQueueTruncated: false,
    });

    expect(state).toBe("RESTORE_REQUIRED");
    const row = db.prepare("SELECT state, finished_at FROM scan_runs WHERE id = ?").get(scanRunId) as { state: string; finished_at: string | null };
    expect(row.state).toBe("RESTORE_REQUIRED");
    expect(row.finished_at).not.toBeNull();
  });

  it("reaches COMPLETED_WITH_RECOVERY — never plain COMPLETED — once the incident resolves, and its history stays queryable", () => {
    const { db, scanRunId } = freshScanRun();
    markRestoreIncident(db, scanRunId);
    insertJournalRow(db, scanRunId, "1", "RESTORE_FAILED"); // the original incident
    insertJournalRow(db, scanRunId, "1", "RESTORE_OK"); // the Recovery Manager later resolves it

    const state = finalizeScanRun(db, scanRunId, {
      cancellationRequestedAndCleanlyCompleted: false,
      unrecoverableErrorOccurred: false,
      anyQueueTruncated: false,
    });

    expect(state).toBe("COMPLETED_WITH_RECOVERY");
    expect(state).not.toBe("COMPLETED");

    // The incident's history remains fully queryable — nothing was deleted or overwritten.
    const history = db
      .prepare("SELECT state FROM mutation_journal WHERE scan_run_id = ? AND resource_id = '1' ORDER BY id")
      .all(scanRunId) as { state: string }[];
    expect(history.map((h) => h.state)).toEqual(["RESTORE_FAILED", "RESTORE_OK"]);
  });
});
