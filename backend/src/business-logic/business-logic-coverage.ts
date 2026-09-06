import type { Db } from "../db/connection";

/**
 * Business Logic Coverage aggregation (Section 13.28), exposed to
 * `findings-reporting`. Broken down per active profile by cross-
 * referencing each row's `objectType` against `business_objects.source`
 * (the same `source` a Profile Plugin's own contribution already tags
 * every candidate with — Section 13.1/13.21) for the same scan run.
 * `findings` carries no per-object-type attribution in the schema, so it
 * is reported only as a scan-wide total, not broken down by profile.
 */
export interface BusinessLogicCoverageCounts {
  objectsDiscovered: number;
  statesDiscovered: number;
  operationsDiscovered: number;
  invariantsConfigured: number;
  expectationsConfigured: number;
  testPlansGenerated: number;
  testPlansExecuted: number;
  testPlansSkipped: number;
  testPlansInconclusive: number;
}

export interface BusinessLogicCoverageByProfile {
  profileName: string;
  coverage: BusinessLogicCoverageCounts;
}

export interface BusinessLogicCoverageReport {
  byProfile: BusinessLogicCoverageByProfile[];
  totalFindings: number;
}

export interface ComputeBusinessLogicCoverageParams {
  db: Db;
  scanRunId: number;
  targetId: number;
}

function countWhereObjectTypeIn(db: Db, table: string, scopeColumn: "scan_run_id" | "target_id", scopeId: number, objectTypes: readonly string[]): number {
  if (objectTypes.length === 0) return 0;
  const placeholders = objectTypes.map(() => "?").join(", ");
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM ${table} WHERE ${scopeColumn} = ? AND object_type IN (${placeholders})`)
    .get(scopeId, ...objectTypes) as { c: number };
  return row.c;
}

function countTestPlansByProofLevelBucket(
  db: Db,
  scanRunId: number,
  objectTypes: readonly string[],
  bucket: "skipped" | "inconclusive" | "executed",
): number {
  if (objectTypes.length === 0) return 0;
  const placeholders = objectTypes.map(() => "?").join(", ");
  const clause =
    bucket === "skipped"
      ? "(proof_level IS NULL OR proof_level = 'NOT_TESTED')"
      : bucket === "inconclusive"
        ? "proof_level = 'INCONCLUSIVE'"
        : "proof_level IN ('OBSERVED', 'INFERRED', 'SAFE_PROBE_CONFIRMED', 'CONFIRMED')";
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM business_test_plans WHERE scan_run_id = ? AND object_type IN (${placeholders}) AND ${clause}`)
    .get(scanRunId, ...objectTypes) as { c: number };
  return row.c;
}

export function computeBusinessLogicCoverage(params: ComputeBusinessLogicCoverageParams): BusinessLogicCoverageReport {
  const { db, scanRunId, targetId } = params;

  const objectRows = db.prepare("SELECT object_type, source FROM business_objects WHERE scan_run_id = ?").all(scanRunId) as unknown as {
    object_type: string;
    source: string;
  }[];

  const profileNames = [...new Set(objectRows.map((row) => row.source))].sort();
  const objectTypesByProfile = new Map<string, string[]>();
  for (const row of objectRows) {
    const list = objectTypesByProfile.get(row.source) ?? [];
    if (!list.includes(row.object_type)) list.push(row.object_type);
    objectTypesByProfile.set(row.source, list);
  }

  const byProfile: BusinessLogicCoverageByProfile[] = profileNames.map((profileName) => {
    const objectTypes = objectTypesByProfile.get(profileName) ?? [];
    return {
      profileName,
      coverage: {
        objectsDiscovered: objectRows.filter((row) => row.source === profileName).length,
        statesDiscovered: countWhereObjectTypeIn(db, "business_states", "scan_run_id", scanRunId, objectTypes),
        operationsDiscovered: countWhereObjectTypeIn(db, "business_operations", "scan_run_id", scanRunId, objectTypes),
        invariantsConfigured: countWhereObjectTypeIn(db, "business_invariants", "target_id", targetId, objectTypes),
        expectationsConfigured: countWhereObjectTypeIn(db, "business_expectations", "target_id", targetId, objectTypes),
        testPlansGenerated: countWhereObjectTypeIn(db, "business_test_plans", "scan_run_id", scanRunId, objectTypes),
        testPlansExecuted: countTestPlansByProofLevelBucket(db, scanRunId, objectTypes, "executed"),
        testPlansSkipped: countTestPlansByProofLevelBucket(db, scanRunId, objectTypes, "skipped"),
        testPlansInconclusive: countTestPlansByProofLevelBucket(db, scanRunId, objectTypes, "inconclusive"),
      },
    };
  });

  const totalFindings = (db.prepare("SELECT COUNT(*) as c FROM findings WHERE scan_run_id = ?").get(scanRunId) as { c: number }).c;

  return { byProfile, totalFindings };
}
