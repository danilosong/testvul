import type { Db } from "../db/connection";
import type { ResourceKey } from "../mutation/resource-key";
import { isDenylistedField } from "../mutation/sensitive-field-denylist";
import { classifyMutationScope } from "../mutation/mutation-scope";
import { assessReversibility } from "../mutation/reversibility";
import { hasEligibleOperation, type DiscoveredOperation, type OperationConfidence } from "../operation-discovery/discovered-operation";

export type EligibilityState =
  | "TESTABLE"
  | "PASSIVE_ONLY"
  | "SKIPPED_NO_WRITE_TEMPLATE"
  | "SKIPPED_NO_AUTH"
  | "SKIPPED_NO_OWNERSHIP_DATA"
  | "SKIPPED_SENSITIVE_RESOURCE"
  | "SKIPPED_OUT_OF_SCOPE"
  | "SKIPPED_NON_TEST_RESOURCE"
  | "SKIPPED_REVERSIBILITY_NOT_PROVEN"
  | "SKIPPED_ENVIRONMENT_POLICY"
  | "INCONCLUSIVE"
  /** Produced only by business-logic-specific classification (Section 10.5) — never by classifyEligibility itself. */
  | "INCONCLUSIVE_BUSINESS_EXPECTATION"
  | "INCONCLUSIVE_TRUST_BOUNDARY";

export interface EligibilityCandidateInput {
  db: Db;
  resourceKey: ResourceKey;
  resourceUrl: string;
  writeMethod: string;
  /** Absent for a candidate with no single field-level target. */
  fieldPath?: string;
  operations: readonly DiscoveredOperation[];
  minConfidence: OperationConfidence;
  /** True for a candidate whose security test is inherently read-only and never needs a mutation to complete. */
  isPassiveTest: boolean;
  inScope: boolean;
  hasRequiredAuth: boolean;
  /** True only for an authorization-style test (e.g. IDOR) that needs configured ownership data to compare against. */
  requiresOwnershipData: boolean;
  hasOwnershipData: boolean;
  advancedOverrideConfirmed: boolean;
  environmentPolicyAllows: boolean;
  /** The LOCAL_FIXTURE Test Capability (Section 9.13) — true only under the test/build harness against a LOCAL_FIXTURE target. */
  localFixtureDenylistOverrideActive: boolean;
  /** Set when the caller could not cleanly determine one of the above (e.g. malformed candidate data) — forces INCONCLUSIVE rather than a guess. */
  undetermined?: boolean;
}

/**
 * Classifies a candidate into exactly one `EligibilityState`, computed
 * synchronously at candidate-generation time (spec requirement in
 * `candidate-eligibility`). Reuses the same subsystems the shared mutation
 * entry point (`runMutationTestCycle`) itself enforces at execution time —
 * the sensitive-field denylist, Mutation Scope Enforcement, and
 * Reversibility-Must-Be-Proven — so a candidate's *predicted* eligibility
 * here can never drift from what would actually happen if it were run.
 */
export function classifyEligibility(input: EligibilityCandidateInput): EligibilityState {
  if (input.undetermined) return "INCONCLUSIVE";
  if (!input.inScope) return "SKIPPED_OUT_OF_SCOPE";
  if (input.isPassiveTest) return "PASSIVE_ONLY";

  if (input.fieldPath !== undefined && isDenylistedField(input.fieldPath) && !input.localFixtureDenylistOverrideActive) {
    return "SKIPPED_SENSITIVE_RESOURCE";
  }

  if (!input.hasRequiredAuth) return "SKIPPED_NO_AUTH";
  if (input.requiresOwnershipData && !input.hasOwnershipData) return "SKIPPED_NO_OWNERSHIP_DATA";

  if (!hasEligibleOperation(input.operations, input.writeMethod, input.resourceUrl, input.minConfidence)) {
    return "SKIPPED_NO_WRITE_TEMPLATE";
  }

  const scopeClassification = classifyMutationScope(input.db, input.resourceKey);
  if (scopeClassification !== "TEST_RESOURCE" && !input.advancedOverrideConfirmed) {
    return "SKIPPED_NON_TEST_RESOURCE";
  }

  const reversibility = assessReversibility({
    db: input.db,
    resourceKey: input.resourceKey,
    operations: input.operations,
    resourceUrl: input.resourceUrl,
    writeMethod: input.writeMethod,
    minConfidence: input.minConfidence,
  });
  if (!reversibility.proven) return "SKIPPED_REVERSIBILITY_NOT_PROVEN";

  if (!input.environmentPolicyAllows) return "SKIPPED_ENVIRONMENT_POLICY";

  return "TESTABLE";
}

/** The Security Test Queue (Section 14) only ever admits TESTABLE candidates — every other state (SKIPPED_* or INCONCLUSIVE) is excluded by construction. */
export function isQueueable(state: EligibilityState): boolean {
  return state === "TESTABLE";
}
