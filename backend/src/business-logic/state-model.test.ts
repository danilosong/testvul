import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { inferStatesFromObservedValues, listObservedStates, recordManualState } from "./state-model";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-state-model-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("Business State Modeling — states observed for a Ticket's status field are modeled without assuming a fixed universal naming scheme", () => {
  it("infers and dedups every distinct observed state value", () => {
    const { db, scanRunId } = freshScanRun();
    const distinct = inferStatesFromObservedValues(db, scanRunId, "Ticket", ["RESERVED", "PAID", "CANCELLED", "PAID", "RESERVED"]);

    expect(distinct.sort()).toEqual(["CANCELLED", "PAID", "RESERVED"]);
    expect(listObservedStates(db, scanRunId, "Ticket").sort()).toEqual(["CANCELLED", "PAID", "RESERVED"]);
  });

  it("models a completely different object type's states with no code change or hardcoded expectation — proving no fixed universal naming scheme", () => {
    const { db, scanRunId } = freshScanRun();
    inferStatesFromObservedValues(db, scanRunId, "Ticket", ["RESERVED", "PAID"]);
    inferStatesFromObservedValues(db, scanRunId, "SupportRequest", ["OPEN", "IN_PROGRESS", "CLOSED"]);

    expect(listObservedStates(db, scanRunId, "Ticket").sort()).toEqual(["PAID", "RESERVED"]);
    expect(listObservedStates(db, scanRunId, "SupportRequest").sort()).toEqual(["CLOSED", "IN_PROGRESS", "OPEN"]);
  });

  it("supports an operator manually declaring a state value never actually observed this scan", () => {
    const { db, scanRunId } = freshScanRun();
    inferStatesFromObservedValues(db, scanRunId, "Ticket", ["RESERVED", "PAID"]);
    recordManualState(db, scanRunId, "Ticket", "REFUNDED"); // never observed, operator knows it exists

    expect(listObservedStates(db, scanRunId, "Ticket").sort()).toEqual(["PAID", "REFUNDED", "RESERVED"]);
  });
});
