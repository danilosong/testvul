import type { Db } from "../db/connection";
import type { ScanMode } from "./scan-mode-gate";
import type { TargetEnvironmentClassification } from "../mutation/scan-run-environment";
import { listMutationScopeEntriesForTarget, type MutationScopeEntryInput } from "../mutation/mutation-scope";
import { listBusinessExpectationsForTarget } from "../business-logic/business-expectations-repository";
import { listBusinessInvariantsForTarget } from "../business-logic/business-invariants-repository";
import { listAuthorizationExpectations } from "../auth/authorization-expectations-repository";
import type { BusinessExpectation } from "../business-logic/business-expectation";
import type { BusinessInvariant } from "../business-logic/invariant-engine";
import type { AuthorizationExpectation } from "../auth/authorization-expectation";

/**
 * The Immutable Scan Run Configuration Snapshot (Section 14.8, design.md
 * Decision 51). `createScanRun` is the *only* place a `scan_run_configs`
 * row is ever meant to be created: it copies everything a scan run needs
 * — target/scope/scan mode/rate limit/concurrency/selected auth
 * profiles/enabled scanners/enabled business-logic profiles/write-test
 * flags/private-network setting/environment classification/browser
 * egress level/mutation-authorization-confirmation, plus full copies of
 * the currently-configured `business_expectations`, `business_invariants`,
 * `authorization_expectations` (for every selected auth profile), and
 * `mutation_scope_resources` rows — once, at scan start. Nothing written
 * here is ever updated afterward; a later edit to the live `targets`/rule
 * tables can never retroactively change what an already-started scan run
 * means.
 */
export interface CreateScanRunInput {
  targetId: number;
  /** Overrides the target's own `scope_json`/`default_scan_mode`/`rate_limit_rps`/`allow_private_networks`/`environment` when supplied; otherwise the target's current values are copied as-is. */
  scope?: string[];
  scanMode?: ScanMode;
  rateLimitRps?: number;
  allowPrivateNetworks?: boolean;
  environment?: TargetEnvironmentClassification;
  concurrency?: number;
  browserEgressLevel?: "BROWSER_EGRESS_STRICT" | "BROWSER_EGRESS_BEST_EFFORT";
  enabledScanners?: string[];
  enabledBusinessProfiles?: string[];
  writeTestFlags?: Record<string, boolean>;
  selectedAuthProfileIds?: number[];
  mutationAuthorizationConfirmedBy?: string;
}

export interface ScanRunConfigSnapshot {
  targetId: number;
  scope: string[];
  scanMode: ScanMode;
  rateLimitRps: number;
  concurrency: number;
  allowPrivateNetworks: boolean;
  environment: TargetEnvironmentClassification;
  browserEgressLevel?: "BROWSER_EGRESS_STRICT" | "BROWSER_EGRESS_BEST_EFFORT";
  enabledScanners: string[];
  enabledBusinessProfiles: string[];
  writeTestFlags: Record<string, boolean>;
  mutationAuthorizationConfirmedBy?: string;
}

interface TargetRow {
  scope_json: string;
  default_scan_mode: ScanMode;
  rate_limit_rps: number;
  allow_private_networks: number;
  environment: TargetEnvironmentClassification;
}

export interface CreateScanRunResult {
  scanRunId: number;
  scanRunConfigId: number;
}

