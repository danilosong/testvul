import type { Db } from "../db/connection";
import type { TargetEnvironmentClassification } from "../mutation/scan-run-environment";
import { recordParameterClassification, type ParameterControl } from "./parameter-analyzer";
import { compareObservationAgainstExpectation, type BusinessExpectationComparisonResult } from "./business-expectation-comparison";

export interface ServerControlledFieldValidationParams {
  db: Db;
  scanRunId: number;
  targetId: number;
  objectType: string;
  fieldName: string;
  targetEnvironment: TargetEnvironmentClassification;
  /** True for a financial/dangerous field (e.g. `winningNumber`) — the actual mutating probe is only ever attempted against a LOCAL_FIXTURE target. */
  isFinancialOrDangerous: boolean;
  /** The object's current field state — evaluated against any configured `lifecycleCondition`. */
  currentObjectState: Record<string, unknown>;
  /** Attempts a real write with a client-supplied value and reports what the server actually persisted — never invoked for a financial/dangerous field outside a LOCAL_FIXTURE target. */
  attemptMutatingProbe: () => Promise<{ attemptedValue: unknown; resultingValue: unknown }>;
}

export type ServerControlledFieldValidationOutcome =
  | { status: "VALIDATED"; control: ParameterControl; comparison: BusinessExpectationComparisonResult; finding: boolean }
  | { status: "SKIPPED_NOT_LOCAL_FIXTURE" };

/**
 * Server-Controlled Field Validation (Section 13.9): a financial/dangerous
 * field's authority is only ever actually probed with a real mutation
 * against a LOCAL_FIXTURE target — on any other target,
 * `attemptMutatingProbe` is never invoked and the field is left
 * untouched. The resulting `ParameterControl` (Section 13.8) is recorded
 * as an `ObservedProperty` and compared against any configured AUTHORITY
 * `BusinessExpectation` (design.md Decision 41 — the only place the two
 * ever meet) — a SERVER_CONTROLLED_FIELD finding is raised only on an
 * explicit CONTRADICTION; an unconfigured expectation is
 * INCONCLUSIVE_BUSINESS_EXPECTATION, never a finding.
 */
export async function validateServerControlledField(params: ServerControlledFieldValidationParams): Promise<ServerControlledFieldValidationOutcome> {
  if (params.isFinancialOrDangerous && params.targetEnvironment !== "LOCAL_FIXTURE") {
    return { status: "SKIPPED_NOT_LOCAL_FIXTURE" };
  }

  const { attemptedValue, resultingValue } = await params.attemptMutatingProbe();
  const control = recordParameterClassification(params.db, params.scanRunId, params.objectType, params.fieldName, attemptedValue, resultingValue);

  const comparison = compareObservationAgainstExpectation({
    db: params.db,
    targetId: params.targetId,
    objectType: params.objectType,
    propertyOrAction: `${params.fieldName}.control`,
    observedValue: control,
    currentObjectState: params.currentObjectState,
  });

  return { status: "VALIDATED", control, comparison, finding: comparison === "CONTRADICTION" };
}
