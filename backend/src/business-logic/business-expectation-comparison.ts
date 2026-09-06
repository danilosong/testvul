import type { Db } from "../db/connection";
import { getBusinessExpectations } from "./business-expectations-repository";
import { evaluateCondition } from "./rule-engine";

export type BusinessExpectationComparisonResult = "CONTRADICTION" | "MATCH" | "INCONCLUSIVE_BUSINESS_EXPECTATION";

export interface CompareObservationParams {
  db: Db;
  targetId: number;
  objectType: string;
  propertyOrAction: string;
  observedValue: unknown;
  /** The object's current field state — evaluated against any configured `lifecycleCondition`. */
  currentObjectState: Record<string, unknown>;
}

/**
 * The single comparison function (design.md Decision 41) joining
 * `business_observed_properties` and `business_expectations` on
 * (objectType, property/action) — the *only* place the two ever meet.
 * Neither table has any default-population path from the other; an
 * unconfigured expectation is simply an absent row, which this join
 * treats as INCONCLUSIVE_BUSINESS_EXPECTATION rather than inventing a
 * verdict. When a `lifecycleCondition` is present, it must currently hold
 * against `currentObjectState` for that expectation to apply at all.
 */
export function compareObservationAgainstExpectation(params: CompareObservationParams): BusinessExpectationComparisonResult {
  const expectations = getBusinessExpectations(params.db, params.targetId, params.objectType, params.propertyOrAction);

  const applicable = expectations.filter(
    (expectation) => expectation.lifecycleCondition === undefined || evaluateCondition(expectation.lifecycleCondition, params.currentObjectState),
  );

  if (applicable.length === 0) return "INCONCLUSIVE_BUSINESS_EXPECTATION";

  const observedAsString = String(params.observedValue);
  const contradicts = applicable.some((expectation) => expectation.expectedValue !== observedAsString);
  return contradicts ? "CONTRADICTION" : "MATCH";
}
