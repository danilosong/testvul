import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { listObservedProperties } from "./business-observed-properties-repository";
import { recordCrossResponseInference } from "./cross-response-inference";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-cross-response-inference-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("recordCrossResponseInference (Section 13.11)", () => {
  it("records the combination as a POTENTIAL_BUSINESS_STATE_INFERENCE observation, never as a confirmed finding", () => {
    const { db, scanRunId } = freshScanRun();

    recordCrossResponseInference({
      db,
      scanRunId,
      objectType: "Campaign",
      inferredProperty: "likelyWinningNumber",
      combinedFrom: ["reservation.ticketNumber", "current-lowest-eligible-number.currentLowestEligibleNumber"],
    });

    const stored = listObservedProperties(db, scanRunId, "Campaign", "likelyWinningNumber");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.observedValue).toEqual({
      classification: "POTENTIAL_BUSINESS_STATE_INFERENCE",
      combinedFrom: ["reservation.ticketNumber", "current-lowest-eligible-number.currentLowestEligibleNumber"],
    });

    const findingCount = (db.prepare("SELECT COUNT(*) as c FROM findings WHERE scan_run_id = ?").get(scanRunId) as { c: number }).c;
    expect(findingCount).toBe(0);
  });
});
