import type { TargetEnvironmentClassification } from "../mutation/scan-run-environment";

export interface WorkflowStep {
  objectType: string;
  operation: string;
  requiredBefore?: string;
}

export type SequenceBypassTestOutcome = { status: "TESTED"; bypassPossible: boolean } | { status: "SKIPPED_NOT_LOCAL_FIXTURE" };

export interface SequenceBypassTestParams {
  step: WorkflowStep;
  targetEnvironment: TargetEnvironmentClassification;
  /** True for anything with real financial/destructive impact — such a skip-test is only ever actually attempted against a LOCAL_FIXTURE target. */
  hasRealImpact: boolean;
  /** Attempts `step.operation` while deliberately never having performed `step.requiredBefore` — never invoked when the environment gate refuses it. */
  attemptStepSkippingPrerequisite: () => Promise<{ succeeded: boolean }>;
}

/**
 * Workflow/Sequence Bypass testing (Section 13.7): detects whether a
 * required prior step in a multi-step workflow (e.g. "purchase before
 * pay") can be skipped entirely. Mirrors the same environment gate as
 * `testStateTransition` (Section 13.6) — anything with real
 * financial/destructive impact is only ever actually attempted against a
 * LOCAL_FIXTURE target; on any other target, `attemptStepSkippingPrerequisite`
 * is never called and the test is classified SKIPPED_NOT_LOCAL_FIXTURE.
 */
export async function testSequenceBypass(params: SequenceBypassTestParams): Promise<SequenceBypassTestOutcome> {
  if (params.hasRealImpact && params.targetEnvironment !== "LOCAL_FIXTURE") {
    return { status: "SKIPPED_NOT_LOCAL_FIXTURE" };
  }
  const result = await params.attemptStepSkippingPrerequisite();
  return { status: "TESTED", bypassPossible: result.succeeded };
}
