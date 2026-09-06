import type { Candidate } from "../scanners/security-scanner";
import type { DiscoveredOperation } from "../operation-discovery/discovered-operation";
import type { BusinessInvariant } from "./invariant-engine";

/**
 * Every business-logic operation's mandatory safety classification
 * (Section 13.19 owns the classification logic that *produces* one of
 * these — this type is the shared vocabulary, matching
 * `business_test_plans.safety_classification`'s CHECK constraint exactly).
 */
export type BusinessSafetyClassification = "PASSIVE" | "SAFE_READ" | "SAFE_REVERSIBLE_MUTATION" | "SENSITIVE" | "FINANCIAL" | "DESTRUCTIVE";

/**
 * A Business Logic Test Plan (Section 13.18, `business_test_plans`):
 * links a business candidate, the operation used to test it, and the
 * invariant hypothesis into one reproducible unit. `preconditions`,
 * `expectedBehavior`, `safeValidation`, and `cleanup` are always derived
 * directly from the linked candidate/operation/invariant and safety
 * classification — never separately authored free text that could drift
 * from what those already say.
 */
export interface BusinessTestPlan {
  candidate: Candidate;
  operation: DiscoveredOperation;
  invariant: BusinessInvariant;
  safetyClassification: BusinessSafetyClassification;
  preconditions: string;
  expectedBehavior: string;
  safeValidation: string;
  cleanup: string;
}

function describeSafeValidation(classification: BusinessSafetyClassification): string {
  switch (classification) {
    case "PASSIVE":
    case "SAFE_READ":
      return "Read-only verification — no mutation is performed.";
    case "SAFE_REVERSIBLE_MUTATION":
      return "Backup -> mutate -> verify -> restore -> restore-verify via the shared mutation cycle (Section 9).";
    case "SENSITIVE":
    case "FINANCIAL":
      return "Never auto-executed against a real target — LOCAL_FIXTURE Test Capability only (Section 9.13).";
    case "DESTRUCTIVE":
      return "Never executed, in any mode, against any target.";
  }
}

function describeCleanup(classification: BusinessSafetyClassification): string {
  switch (classification) {
    case "PASSIVE":
    case "SAFE_READ":
      return "None needed — no state was changed.";
    case "SAFE_REVERSIBLE_MUTATION":
      return "Automatic restore via the Restore Engine, verified against the pre-mutation backup.";
    case "SENSITIVE":
    case "FINANCIAL":
      return "N/A — never mutated outside the LOCAL_FIXTURE Test Capability.";
    case "DESTRUCTIVE":
      return "N/A — never executed.";
  }
}

export function buildBusinessTestPlan(
  candidate: Candidate,
  operation: DiscoveredOperation,
  invariant: BusinessInvariant,
  safetyClassification: BusinessSafetyClassification,
): BusinessTestPlan {
  return {
    candidate,
    operation,
    invariant,
    safetyClassification,
    preconditions: `Object of type "${invariant.objectType}" reachable via ${operation.method} ${operation.url}, matching candidate #${candidate.id}'s resource (${candidate.resourceKey.objectType}/${candidate.resourceKey.resourceId}).`,
    expectedBehavior: `Invariant "${invariant.name}": its condition must evaluate to ${String(invariant.expected)} against the observed post-operation state, or it is a violation.`,
    safeValidation: describeSafeValidation(safetyClassification),
    cleanup: describeCleanup(safetyClassification),
  };
}
