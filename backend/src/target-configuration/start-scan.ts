import type { Db } from "../db/connection";
import type { ScanMode } from "../scan-orchestration/scan-mode-gate";
import { createScanRun, type CreateScanRunResult } from "../scan-orchestration/scan-run-config-snapshot";
import { recordAuditEvent } from "../mutation/audit-events-repository";
import { getTarget } from "./targets-repository";

/**
 * The explicit mutation-authorization confirmation gate (Section 16.6,
 * design.md Decision 18) — the exact confirmation text an operator must
 * supply verbatim before the start-scan API will ever create a Safe
 * Automatic/Advanced (or any write-test-flag-enabled) scan run.
 */
export const MUTATION_AUTHORIZATION_CONFIRMATION_TEXT =
  "I confirm that I am authorized to test this target and authorize temporary non-destructive mutations.";

/** Safe Automatic/Advanced always require it; a Passive-mode audit never does, regardless of what write-test flags happen to be set on it (an inconsistent combination `evaluateScanModeGate`, Section 14.3, would block outright anyway). */
export function requiresMutationAuthorization(scanMode: ScanMode, writeTestFlags: Record<string, boolean> = {}): boolean {
  if (scanMode === "SAFE_AUTOMATIC" || scanMode === "ADVANCED") return true;
  return Object.values(writeTestFlags).some(Boolean);
}

export class MutationAuthorizationRequiredError extends Error {
  constructor() {
    super(
      `Starting this scan requires an explicit mutation-authorization confirmation: "${MUTATION_AUTHORIZATION_CONFIRMATION_TEXT}"`,
    );
    this.name = "MutationAuthorizationRequiredError";
  }
}

export interface MutationAuthorizationConfirmation {
  confirmationText: string;
  confirmedBy: string;
}

export interface StartScanInput {
  targetId: number;
  scanMode?: ScanMode;
  writeTestFlags?: Record<string, boolean>;
  rateLimitRps?: number;
  mutationAuthorization?: MutationAuthorizationConfirmation;
  /** Section 16.8 — every selected profile becomes available to security tests during this scan (`scan_run_auth_profiles`), never just the first/only one. */
  authProfileIds?: number[];
}

/**
 * The start-scan API (Section 16.6): resolves the scan mode from the
 * target's own default unless overridden, checks whether mutation
 * authorization is required, and — only once a matching confirmation was
 * supplied — creates the scan run (Section 14.8's immutable snapshot
 * already records the confirming identity/timestamp) and additionally
 * writes a dedicated audit-trail event, so the confirmation itself is
 * independently queryable from the scan run's own configuration.
 */
export function startScan(db: Db, input: StartScanInput): CreateScanRunResult {
  const target = getTarget(db, input.targetId);
  if (!target) throw new Error(`No target found with id ${input.targetId}`);

  const scanMode = input.scanMode ?? target.defaultScanMode;
  const needsAuthorization = requiresMutationAuthorization(scanMode, input.writeTestFlags);

  if (needsAuthorization && input.mutationAuthorization?.confirmationText !== MUTATION_AUTHORIZATION_CONFIRMATION_TEXT) {
    throw new MutationAuthorizationRequiredError();
  }

  const result = createScanRun(db, {
    targetId: input.targetId,
    scanMode,
    ...(input.writeTestFlags !== undefined ? { writeTestFlags: input.writeTestFlags } : {}),
    ...(input.rateLimitRps !== undefined ? { rateLimitRps: input.rateLimitRps } : {}),
    ...(input.authProfileIds !== undefined ? { selectedAuthProfileIds: input.authProfileIds } : {}),
    ...(needsAuthorization ? { mutationAuthorizationConfirmedBy: input.mutationAuthorization!.confirmedBy } : {}),
  });

  if (needsAuthorization) {
    recordAuditEvent(db, result.scanRunId, "MUTATION_AUTHORIZATION_CONFIRMED", {
      confirmedBy: input.mutationAuthorization!.confirmedBy,
      confirmationText: MUTATION_AUTHORIZATION_CONFIRMATION_TEXT,
    });
  }

  return result;
}
