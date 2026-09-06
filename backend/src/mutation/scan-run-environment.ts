import type { Db } from "../db/connection";

export type TargetEnvironmentClassification = "LOCAL_FIXTURE" | "DEVELOPMENT" | "STAGING" | "PRODUCTION";

/**
 * Reads the Target Environment Classification for a scan run from its
 * immutable configuration snapshot (`scan_run_configs.environment`) — never
 * a live/mutable target setting — per design.md Decision 51/52.
 */
export function getScanRunEnvironment(db: Db, scanRunId: number): TargetEnvironmentClassification {
  const row = db
    .prepare(
      `SELECT src.environment as environment
       FROM scan_runs sr
       JOIN scan_run_configs src ON src.id = sr.scan_run_config_id
       WHERE sr.id = ?`,
    )
    .get(scanRunId) as { environment: TargetEnvironmentClassification } | undefined;
  if (!row) {
    throw new Error(`No scan run found with id ${scanRunId}`);
  }
  return row.environment;
}
