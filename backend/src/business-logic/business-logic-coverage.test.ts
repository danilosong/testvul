import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { computeBusinessLogicCoverage } from "./business-logic-coverage";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number; targetId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-business-logic-coverage-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1, targetId: 1 };
}

describe("computeBusinessLogicCoverage (Section 13.28)", () => {
  it("matches a sample scan's actual business-logic activity, broken down correctly by profile", () => {
    const { db, scanRunId, targetId } = freshScanRun();

    // Generic profile: one "Project" object, one state, one operation.
    db.prepare("INSERT INTO business_objects (scan_run_id, object_type, source) VALUES (?, 'Project', 'generic')").run(scanRunId);
    db.prepare("INSERT INTO business_states (scan_run_id, object_type, state_value) VALUES (?, 'Project', 'ACTIVE')").run(scanRunId);
    db.prepare("INSERT INTO business_operations (scan_run_id, object_type, description) VALUES (?, 'Project', 'PATCH notes')").run(scanRunId);

    // Contest profile: two objects (Campaign, Ticket), two states, one operation.
    db.prepare("INSERT INTO business_objects (scan_run_id, object_type, source) VALUES (?, 'Campaign', 'contest')").run(scanRunId);
    db.prepare("INSERT INTO business_objects (scan_run_id, object_type, source) VALUES (?, 'Ticket', 'contest')").run(scanRunId);
    db.prepare("INSERT INTO business_states (scan_run_id, object_type, state_value) VALUES (?, 'Ticket', 'PAID')").run(scanRunId);
    db.prepare("INSERT INTO business_states (scan_run_id, object_type, state_value) VALUES (?, 'Ticket', 'PENDING_PAYMENT')").run(scanRunId);
    db.prepare("INSERT INTO business_operations (scan_run_id, object_type, description) VALUES (?, 'Ticket', 'payments/webhook')").run(scanRunId);

    // Target-scoped configured rules: one invariant + one expectation for Ticket (contest).
    db.prepare(
      "INSERT INTO business_invariants (target_id, name, object_type, condition_json, expected_json, severity) VALUES (?, 'n', 'Ticket', '{}', 'true', 'HIGH')",
    ).run(targetId);
    db.prepare(
      "INSERT INTO business_expectations (target_id, object_type, property_or_action, expectation_type, expected_value, severity) VALUES (?, 'Ticket', 'number.control', 'AUTHORITY', 'SERVER_CONTROLLED', 'HIGH')",
    ).run(targetId);

    // Test plans for Ticket (contest): one executed (CONFIRMED), one skipped (NOT_TESTED), one inconclusive.
    db.prepare(
      "INSERT INTO business_test_plans (scan_run_id, object_type, safety_classification, proof_level) VALUES (?, 'Ticket', 'SAFE_REVERSIBLE_MUTATION', 'CONFIRMED')",
    ).run(scanRunId);
    db.prepare(
      "INSERT INTO business_test_plans (scan_run_id, object_type, safety_classification, proof_level) VALUES (?, 'Ticket', 'FINANCIAL', 'NOT_TESTED')",
    ).run(scanRunId);
    db.prepare(
      "INSERT INTO business_test_plans (scan_run_id, object_type, safety_classification, proof_level) VALUES (?, 'Ticket', 'SAFE_REVERSIBLE_MUTATION', 'INCONCLUSIVE')",
    ).run(scanRunId);
    // A Project (generic) test plan with no proof_level at all yet (never run) — counts as skipped too.
    db.prepare("INSERT INTO business_test_plans (scan_run_id, object_type, safety_classification) VALUES (?, 'Project', 'SAFE_READ')").run(scanRunId);

    // Two findings, scan-wide (findings carry no per-object-type attribution).
    db.prepare("INSERT INTO findings (scan_run_id, title, severity) VALUES (?, 'f1', 'HIGH')").run(scanRunId);
    db.prepare("INSERT INTO findings (scan_run_id, title, severity) VALUES (?, 'f2', 'LOW')").run(scanRunId);

    const report = computeBusinessLogicCoverage({ db, scanRunId, targetId });

    expect(report.totalFindings).toBe(2);
    expect(report.byProfile.map((p) => p.profileName)).toEqual(["contest", "generic"]);

    const contest = report.byProfile.find((p) => p.profileName === "contest")!;
    expect(contest.coverage).toEqual({
      objectsDiscovered: 2,
      statesDiscovered: 2,
      operationsDiscovered: 1,
      invariantsConfigured: 1,
      expectationsConfigured: 1,
      testPlansGenerated: 3,
      testPlansExecuted: 1,
      testPlansSkipped: 1,
      testPlansInconclusive: 1,
    });

    const generic = report.byProfile.find((p) => p.profileName === "generic")!;
    expect(generic.coverage).toEqual({
      objectsDiscovered: 1,
      statesDiscovered: 1,
      operationsDiscovered: 1,
      invariantsConfigured: 0,
      expectationsConfigured: 0,
      testPlansGenerated: 1,
      testPlansExecuted: 0,
      testPlansSkipped: 1,
      testPlansInconclusive: 0,
    });
  });

  it("returns an empty breakdown and zero findings for a scan run with no business-logic activity at all", () => {
    const { db, scanRunId, targetId } = freshScanRun();
    const report = computeBusinessLogicCoverage({ db, scanRunId, targetId });
    expect(report).toEqual({ byProfile: [], totalFindings: 0 });
  });
});
