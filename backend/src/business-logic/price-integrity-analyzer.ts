import type { TargetEnvironmentClassification } from "../mutation/scan-run-environment";
import { isDenylistedField } from "../mutation/sensitive-field-denylist";
import { classifyParameterControl, type ParameterControl } from "./parameter-analyzer";

export type MutationGateOutcome = "MUTATION_ALLOWED" | "VALIDATION_PROBE_ONLY";

export interface SensitiveFieldMutationGateParams {
  fieldPath: string;
  targetEnvironment: TargetEnvironmentClassification;
  localFixtureTestCapabilityEnabled: boolean;
}

/**
 * price/amount-shaped fields are on the Sensitive Field Denylist (Section
 * 9.6, `isDenylistedField`) — any actual mutation of one is restricted to
 * a LOCAL_FIXTURE target reached through the LOCAL_FIXTURE Test Capability
 * (Section 9.13). Every other combination gets only a non-mutating
 * validation probe. A non-denylisted field (an ordinary "quantity" field)
 * is always MUTATION_ALLOWED here — `runMutationTestCycle`'s own denylist
 * check (Section 9.6) is the real enforcement point; this gate exists so a
 * caller never even attempts a mutating call it already knows would be
 * refused.
 */
export function evaluateSensitiveFieldMutationGate(params: SensitiveFieldMutationGateParams): MutationGateOutcome {
  if (!isDenylistedField(params.fieldPath)) return "MUTATION_ALLOWED";
  if (params.targetEnvironment === "LOCAL_FIXTURE" && params.localFixtureTestCapabilityEnabled) return "MUTATION_ALLOWED";
  return "VALIDATION_PROBE_ONLY";
}

// ── Price/Amount Integrity testing (server-recalculation verification) ──

export interface PriceIntegrityResult {
  control: ParameterControl;
  /** Raised when the server simply echoed back the client-supplied price/amount instead of recalculating it independently. */
  finding: boolean;
}

export function analyzePriceIntegrity(clientSuppliedValue: unknown, resultingValue: unknown): PriceIntegrityResult {
  const control = classifyParameterControl(clientSuppliedValue, resultingValue);
  return { control, finding: control === "CLIENT_CONTROLLED" };
}

export type PriceIntegrityTestOutcome = { status: "TESTED"; result: PriceIntegrityResult } | { status: "VALIDATION_PROBE_ONLY" };

export interface TestPriceIntegrityParams extends SensitiveFieldMutationGateParams {
  clientSuppliedValue: unknown;
  /** Performs the actual mutating write (via `runMutationTestCycle`) and returns the resulting stored/returned value; never invoked when the gate blocks. */
  performMutationAndReadResult: () => Promise<unknown>;
}

export async function testPriceIntegrity(params: TestPriceIntegrityParams): Promise<PriceIntegrityTestOutcome> {
  const gate = evaluateSensitiveFieldMutationGate(params);
  if (gate === "VALIDATION_PROBE_ONLY") return { status: "VALIDATION_PROBE_ONLY" };
  const resultingValue = await params.performMutationAndReadResult();
  return { status: "TESTED", result: analyzePriceIntegrity(params.clientSuppliedValue, resultingValue) };
}

// ── Quantity Boundary testing (0/negative/max/max+1) ─────────────────────

export type QuantityBoundary = "ZERO" | "NEGATIVE" | "MAX" | "MAX_PLUS_ONE";

export interface QuantityBoundaryProbe {
  boundary: QuantityBoundary;
  value: number;
}

export function buildQuantityBoundaryProbes(max: number): QuantityBoundaryProbe[] {
  return [
    { boundary: "ZERO", value: 0 },
    { boundary: "NEGATIVE", value: -1 },
    { boundary: "MAX", value: max },
    { boundary: "MAX_PLUS_ONE", value: max + 1 },
  ];
}

export interface QuantityBoundaryOutcome extends QuantityBoundaryProbe {
  accepted: boolean;
}

/** A finding is raised only for an out-of-range boundary (ZERO/NEGATIVE/MAX_PLUS_ONE) the server actually accepted — MAX itself is expected to succeed and is never itself a finding. */
export function evaluateQuantityBoundaryFinding(outcomes: readonly QuantityBoundaryOutcome[]): boolean {
  return outcomes.some((outcome) => outcome.boundary !== "MAX" && outcome.accepted);
}

export type QuantityBoundaryTestOutcome =
  | { status: "TESTED"; outcomes: QuantityBoundaryOutcome[]; finding: boolean }
  | { status: "VALIDATION_PROBE_ONLY" };

export interface TestQuantityBoundariesParams extends SensitiveFieldMutationGateParams {
  max: number;
  /** Performs one boundary mutation attempt and reports whether the target accepted it. */
  performBoundaryAttempt: (value: number) => Promise<{ accepted: boolean }>;
}

export async function testQuantityBoundaries(params: TestQuantityBoundariesParams): Promise<QuantityBoundaryTestOutcome> {
  const gate = evaluateSensitiveFieldMutationGate(params);
  if (gate === "VALIDATION_PROBE_ONLY") return { status: "VALIDATION_PROBE_ONLY" };

  const outcomes: QuantityBoundaryOutcome[] = [];
  for (const probe of buildQuantityBoundaryProbes(params.max)) {
    const { accepted } = await params.performBoundaryAttempt(probe.value);
    outcomes.push({ ...probe, accepted });
  }
  return { status: "TESTED", outcomes, finding: evaluateQuantityBoundaryFinding(outcomes) };
}