export function createScanRun(db: Db, input: CreateScanRunInput): CreateScanRunResult {
  const targetRow = db
    .prepare("SELECT scope_json, default_scan_mode, rate_limit_rps, allow_private_networks, environment FROM targets WHERE id = ?")
    .get(input.targetId) as TargetRow | undefined;
  if (!targetRow) throw new Error(`No target found with id ${input.targetId}`);

  const scope = input.scope ?? (JSON.parse(targetRow.scope_json) as string[]);
  const scanMode = input.scanMode ?? targetRow.default_scan_mode;
  const rateLimitRps = input.rateLimitRps ?? targetRow.rate_limit_rps;
  const allowPrivateNetworks = input.allowPrivateNetworks ?? targetRow.allow_private_networks === 1;
  const environment = input.environment ?? targetRow.environment;
  const concurrency = input.concurrency ?? 2;
  const enabledScanners = input.enabledScanners ?? [];
  const enabledBusinessProfiles = input.enabledBusinessProfiles ?? [];
  const writeTestFlags = input.writeTestFlags ?? {};
  const selectedAuthProfileIds = input.selectedAuthProfileIds ?? [];

  const mutationScopeSnapshot = listMutationScopeEntriesForTarget(db, input.targetId);
  const businessExpectationsSnapshot = listBusinessExpectationsForTarget(db, input.targetId);
  const businessInvariantsSnapshot = listBusinessInvariantsForTarget(db, input.targetId);
  const authorizationExpectationsSnapshot = selectedAuthProfileIds.flatMap((authProfileId) => listAuthorizationExpectations(db, authProfileId));

  const configResult = db
    .prepare(
      `INSERT INTO scan_run_configs
         (target_id, scope_json, scan_mode, rate_limit_rps, concurrency, allow_private_networks, environment,
          browser_egress_level, enabled_scanners_json, enabled_business_profiles_json, write_test_flags_json,
          mutation_scope_snapshot_json, business_expectations_snapshot_json, business_invariants_snapshot_json,
          authorization_expectations_snapshot_json, mutation_authorization_confirmed_by, mutation_authorization_confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.targetId,
      JSON.stringify(scope),
      scanMode,
      rateLimitRps,
      concurrency,
      allowPrivateNetworks ? 1 : 0,
      environment,
      input.browserEgressLevel ?? null,
      JSON.stringify(enabledScanners),
      JSON.stringify(enabledBusinessProfiles),
      JSON.stringify(writeTestFlags),
      JSON.stringify(mutationScopeSnapshot),
      JSON.stringify(businessExpectationsSnapshot),
      JSON.stringify(businessInvariantsSnapshot),
      JSON.stringify(authorizationExpectationsSnapshot),
      input.mutationAuthorizationConfirmedBy ?? null,
      input.mutationAuthorizationConfirmedBy ? new Date().toISOString() : null,
    );
  const scanRunConfigId = Number(configResult.lastInsertRowid);

  const runResult = db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (?, ?)").run(input.targetId, scanRunConfigId);
  const scanRunId = Number(runResult.lastInsertRowid);

  for (const authProfileId of selectedAuthProfileIds) {
    db.prepare("INSERT INTO scan_run_auth_profiles (scan_run_id, auth_profile_id) VALUES (?, ?)").run(scanRunId, authProfileId);
  }

  return { scanRunId, scanRunConfigId };
}

interface SnapshotRow {
  target_id: number;
  scope_json: string;
  scan_mode: ScanMode;
  rate_limit_rps: number;
  concurrency: number;
  allow_private_networks: number;
  environment: TargetEnvironmentClassification;
  browser_egress_level: "BROWSER_EGRESS_STRICT" | "BROWSER_EGRESS_BEST_EFFORT" | null;
  enabled_scanners_json: string;
  enabled_business_profiles_json: string;
  write_test_flags_json: string;
  mutation_authorization_confirmed_by: string | null;
}

/** Reads the immutable configuration snapshot for a scan run — every value here is exactly what was copied at scan start, regardless of anything changed on the live target or rule tables since. */
export function getScanRunConfigSnapshot(db: Db, scanRunId: number): ScanRunConfigSnapshot {
  const row = db
    .prepare(
      `SELECT src.target_id, src.scope_json, src.scan_mode, src.rate_limit_rps, src.concurrency, src.allow_private_networks,
              src.environment, src.browser_egress_level, src.enabled_scanners_json, src.enabled_business_profiles_json,
              src.write_test_flags_json, src.mutation_authorization_confirmed_by
       FROM scan_runs sr JOIN scan_run_configs src ON src.id = sr.scan_run_config_id
       WHERE sr.id = ?`,
    )
    .get(scanRunId) as SnapshotRow | undefined;
  if (!row) throw new Error(`No scan run found with id ${scanRunId}`);

  const snapshot: ScanRunConfigSnapshot = {
    targetId: row.target_id,
    scope: JSON.parse(row.scope_json) as string[],
    scanMode: row.scan_mode,
    rateLimitRps: row.rate_limit_rps,
    concurrency: row.concurrency,
    allowPrivateNetworks: row.allow_private_networks === 1,
    environment: row.environment,
    enabledScanners: JSON.parse(row.enabled_scanners_json) as string[],
    enabledBusinessProfiles: JSON.parse(row.enabled_business_profiles_json) as string[],
    writeTestFlags: JSON.parse(row.write_test_flags_json) as Record<string, boolean>,
  };
  if (row.browser_egress_level !== null) snapshot.browserEgressLevel = row.browser_egress_level;
  if (row.mutation_authorization_confirmed_by !== null) snapshot.mutationAuthorizationConfirmedBy = row.mutation_authorization_confirmed_by;
  return snapshot;
}

function readSnapshotColumn<T>(db: Db, scanRunId: number, column: string): T {
  const row = db
    .prepare(`SELECT src.${column} as v FROM scan_runs sr JOIN scan_run_configs src ON src.id = sr.scan_run_config_id WHERE sr.id = ?`)
    .get(scanRunId) as { v: string } | undefined;
  if (!row) throw new Error(`No scan run found with id ${scanRunId}`);
  return JSON.parse(row.v) as T;
}

/** The rule snapshots finding evaluation is meant to read from (design.md Decision 51) — never a live query against `business_expectations`/`business_invariants`/`authorization_expectations`/`mutation_scope_resources` filtered by target/auth-profile id. */
export function getMutationScopeSnapshot(db: Db, scanRunId: number): MutationScopeEntryInput[] {
  return readSnapshotColumn(db, scanRunId, "mutation_scope_snapshot_json");
}

export function getBusinessExpectationsSnapshot(db: Db, scanRunId: number): BusinessExpectation[] {
  return readSnapshotColumn(db, scanRunId, "business_expectations_snapshot_json");
}

export function getBusinessInvariantsSnapshot(db: Db, scanRunId: number): BusinessInvariant[] {
  return readSnapshotColumn(db, scanRunId, "business_invariants_snapshot_json");
}

export function getAuthorizationExpectationsSnapshot(db: Db, scanRunId: number): AuthorizationExpectation[] {
  return readSnapshotColumn(db, scanRunId, "authorization_expectations_snapshot_json");
}
