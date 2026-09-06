import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { listBusinessFindings, recordBusinessFinding } from "./business-findings-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-business-findings-repo-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("business-findings-repository (Section 13.20)", () => {
  it("persists a finding carrying severity, confidence, and proof level as three independent attributes", () => {
    const { db, scanRunId } = freshScanRun();
    const id = recordBusinessFinding(db, {
      scanRunId,
      title: "currentLowestEligibleNumber exposed unauthenticated",
      severity: "CRITICAL",
      category: "STATE_EXPOSURE",
      confidence: "LOW",
      proofLevel: "OBSERVED",
    });

    const findings = listBusinessFindings(db, scanRunId);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      id,
      scanRunId,
      title: "currentLowestEligibleNumber exposed unauthenticated",
      severity: "CRITICAL",
      category: "STATE_EXPOSURE",
      confidence: "LOW",
      proofLevel: "OBSERVED",
    });
    // The three attributes are independent: a CRITICAL-severity finding
    // can still carry LOW confidence and the weakest (OBSERVED) proof
    // level — none is derived from, or constrains, another.
    expect(findings[0]?.severity).toBe("CRITICAL");
    expect(findings[0]?.confidence).toBe("LOW");
    expect(findings[0]?.proofLevel).toBe("OBSERVED");
  });

  it("persists every business-logic category value", () => {
    const { db, scanRunId } = freshScanRun();
    const categories = [
      "BUSINESS_LOGIC",
      "WORKFLOW_BYPASS",
      "PARAMETER_TAMPERING",
      "SERVER_CONTROLLED_FIELD",
      "STATE_EXPOSURE",
      "PREDICTABILITY",
      "REPLAY",
      "MISSING_IDEMPOTENCY",
      "RACE_CONDITION",
      "LIMIT_BYPASS",
      "INVALID_STATE_TRANSITION",
      "BUSINESS_AUTHORIZATION",
      "BUSINESS_STATE_INFERENCE",
    ] as const;
    for (const category of categories) {
      recordBusinessFinding(db, { scanRunId, title: category, severity: "INFO", category, confidence: "MEDIUM", proofLevel: "INCONCLUSIVE" });
    }
    expect(listBusinessFindings(db, scanRunId)).toHaveLength(categories.length);
  });
});
