import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { declareResourceOwnership, getResourceOwner } from "../ownership/resource-ownership-repository";
import { getLatestJournalEntry, recordJournalState } from "./mutation-journal-repository";
import type { ResourceKey } from "./resource-key";
import { tryAcquireLock } from "./resource-lock-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let directory: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

function freshDb(): Db {
  directory = mkdtempSync(join(tmpdir(), "sca-resource-key-isolation-"));
  db = openDb(join(directory, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('A', 'a.example', '[]'), ('B', 'b.example', '[]')").run();
  db.prepare("INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'DEVELOPMENT'), (2, '[]', 'PASSIVE', 2, 'DEVELOPMENT')").run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1), (2, 2)").run();
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('Owner A', 'BEARER'), ('Owner B', 'BEARER')").run();
  return db;
}

describe("Canonical ResourceKey isolation", () => {
  it("never shares locks, journal entries, or ownership between Targets that both contain Resource ID 123", () => {
    const db = freshDb();
    const targetA: ResourceKey = { targetId: 1, origin: "https://shared.example", objectType: "project", resourceId: "123" };
    const targetB: ResourceKey = { targetId: 2, origin: "https://shared.example", objectType: "project", resourceId: "123" };

    expect(tryAcquireLock(db, targetA, "worker-a", 60_000)).not.toBeNull();
    expect(tryAcquireLock(db, targetB, "worker-b", 60_000)).not.toBeNull();

    recordJournalState(db, 1, targetA, "API", "MUTATION_APPLIED");
    recordJournalState(db, 2, targetB, "BROWSER", "RESTORE_OK");
    expect(getLatestJournalEntry(db, targetA)?.state).toBe("MUTATION_APPLIED");
    expect(getLatestJournalEntry(db, targetB)?.state).toBe("RESTORE_OK");

    declareResourceOwnership(db, { resourceKey: targetA, ownerAuthProfileId: 1 });
    declareResourceOwnership(db, { resourceKey: targetB, ownerAuthProfileId: 2 });
    expect(getResourceOwner(db, targetA)).toBe(1);
    expect(getResourceOwner(db, targetB)).toBe(2);
  });
});
