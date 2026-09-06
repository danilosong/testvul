import type { Condition } from "./rule-engine";

/**
 * Scaffold — filled in by Section 13.17 (the Business Invariant Engine,
 * `business_invariants`). Evaluates observed data/transitions against
 * operator-configured invariants — a data model that can later support
 * natural-language-compiled invariants without requiring that
 * interpretation now.
 */
export interface BusinessInvariant {
  name: string;
  objectType: string;
  condition: Condition;
  expected: boolean;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}
