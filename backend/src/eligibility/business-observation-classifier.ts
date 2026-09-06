import type { Db } from "../db/connection";

export interface ObservedPropertyKey {
  targetId: number;
  objectType: string;
  propertyOrAction: string;
}

/**
 * True when a configured `BusinessExpectation` exists to compare this
 * observation against. Per design.md Decision 41, `business_observed_properties`
 * and `business_expectations` are joined only here, at evaluation time —
 * there is no code path that derives or defaults an expectation from an
 * observation.
 */
export function hasMatchingBusinessExpectation(db: Db, key: ObservedPropertyKey): boolean {
  const row = db
    .prepare("SELECT 1 FROM business_expectations WHERE target_id = ? AND object_type = ? AND property_or_action = ? LIMIT 1")
    .get(key.targetId, key.objectType, key.propertyOrAction);
  return row !== undefined;
}

/**
 * Classifies an observed property per `candidate-eligibility`'s
 * business-logic-specific state: an observation with no matching
 * `BusinessExpectation` configured is INCONCLUSIVE_BUSINESS_EXPECTATION —
 * never silently omitted, and never treated as a finding — rather than
 * TESTABLE (Section 13 owns the actual comparison/finding logic once a
 * match exists).
 */
export function classifyBusinessObservation(db: Db, key: ObservedPropertyKey): "INCONCLUSIVE_BUSINESS_EXPECTATION" | "TESTABLE" {
  return hasMatchingBusinessExpectation(db, key) ? "TESTABLE" : "INCONCLUSIVE_BUSINESS_EXPECTATION";
}
