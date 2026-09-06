import { evaluateCondition, type Condition } from "./rule-engine";

export type BusinessInvariantSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * The Business Invariant Engine (Section 13.17, `business_invariants`).
 * `condition` is deliberately the same declarative DSL used elsewhere
 * (Section 13.9's `lifecycleCondition`) rather than a bespoke invariant
 * grammar — a data model that can later support natural-language-compiled
 * invariants (compiling text down to this same `Condition` shape) without
 * requiring that interpretation now.
 */
export interface BusinessInvariantInput {
  targetId: number;
  name: string;
  objectType: string;
  /** `unknown` deliberately — arrives as parsed JSON from an operator-facing API and is validated (not merely type-asserted) before it is ever stored. */
  condition: unknown;
  expected: boolean;
  severity: BusinessInvariantSeverity;
}

export interface BusinessInvariant extends Omit<BusinessInvariantInput, "condition"> {
  id: number;
  /** Validated on the way in — always a real `Condition` once read back. */
  condition: Condition;
}

export interface InvariantEvaluationResult {
  invariant: BusinessInvariant;
  observedState: Record<string, unknown>;
  /** What `condition` actually evaluated to against `observedState`. */
  holds: boolean;
  /** Raised when `holds` doesn't match `expected` — the invariant was violated. */
  violation: boolean;
}

/**
 * Evaluates one invariant against one observed data/transition snapshot.
 * An invariant like "Ticket.number is immutable after PAID" is encoded as
 * `condition: { or: [{ field: "status", operator: "NEQ", value: "PAID" }, { field: "numberChanged", operator: "EQ", value: false }] }`,
 * `expected: true` — "either it isn't PAID, or the number didn't change."
 */
export function evaluateInvariant(invariant: BusinessInvariant, observedState: Record<string, unknown>): InvariantEvaluationResult {
  const holds = evaluateCondition(invariant.condition, observedState);
  return { invariant, observedState, holds, violation: holds !== invariant.expected };
}
