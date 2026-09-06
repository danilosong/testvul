import type { Db } from "../db/connection";

export type TargetEnvironmentClassification = "LOCAL_FIXTURE" | "DEVELOPMENT" | "STAGING" | "PRODUCTION";

export interface ProductionMutationPolicyInput {
  environment: TargetEnvironmentClassification;
  mutationAuthorized: boolean;
  isTestResource: boolean;
  reversibilityProven: boolean;
  backupRestoreCapable: boolean;
}

export class EnvironmentMutationPolicyError extends Error {
  constructor(public readonly missingPreconditions: string[]) {
    super(`SKIPPED_ENVIRONMENT_POLICY — missing: ${missingPreconditions.join(", ")}`);
    this.name = "EnvironmentMutationPolicyError";
  }
}

export function assertEnvironmentMutationPolicy(input: ProductionMutationPolicyInput): void {
  if (input.environment !== "PRODUCTION") return;
  const missingPreconditions: string[] = [];
  if (!input.mutationAuthorized) missingPreconditions.push("MUTATION_AUTHORIZATION");
  if (!input.isTestResource) missingPreconditions.push("TEST_RESOURCE");
  if (!input.reversibilityProven) missingPreconditions.push("REVERSIBILITY_PROVEN");
  if (!input.backupRestoreCapable) missingPreconditions.push("BACKUP_RESTORE_CAPABILITY");
  if (missingPreconditions.length > 0) throw new EnvironmentMutationPolicyError(missingPreconditions);
}

export function isScanRunMutationAuthorized(db: Db, scanRunId: number): boolean {
  const row = db
    .prepare(
      `SELECT src.mutation_authorization_confirmed_by as confirmedBy
       FROM scan_runs sr JOIN scan_run_configs src ON src.id = sr.scan_run_config_id
       WHERE sr.id = ?`,
    )
    .get(scanRunId) as { confirmedBy: string | null } | undefined;
  if (!row) throw new Error(`No scan run found with id ${scanRunId}`);
  return row.confirmedBy !== null;
}

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
