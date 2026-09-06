import { classifyField } from "./field-classifier";
import type { AnalyzedField } from "./field-analyzer";

export interface UrlCandidate {
  scanner: "URL_VALIDATION";
  fieldPath: string;
  endpoint: string;
  value: string;
  confidence: "MEDIUM";
}

/**
 * Every field classified URL is recorded as a candidate for future
 * URL-validation scanning (open-redirect/SSRF-adjacent checks) — this
 * module only prepares the candidate; no such scanner exists yet.
 */
export function flagUrlCandidates(fields: readonly AnalyzedField[], endpoint: string): UrlCandidate[] {
  return fields
    .filter((field): field is AnalyzedField & { value: string } => classifyField(field.path, field.value) === "URL")
    .map((field) => ({ scanner: "URL_VALIDATION", fieldPath: field.path, endpoint, value: field.value, confidence: "MEDIUM" }));
}
