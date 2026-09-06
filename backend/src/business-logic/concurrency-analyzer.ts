import type { TargetEnvironmentClassification } from "../mutation/scan-run-environment";
import type { MutationScopeClassification } from "../mutation/mutation-scope";

/**
 * Concurrency/Race-Condition testing (Section 13.14). Runs at a low,
 * configurable concurrency (default 2 — this is a race-condition probe,
 * never load testing). A TOCTOU (check-then-use) bug — two concurrent
 * callers each checking a precondition then acting on it without proper
 * locking — surfaces here as `duplicateResourceDetected`: several
 * concurrent attempts landing on the same resource identity that should
 * have been assigned uniquely.
 */
export interface ConcurrencyTestResult {
  objectType: string;
  concurrency: number;
  duplicateResourceDetected: boolean;
}

const DEFAULT_CONCURRENCY = 2;

export interface RunConcurrencyTestParams {
  objectType: string;
  /** Defaults to 2. Never raise this for load-testing purposes — it exists solely to expose a race window, not to stress the target. */
  concurrency?: number;
  /** Performs one concurrent attempt and returns the value that should identify the resulting resource uniquely (e.g. an assigned ticket number); invoked `concurrency` times in parallel. */
  performConcurrentAttempt: () => Promise<unknown>;
}

export async function runConcurrencyTest(params: RunConcurrencyTestParams): Promise<ConcurrencyTestResult> {
  const concurrency = params.concurrency ?? DEFAULT_CONCURRENCY;
  const results = await Promise.all(Array.from({ length: concurrency }, () => params.performConcurrentAttempt()));
  const serializedIdentities = results.map((result) => JSON.stringify(result));
  const uniqueCount = new Set(serializedIdentities).size;
  return { objectType: params.objectType, concurrency, duplicateResourceDetected: uniqueCount < serializedIdentities.length };
}

export type ConcurrencyGateOutcome = "TESTED" | "INCONCLUSIVE" | "NOT_TESTED";

export interface ConcurrencyGateParams {
  targetEnvironment: TargetEnvironmentClassification;
  /** Ignored when `targetEnvironment` is LOCAL_FIXTURE — required for every other target. */
  scopeClassification: MutationScopeClassification;
  confirmedMutationAuthorization: boolean;
  hasKnownCleanupStrategy: boolean;
}

/**
 * Against a non-fixture (real) target, concurrent mutation is gated on the
 * resource being an explicit TEST_RESOURCE (Section 9.12) AND confirmed
 * mutation authorization AND a known cleanup/recovery strategy. Missing
 * TEST_RESOURCE status or authorization excludes the candidate outright
 * (NOT_TESTED); having both but no known cleanup/recovery strategy means
 * the candidate could in principle be tested but isn't, for lack of a safe
 * way to recover afterward (INCONCLUSIVE). A LOCAL_FIXTURE target needs
 * none of this — it is always eligible.
 */
export function evaluateConcurrencyGate(params: ConcurrencyGateParams): ConcurrencyGateOutcome {
  if (params.targetEnvironment === "LOCAL_FIXTURE") return "TESTED";
  if (params.scopeClassification !== "TEST_RESOURCE") return "NOT_TESTED";
  if (!params.confirmedMutationAuthorization) return "NOT_TESTED";
  if (!params.hasKnownCleanupStrategy) return "INCONCLUSIVE";
  return "TESTED";
}

export type ConcurrencyTestOutcome = { status: "TESTED"; result: ConcurrencyTestResult } | { status: "INCONCLUSIVE" } | { status: "NOT_TESTED" };

export async function testConcurrency(params: ConcurrencyGateParams & RunConcurrencyTestParams): Promise<ConcurrencyTestOutcome> {
  const gate = evaluateConcurrencyGate(params);
  if (gate !== "TESTED") return { status: gate };
  const result = await runConcurrencyTest(params);
  return { status: "TESTED", result };
}
