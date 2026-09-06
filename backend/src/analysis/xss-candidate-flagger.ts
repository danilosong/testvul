import { classifyField } from "./field-classifier";
import type { AnalyzedField } from "./field-analyzer";

export interface XssCandidate {
  scanner: "XSS";
  fieldPath: string;
  endpoint: string;
  confidence: "HIGH";
}

/**
 * Every field classified HTML is automatically a Stored XSS test
 * candidate — this is not a heuristic scoring step, it's an unconditional
 * flag: HTML-classified means candidate, always.
 */
export function flagXssCandidates(fields: readonly AnalyzedField[], endpoint: string): XssCandidate[] {
  return fields
    .filter((field) => classifyField(field.path, field.value) === "HTML")
    .map((field) => ({ scanner: "XSS", fieldPath: field.path, endpoint, confidence: "HIGH" }));
}
