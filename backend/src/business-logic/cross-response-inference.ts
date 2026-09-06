import type { Db } from "../db/connection";
import { recordObservedProperty } from "./business-observed-properties-repository";

export interface RecordCrossResponseInferenceParams {
  db: Db;
  scanRunId: number;
  objectType: string;
  /** The business-state property that combining the source responses lets an observer infer, even though no single response reveals it. */
  inferredProperty: string;
  /** The separately-innocuous fields/locations that were combined to reach the inference — recorded for evidentiary context only. */
  combinedFrom: string[];
}

/**
 * Cross-Response Information Combination Analysis (Section 13.11):
 * records that combining several individually-innocuous responses lets an
 * observer infer a business-state property, as a
 * POTENTIAL_BUSINESS_STATE_INFERENCE `ObservedProperty` (Section 13.2).
 * Deliberately never compares this against a `BusinessExpectation` and
 * never raises a finding — an inference like this always needs a human
 * to judge real-world exploitability before it can be escalated, so this
 * function has no code path capable of auto-escalating one into a
 * confirmed finding.
 */
export function recordCrossResponseInference(params: RecordCrossResponseInferenceParams): void {
  recordObservedProperty(params.db, {
    scanRunId: params.scanRunId,
    objectType: params.objectType,
    propertyOrAction: params.inferredProperty,
    observedValue: { classification: "POTENTIAL_BUSINESS_STATE_INFERENCE", combinedFrom: params.combinedFrom },
  });
}
