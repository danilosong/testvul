import type { TargetEnvironmentClassification } from "../mutation/scan-run-environment";

/**
 * Replay and Idempotency Analysis (Section 13.13). Real financial/sensitive
 * operations against a live (non-fixture) target default to
 * PASSIVE/INCONCLUSIVE — an operation is only ever actually replayed
 * against a target whose Environment Classification is LOCAL_FIXTURE.
 */
export interface ReplayAnalysis {
  operation: string;
  originalResult: unknown;
  replayResult: unknown;
  expectedIdempotent: boolean;
}

export type IdempotencyMechanism = "IDEMPOTENCY_KEY_HEADER" | "REQUEST_ID_HEADER" | "NONCE_FIELD" | "NONE_DETECTED";

/** Detects what idempotency mechanism (if any) the operation's own request advertised — never a guess about server-side behavior. */
export function detectIdempotencyMechanism(requestHeaders: Readonly<Record<string, string>>, bodyFieldNames: readonly string[] = []): IdempotencyMechanism {
  const lowerHeaderNames = Object.keys(requestHeaders).map((header) => header.toLowerCase());
  if (lowerHeaderNames.includes("idempotency-key")) return "IDEMPOTENCY_KEY_HEADER";
  if (lowerHeaderNames.includes("x-request-id") || lowerHeaderNames.includes("request-id")) return "REQUEST_ID_HEADER";
  if (bodyFieldNames.some((field) => /nonce/i.test(field))) return "NONCE_FIELD";
  return "NONE_DETECTED";
}

export interface ReplayComparisonResult {
  /** Whether the original and replayed results are structurally identical. */
  consistent: boolean;
  /** Raised only when the operation was expected to be idempotent but the replay produced a different (i.e. duplicated-effect) result. */
  finding: boolean;
}

export function compareReplayResults(analysis: ReplayAnalysis): ReplayComparisonResult {
  const consistent = JSON.stringify(analysis.originalResult) === JSON.stringify(analysis.replayResult);
  return { consistent, finding: analysis.expectedIdempotent && !consistent };
}

export type ReplayTestOutcome =
  | { status: "TESTED"; analysis: ReplayAnalysis; comparison: ReplayComparisonResult }
  | { status: "SKIPPED_NOT_LOCAL_FIXTURE" };

export interface ReplayTestParams {
  operation: string;
  targetEnvironment: TargetEnvironmentClassification;
  isFinancialOrSensitive: boolean;
  expectedIdempotent: boolean;
  /** Performs the operation once and returns its result; called exactly twice (original, then replay) when the gate allows it. */
  performOperation: () => Promise<unknown>;
}

/**
 * A FINANCIAL/SENSITIVE candidate is never actually replayed against
 * anything but a LOCAL_FIXTURE target — `performOperation` is never
 * invoked when the gate blocks, so no real financial/sensitive operation
 * can be executed even once, let alone replayed.
 */
export async function testReplay(params: ReplayTestParams): Promise<ReplayTestOutcome> {
  if (params.isFinancialOrSensitive && params.targetEnvironment !== "LOCAL_FIXTURE") {
    return { status: "SKIPPED_NOT_LOCAL_FIXTURE" };
  }
  const originalResult = await params.performOperation();
  const replayResult = await params.performOperation();
  const analysis: ReplayAnalysis = { operation: params.operation, originalResult, replayResult, expectedIdempotent: params.expectedIdempotent };
  return { status: "TESTED", analysis, comparison: compareReplayResults(analysis) };
}
