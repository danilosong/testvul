import type { Db } from "../db/connection";

export type ScanMode = "PASSIVE" | "SAFE_AUTOMATIC" | "ADVANCED";

/**
 * Scan Mode Gating (Section 14.3): Passive is read-only across every test
 * type (API, browser, business-logic) — no exceptions. Safe Automatic
 * permits backed-up/verified/restored mutations once a scan run carries a
 * confirmed mutation-authorization (design.md Decision 18, Section 16.6's
 * eventual API/UI just writes that same flag — this module trusts it as a
 * precondition rather than re-implementing the confirmation check).
 * Advanced additionally requires an explicit per-module opt-in. Nothing
 * ever auto-executes a DESTRUCTIVE operation, in any mode.
 */
export type ScanModeGateOutcome = "ALLOWED" | "BLOCKED_DESTRUCTIVE" | "BLOCKED_PASSIVE_MODE" | "BLOCKED_NO_AUTHORIZATION" | "BLOCKED_NOT_OPTED_IN";

export interface ScanModeGateParams {
  scanMode: ScanMode;
  mutationAuthorizationConfirmed: boolean;
  /** Required only in ADVANCED mode — a module (scanner/business-logic test type) must explicitly opt in. */
  moduleOptedIn?: boolean;
  isDestructive: boolean;
}

export function evaluateScanModeGate(params: ScanModeGateParams): ScanModeGateOutcome {
  if (params.isDestructive) return "BLOCKED_DESTRUCTIVE";
  if (params.scanMode === "PASSIVE") return "BLOCKED_PASSIVE_MODE";
  if (!params.mutationAuthorizationConfirmed) return "BLOCKED_NO_AUTHORIZATION";
  if (params.scanMode === "ADVANCED" && !params.moduleOptedIn) return "BLOCKED_NOT_OPTED_IN";
  return "ALLOWED";
}

/** Reads the scan mode from a scan run's immutable configuration snapshot (`scan_run_configs.scan_mode`) — never a live/mutable target setting, per design.md Decision 51/52. */
export function getScanMode(db: Db, scanRunId: number): ScanMode {
  const row = db
    .prepare(`SELECT src.scan_mode as scanMode FROM scan_runs sr JOIN scan_run_configs src ON src.id = sr.scan_run_config_id WHERE sr.id = ?`)
    .get(scanRunId) as { scanMode: ScanMode } | undefined;
  if (!row) throw new Error(`No scan run found with id ${scanRunId}`);
  return row.scanMode;
}

/** True only once `mutation_authorization_confirmed_by` has actually been recorded for this scan run's configuration snapshot — an unset flag is never treated as implicit authorization. */
export function isMutationAuthorized(db: Db, scanRunId: number): boolean {
  const row = db
    .prepare(
      `SELECT src.mutation_authorization_confirmed_by as confirmedBy FROM scan_runs sr JOIN scan_run_configs src ON src.id = sr.scan_run_config_id WHERE sr.id = ?`,
    )
    .get(scanRunId) as { confirmedBy: string | null } | undefined;
  if (!row) throw new Error(`No scan run found with id ${scanRunId}`);
  return row.confirmedBy !== null;
}

export type ScanModeGatedMutationOutcome = { status: "EXECUTED"; result: unknown } | { status: Exclude<ScanModeGateOutcome, "ALLOWED"> };

export interface RunIfScanModeAllowsParams {
  db: Db;
  scanRunId: number;
  isDestructive: boolean;
  moduleOptedIn?: boolean;
  /** Never invoked unless the gate resolves to ALLOWED. */
  performMutation: () => Promise<unknown>;
}

/**
 * The one chokepoint every mutation-initiating test type (API scanner,
 * browser scanner, business-logic test) is meant to go through before
 * ever calling its own mutation logic — mirrors the same
 * gate-before-callback shape `testReplay`/`executeBusinessOperation`/etc.
 * already use, so scan-mode gating can never be bypassed by a caller that
 * simply forgets to check first.
 */
export async function runIfScanModeAllows(params: RunIfScanModeAllowsParams): Promise<ScanModeGatedMutationOutcome> {
  const scanMode = getScanMode(params.db, params.scanRunId);
  const mutationAuthorizationConfirmed = isMutationAuthorized(params.db, params.scanRunId);
  const gate = evaluateScanModeGate({
    scanMode,
    mutationAuthorizationConfirmed,
    isDestructive: params.isDestructive,
    ...(params.moduleOptedIn !== undefined ? { moduleOptedIn: params.moduleOptedIn } : {}),
  });
  if (gate !== "ALLOWED") return { status: gate };
  return { status: "EXECUTED", result: await params.performMutation() };
}
