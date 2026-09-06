import type { Db } from "../db/connection";
import { recordObservedProperty } from "./business-observed-properties-repository";

export type ParameterControl = "SERVER_CONTROLLED" | "CLIENT_CONTROLLED" | "UNKNOWN";

/**
 * Parameter Classification (Section 13.8): classifies a business-relevant
 * parameter as SERVER_CONTROLLED, CLIENT_CONTROLLED, or UNKNOWN — purely
 * from a mechanical comparison of an attempted client-supplied value
 * against what the server actually returned/persisted for that field,
 * never from the field's name alone (an ObservedProperty records only
 * what the engine mechanically determined, per design.md Decision 41).
 * UNKNOWN when no attempted value exists to compare against.
 */
export function classifyParameterControl(attemptedValue: unknown, resultingValue: unknown): ParameterControl {
  if (attemptedValue === undefined) return "UNKNOWN";
  return JSON.stringify(attemptedValue) === JSON.stringify(resultingValue) ? "CLIENT_CONTROLLED" : "SERVER_CONTROLLED";
}

/**
 * Classifies and persists the classification as an `ObservedProperty`
 * (Section 13.2), so later coverage/report code can read `"<field>.control"`
 * the same way it reads any other observed fact.
 */
export function recordParameterClassification(
  db: Db,
  scanRunId: number,
  objectType: string,
  fieldName: string,
  attemptedValue: unknown,
  resultingValue: unknown,
  evidenceId?: number,
): ParameterControl {
  const control = classifyParameterControl(attemptedValue, resultingValue);
  recordObservedProperty(db, {
    scanRunId,
    objectType,
    propertyOrAction: `${fieldName}.control`,
    observedValue: control,
    ...(evidenceId !== undefined ? { evidenceId } : {}),
  });
  return control;
}
