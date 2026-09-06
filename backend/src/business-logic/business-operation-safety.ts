import type { TargetEnvironmentClassification } from "../mutation/scan-run-environment";
import type { MutationCycleResult } from "../mutation/mutation-cycle";
import type { BusinessSafetyClassification } from "./business-test-plan";

/**
 * The mandatory safety classification for every business-logic operation
 * (Section 13.19). DESTRUCTIVE takes unconditional precedence — no softer
 * signal below it can ever downgrade a destructive operation (mirrors
 * Section 12.16's Destructive Action Denylist precedence).
 */
export interface BusinessSafetyClassificationInput {
  isDestructive: boolean;
  performsMutation: boolean;
  /** False only for a pure inference with no HTTP call of its own (e.g. Section 13.11's cross-response inference, which reuses already-collected responses). */
  issuesRequest: boolean;
  /** Touches a field on the Sensitive Field Denylist's financial-shaped subset (balance/payment/price/credit/withdrawal/prize) or an inherently financial operation. */
  isFinancialField: boolean;
  /** Sensitive but not specifically financial (e.g. a role/permission change). */
  isSensitiveField: boolean;
}

export function classifyBusinessOperationSafety(input: BusinessSafetyClassificationInput): BusinessSafetyClassification {
  if (input.isDestructive) return "DESTRUCTIVE";
  if (!input.performsMutation) return input.issuesRequest ? "SAFE_READ" : "PASSIVE";
  if (input.isFinancialField) return "FINANCIAL";
  if (input.isSensitiveField) return "SENSITIVE";
  return "SAFE_REVERSIBLE_MUTATION";
}

export type BusinessOperationExecutionResult =
  | { status: "EXECUTED_READ_ONLY"; result: unknown }
  | { status: "EXECUTED_VIA_MUTATION_CYCLE"; result: MutationCycleResult }
  | { status: "SKIPPED_NOT_LOCAL_FIXTURE" }
  | { status: "NEVER_EXECUTED" };

export interface ExecuteBusinessOperationParams {
  classification: BusinessSafetyClassification;
  targetEnvironment: TargetEnvironmentClassification;
  /** Required for PASSIVE/SAFE_READ. */
  performReadOnly?: () => Promise<unknown>;
  /**
   * Required for SAFE_REVERSIBLE_MUTATION/SENSITIVE/FINANCIAL — must itself
   * call `runMutationTestCycle` (Section 9's shared backup → mutate →
   * verify → restore service), so a SAFE_REVERSIBLE_MUTATION business
   * operation goes through the identical confirmed-mutation-authorization,
   * Mutation Scope Enforcement (TEST_RESOURCE), Reversibility-Must-Be-
   * Proven, resource-lock, and Recovery Journal chain as any other
   * scanner's mutation — never a bypassing, business-logic-specific path.
   */
  performViaMutationCycle?: () => Promise<MutationCycleResult>;
}

/**
 * Routes a classified business-logic operation to execution — or refuses
 * to execute it at all. DESTRUCTIVE is never executed, in any mode, on
 * any target. SENSITIVE/FINANCIAL are never auto-executed against
 * anything but a LOCAL_FIXTURE target. SAFE_REVERSIBLE_MUTATION always
 * executes through the real mutation cycle, which independently proves
 * authorization/scope/reversibility before ever mutating anything — this
 * function never re-implements or shortcuts those checks itself.
 */
export async function executeBusinessOperation(params: ExecuteBusinessOperationParams): Promise<BusinessOperationExecutionResult> {
  if (params.classification === "DESTRUCTIVE") return { status: "NEVER_EXECUTED" };

  if (params.classification === "PASSIVE" || params.classification === "SAFE_READ") {
    if (!params.performReadOnly) throw new Error(`performReadOnly is required for classification "${params.classification}"`);
    return { status: "EXECUTED_READ_ONLY", result: await params.performReadOnly() };
  }

  if ((params.classification === "SENSITIVE" || params.classification === "FINANCIAL") && params.targetEnvironment !== "LOCAL_FIXTURE") {
    return { status: "SKIPPED_NOT_LOCAL_FIXTURE" };
  }

  if (!params.performViaMutationCycle) throw new Error(`performViaMutationCycle is required for classification "${params.classification}"`);
  return { status: "EXECUTED_VIA_MUTATION_CYCLE", result: await params.performViaMutationCycle() };
}
