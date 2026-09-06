import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import type { ResourceKey } from "../mutation/resource-key";
import { listBusinessTestPlans, recordBusinessTestPlan } from "./business-test-plans-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-business-test-plans-repo-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  db.prepare("INSERT INTO candidates (scan_run_id, scanner) VALUES (1, 'BUSINESS_LOGIC')").run();
  db.prepare(
    "INSERT INTO business_invariants (target_id, name, object_type, condition_json, expected_json, severity) VALUES (1, 'n', 'Ticket', '{}', 'true', 'HIGH')",
  ).run();
  return { db, scanRunId: 1 };
}

const RESOURCE: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "Ticket", resourceId: "7" };

describe("business-test-plans-repository (Section 13.18)", () => {
  it("persists and reads back only the referential subset of a test plan", () => {
    const { db, scanRunId } = freshScanRun();
    const id = recordBusinessTestPlan(db, {
      scanRunId,
      resourceKey: RESOURCE,
      candidateId: 1,
      invariantId: 1,
      safetyClassification: "SAFE_REVERSIBLE_MUTATION",
      proofLevel: "CONFIRMED",
    });
    expect(id).toBeGreaterThan(0);

    const plans = listBusinessTestPlans(db, scanRunId);
    expect(plans).toEqual([
      { id, scanRunId, candidateId: 1, invariantId: 1, safetyClassification: "SAFE_REVERSIBLE_MUTATION", proofLevel: "CONFIRMED" },
    ]);
  });

  it("omits optional fields entirely when absent, rather than persisting them as null placeholders in the returned record", () => {
    const { db, scanRunId } = freshScanRun();
    const id = recordBusinessTestPlan(db, { scanRunId, resourceKey: RESOURCE, safetyClassification: "PASSIVE" });
    const plans = listBusinessTestPlans(db, scanRunId);
    expect(plans).toEqual([{ id, scanRunId, safetyClassification: "PASSIVE" }]);
  });
});
