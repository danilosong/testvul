import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { listAllObservedPropertiesForScanRun, recordObservedProperty } from "./business-observed-properties-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-observed-properties-repo-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("listAllObservedPropertiesForScanRun (Section 13.22)", () => {
  it("lists every observed property for a scan run, across all object types and properties", () => {
    const { db, scanRunId } = freshScanRun();
    recordObservedProperty(db, { scanRunId, objectType: "Ticket", propertyOrAction: "number.control", observedValue: "SERVER_CONTROLLED" });
    recordObservedProperty(db, { scanRunId, objectType: "Campaign", propertyOrAction: "currentLowestEligibleNumber", observedValue: { exposureState: "PUBLIC" } });
    expect(listAllObservedPropertiesForScanRun(db, scanRunId)).toHaveLength(2);
  });

  it("scopes listing by scan run, never leaking one scan's observations into another's", () => {
    const { db, scanRunId } = freshScanRun();
    db.prepare(
      "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
    ).run();
    db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 2)").run();
    recordObservedProperty(db, { scanRunId, objectType: "Ticket", propertyOrAction: "number.control", observedValue: "SERVER_CONTROLLED" });
    recordObservedProperty(db, { scanRunId: 2, objectType: "Ticket", propertyOrAction: "number.control", observedValue: "CLIENT_CONTROLLED" });
    expect(listAllObservedPropertiesForScanRun(db, scanRunId)).toHaveLength(1);
    expect(listAllObservedPropertiesForScanRun(db, 2)).toHaveLength(1);
  });
});
