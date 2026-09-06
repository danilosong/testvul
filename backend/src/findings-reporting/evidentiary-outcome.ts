import type { EligibilityState } from "../eligibility/eligibility-classifier";
import type { EvidentiaryOutcome } from "../eligibility/candidates-repository";
import type { ScannerVerdict } from "../scanners/security-scanner";
import type { BusinessFindingProofLevel } from "../business-logic/business-findings";
import { isXssFindingWorthyVerdict } from "./technical-finding-builder";

export type { EvidentiaryOutcome };

/**
 * The Evidentiary Outcome taxonomy (Section 15.2) for every candidate
 * that reached the Security Test Queue. Only TESTABLE and PASSIVE_ONLY
 * candidates ever actually ran a test — every `SKIPPED_*` state and every
 * `INCONCLUSIVE*` eligibility state never even reached the queue, and is
 * always NOT_TESTED here, never displayed as blocked (which would imply
 * the target correctly rejected an attempt this tool never made) or safe.
 */
export function candidateReachedSecurityTestQueue(eligibilityState: EligibilityState): boolean {
  return eligibilityState === "TESTABLE" || eligibilityState === "PASSIVE_ONLY";
}

/** `null` when the candidate actually ran (the caller must compute the real outcome from its result); NOT_TESTED for every state that never reached the queue at all. */
export function evidentiaryOutcomeForEligibilityState(eligibilityState: EligibilityState): EvidentiaryOutcome | null {
  return candidateReachedSecurityTestQueue(eligibilityState) ? null : "NOT_TESTED";
}

export function evidentiaryOutcomeForXssVerdict(verdict: ScannerVerdict): EvidentiaryOutcome {
  return isXssFindingWorthyVerdict(verdict) ? "PROVEN_VULNERABLE" : "PROVEN_BLOCKED";
}

const CONFIRMED_PROOF_LEVELS: ReadonlySet<BusinessFindingProofLevel> = new Set(["CONFIRMED", "SAFE_PROBE_CONFIRMED"]);

/**
 * A business-logic candidate's PROVEN_VULNERABLE is gated on its proof
 * level actually reaching CONFIRMED/SAFE_PROBE_CONFIRMED — an
 * OBSERVED/INFERRED hypothesis, even one where a real contradiction was
 * detected, is never shown as PROVEN_VULNERABLE (design.md's OBSERVED/
 * INFERRED-never-CONFIRMED distinction, Section 13.20).
 */
export function evidentiaryOutcomeForBusinessProofLevel(proofLevel: BusinessFindingProofLevel, violationDetected: boolean): EvidentiaryOutcome {
  if (proofLevel === "NOT_TESTED") return "NOT_TESTED";
  if (proofLevel === "INCONCLUSIVE") return "INCONCLUSIVE";
  if (!violationDetected) return "PROVEN_BLOCKED";
  return CONFIRMED_PROOF_LEVELS.has(proofLevel) ? "PROVEN_VULNERABLE" : "INCONCLUSIVE";
}
