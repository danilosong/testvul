import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { recordJournalState, getLatestJournalEntry, isResourceFrozen } from "./mutation-journal-repository";
import type { ResourceKey } from "./resource-key";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-journal-"));
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

describe("mutation journal", () => {
  it("is not frozen before any journal entry exists", () => {
    const { db } = freshScanRun();
    expect(isResourceFrozen(db, RESOURCE)).toBe(false);
    expect(getLatestJournalEntry(db, RESOURCE)).toBeNull();
  });

  it("is not frozen after a RESTORE_OK outcome", () => {
    const { db, scanRunId } = freshScanRun();
    recordJournalState(db, scanRunId, RESOURCE, "API", "RESTORE_OK");
    expect(isResourceFrozen(db, RESOURCE)).toBe(false);
  });

  it("is frozen after a RESTORE_FAILED outcome", () => {
    const { db, scanRunId } = freshScanRun();
    recordJournalState(db, scanRunId, RESOURCE, "API", "RESTORE_FAILED");
    expect(isResourceFrozen(db, RESOURCE)).toBe(true);
  });

  it("is frozen after a RESTORE_CONFLICT outcome", () => {
    const { db, scanRunId } = freshScanRun();
    recordJournalState(db, scanRunId, RESOURCE, "BROWSER", "RESTORE_CONFLICT");
    expect(isResourceFrozen(db, RESOURCE)).toBe(true);
  });

  it("uses only the most recent entry to decide frozen status", () => {
    const { db, scanRunId } = freshScanRun();
    recordJournalState(db, scanRunId, RESOURCE, "API", "RESTORE_FAILED");
    // a later, successful cycle should not remain frozen forever by itself
    // (Section 9.9's Recovery Manager is what actually clears a freeze;
    // this only proves the "latest wins" read logic)
    recordJournalState(db, scanRunId, RESOURCE, "API", "RESTORE_OK");
    expect(isResourceFrozen(db, RESOURCE)).toBe(false);
  });

  it("tracks frozen status independently per ResourceKey", () => {
    const { db, scanRunId } = freshScanRun();
    const other: ResourceKey = { ...RESOURCE, resourceId: "456" };
    recordJournalState(db, scanRunId, RESOURCE, "API", "RESTORE_FAILED");
    expect(isResourceFrozen(db, RESOURCE)).toBe(true);
    expect(isResourceFrozen(db, other)).toBe(false);
  });
});
