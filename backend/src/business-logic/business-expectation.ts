import type { Condition } from "./rule-engine";

export type BusinessExpectationType =
  | "AUTHORITY"
  | "VISIBILITY"
  | "MUTABILITY"
  | "STATE_ELIGIBILITY"
  | "MAX_LIMIT"
  | "ROLE_PERMISSION"
  | "REQUIRES_PREVIOUS_STATE"
  | "CONFIDENTIAL_UNTIL_STATE";

export type BusinessSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface BusinessExpectationInput {
  targetId: number;
  objectType: string;
  propertyOrAction: string;
  expectationType: BusinessExpectationType;
  expectedValue: string;
  /** `unknown` deliberately — this arrives as parsed JSON from an operator-facing API and is validated (not merely type-asserted) before it is ever stored, per design.md Decision 50. */
  lifecycleCondition?: unknown;
  severity: BusinessSeverity;
}

export interface BusinessExpectation extends Omit<BusinessExpectationInput, "lifecycleCondition"> {
  id: number;
  /** Validated on the way in — always a real `Condition` (or absent) once read back. */
  lifecycleCondition?: Condition;
}
