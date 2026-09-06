import type { Db } from "../db/connection";

/**
 * Business Logic Coverage aggregation (Section 13.28), exposed to
 * `findings-reporting`. Broken down per active profile by cross-
 * referencing each row's `objectType` against which profile actually
 * claimed that object type — from composing the real Profile Plugins'
 * `contribute()` output (Section 13.1/13.21's `composeProfiles`), never
 * from `business_objects.source`. That column is a *discovery-provenance*
 * label (OPENAPI/JSON_FIELD/BROWSER_RUNTIME/FORM/URL/ENDPOINT_NAME —
 * Section 13.4's `recordBusinessObject`), unrelated to which profile
 * recognizes the object type; conflating the two would silently break
 * profile attribution the moment real discovery data flows in.
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

export interface ProfileContributedCandidate {
  source: string;
  objectType: string;
}

/** Builds the profile -> claimed-object-types map straight from a composed Profile Plugin contribution's own candidates (design.md Decision 36) — the single source of truth for "which profile recognizes this object type." */
export function buildProfileObjectTypeMap(candidates: readonly ProfileContributedCandidate[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const candidate of candidates) {
    const list = map.get(candidate.source) ?? [];
    if (!list.includes(candidate.objectType)) list.push(candidate.objectType);
    map.set(candidate.source, list);
  }
  return map;
}

export interface ComputeBusinessLogicCoverageParams {
  db: Db;
  scanRunId: number;
  targetId: number;
  /** From `buildProfileObjectTypeMap(composeProfiles(activeProfiles, context).candidates)` — never derived from `business_objects.source`. */
  profileObjectTypes: ReadonlyMap<string, readonly string[]>;
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
  const { db, scanRunId, targetId, profileObjectTypes } = params;

  const profileNames = [...profileObjectTypes.keys()].sort();

  const byProfile: BusinessLogicCoverageByProfile[] = profileNames.map((profileName) => {
    const objectTypes = profileObjectTypes.get(profileName) ?? [];
    return {
      profileName,
      coverage: {
        objectsDiscovered: countWhereObjectTypeIn(db, "business_objects", "scan_run_id", scanRunId, objectTypes),
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
