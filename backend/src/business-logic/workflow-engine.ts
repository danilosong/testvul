import type { TargetEnvironmentClassification } from "../mutation/scan-run-environment";

export interface StateTransition {
  objectType: string;
  from: string;
  to: string;
  operation: string;
  profile: string;
  expectedAllowed: boolean;
}

export type StateTransitionTestOutcome = { status: "TESTED"; allowed: boolean } | { status: "SKIPPED_NOT_LOCAL_FIXTURE" };

export interface StateTransitionTestParams {
  transition: StateTransition;
  targetEnvironment: TargetEnvironmentClassification;
  /** True for anything with real financial/destructive impact — such a transition is only ever actually attempted against a LOCAL_FIXTURE target. */
  hasRealImpact: boolean;
  /** The actual probe/mutation that attempts the transition — never invoked when the environment gate refuses it. */
  performTransition: () => Promise<{ succeeded: boolean }>;
}

/**
 * `StateTransition` representation and transition testing (Section 13.6):
 * for anything with real financial/destructive impact, the actual
 * transition is only ever attempted against a target whose Environment
 * Classification is LOCAL_FIXTURE — on any other target, `performTransition`
 * is never called at all, and the transition is classified
 * SKIPPED_NOT_LOCAL_FIXTURE instead of being guessed at. A transition
 * without real impact (a safe/reversible probe) may still be tested on a
 * real target.
 */
export async function testStateTransition(params: StateTransitionTestParams): Promise<StateTransitionTestOutcome> {
  if (params.hasRealImpact && params.targetEnvironment !== "LOCAL_FIXTURE") {
    return { status: "SKIPPED_NOT_LOCAL_FIXTURE" };
  }
  const result = await params.performTransition();
  return { status: "TESTED", allowed: result.succeeded };
}
