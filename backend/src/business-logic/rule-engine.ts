export type ConditionOperator = "EQ" | "NEQ" | "IN" | "NOT_IN" | "GT" | "GTE" | "LT" | "LTE" | "EXISTS";

export interface ConditionLeaf {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

export type Condition = ConditionLeaf | { and: Condition[] } | { or: Condition[] } | { not: Condition };

const VALID_OPERATORS = new Set<ConditionOperator>(["EQ", "NEQ", "IN", "NOT_IN", "GT", "GTE", "LT", "LTE", "EXISTS"]);

/**
 * Structural schema validation for the declarative condition DSL (design.md
 * Decision 50) — rejects anything that isn't literally a plain JS object
 * shaped like a `ConditionLeaf` or an `{and|or|not}` composition. A raw
 * string (e.g. `"process.exit()"`, `"require('fs')"`, a template literal)
 * is never a valid shape at all — there is no code path that would ever
 * attempt to interpret a string as a condition.
 */
export function isValidCondition(value: unknown): value is Condition {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;

  if ("and" in obj) return Object.keys(obj).length === 1 && Array.isArray(obj.and) && obj.and.every(isValidCondition);
  if ("or" in obj) return Object.keys(obj).length === 1 && Array.isArray(obj.or) && obj.or.every(isValidCondition);
  if ("not" in obj) return Object.keys(obj).length === 1 && isValidCondition(obj.not);

  if ("field" in obj && "operator" in obj) {
    return typeof obj.field === "string" && typeof obj.operator === "string" && VALID_OPERATORS.has(obj.operator as ConditionOperator);
  }
  return false;
}

function getField(state: Record<string, unknown>, field: string): unknown {
  return field
    .split(".")
    .reduce<unknown>((acc, key) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), state);
}

function evaluateLeaf(leaf: ConditionLeaf, state: Record<string, unknown>): boolean {
  const actual = getField(state, leaf.field);
  switch (leaf.operator) {
    case "EQ":
      return actual === leaf.value;
    case "NEQ":
      return actual !== leaf.value;
    case "IN":
      return Array.isArray(leaf.value) && leaf.value.includes(actual);
    case "NOT_IN":
      return Array.isArray(leaf.value) && !leaf.value.includes(actual);
    case "GT":
      return typeof actual === "number" && typeof leaf.value === "number" && actual > leaf.value;
    case "GTE":
      return typeof actual === "number" && typeof leaf.value === "number" && actual >= leaf.value;
    case "LT":
      return typeof actual === "number" && typeof leaf.value === "number" && actual < leaf.value;
    case "LTE":
      return typeof actual === "number" && typeof leaf.value === "number" && actual <= leaf.value;
    case "EXISTS":
      return actual !== undefined;
  }
}

/**
 * The declarative condition DSL evaluator (design.md Decision 50), shared
 * by `BusinessExpectation.lifecycleCondition` and
 * `BusinessInvariant.condition`: a hand-written recursive walker over
 * plain JSON data. Contains no call to `eval`, `Function(...)`,
 * `vm.runInContext`, or any other dynamic-code-execution primitive —
 * every operator is handled by a fixed `switch`, and every input has
 * already passed `isValidCondition` before this ever runs.
 */
export function evaluateCondition(condition: Condition, state: Record<string, unknown>): boolean {
  if ("and" in condition) return condition.and.every((c) => evaluateCondition(c, state));
  if ("or" in condition) return condition.or.some((c) => evaluateCondition(c, state));
  if ("not" in condition) return !evaluateCondition(condition.not, state);
  return evaluateLeaf(condition, state);
}
