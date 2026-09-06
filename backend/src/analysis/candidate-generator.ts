import { classifyField, type FieldClassification } from "./field-classifier";
import type { AnalyzedField } from "./field-analyzer";

export type CandidateScanner = "XSS" | "GTM" | "URL_VALIDATION" | "IDOR" | "INFORMATIONAL";
export type CandidateConfidence = "LOW" | "MEDIUM" | "HIGH";
export type CandidatePriority = 1 | 2 | 3;

export interface GeneratedCandidate {
  scanner: CandidateScanner;
  fieldPath: string;
  endpoint: string;
  classification: FieldClassification;
  confidence: CandidateConfidence;
  priority: CandidatePriority;
}

// Ownership/tenant-boundary identifier field names — the same shape the
// IDOR scanner (Section 11) looks for.
const AUTHORIZATION_BOUNDARY_KEYWORDS = [
  "userid",
  "ownerid",
  "tenantid",
  "organizationid",
  "companyid",
  "accountid",
  "projectid",
  "campaignid",
];
const AFFILIATE_KEYWORDS = ["affiliate"];
const AUTH_FIELD_KEYWORDS = ["authmethod", "authprovider", "role", "permission", "scope"];

function normalizedSegment(path: string): string {
  return (path.split(".").pop() ?? path).toLowerCase().replace(/[_-]/g, "");
}

function matchesAny(segment: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => segment.includes(keyword));
}

function isAuthorizationBoundary(path: string): boolean {
  return matchesAny(normalizedSegment(path), AUTHORIZATION_BOUNDARY_KEYWORDS);
}

function priorityForClassification(path: string, classification: FieldClassification): CandidatePriority {
  if (classification === "HTML" || classification === "GTM") return 1;
  if (classification === "IDENTIFIER" && isAuthorizationBoundary(path)) return 1;

  if (classification === "URL") return 2;
  const segment = normalizedSegment(path);
  if (matchesAny(segment, AFFILIATE_KEYWORDS) || matchesAny(segment, AUTH_FIELD_KEYWORDS)) return 2;

  return 3;
}

/**
 * Priority 1: HTML fields, GTM fields, authorization boundaries, tenant
 * identifiers. Priority 2: URLs, affiliate identifiers, authentication
 * fields. Priority 3: everything else (informational configuration).
 */
export function priorityFor(path: string, value: unknown): CandidatePriority {
  return priorityForClassification(path, classifyField(path, value));
}

function scannerFor(classification: FieldClassification, priority: CandidatePriority): CandidateScanner {
  if (classification === "HTML") return "XSS";
  if (classification === "GTM") return "GTM";
  if (classification === "URL") return "URL_VALIDATION";
  if (classification === "IDENTIFIER" && priority === 1) return "IDOR";
  return "INFORMATIONAL";
}

function confidenceFor(classification: FieldClassification): CandidateConfidence {
  if (classification === "HTML" || classification === "GTM") return "HIGH";
  if (classification === "URL" || classification === "IDENTIFIER") return "MEDIUM";
  return "LOW";
}

/**
 * Generates one typed, prioritized candidate per analyzed field — this is
 * the alternative to testing every discovered field indiscriminately: a
 * later stage consumes this list in priority order rather than firing
 * every possible test against every field it finds.
 */
export function generateCandidates(fields: readonly AnalyzedField[], endpoint: string): GeneratedCandidate[] {
  return fields.map((field) => {
    const classification = classifyField(field.path, field.value);
    const priority = priorityForClassification(field.path, classification);
    return {
      scanner: scannerFor(classification, priority),
      fieldPath: field.path,
      endpoint,
      classification,
      confidence: confidenceFor(classification),
      priority,
    };
  });
}
