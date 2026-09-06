import { randomUUID } from "node:crypto";

export type XssCanaryVerdict = "REMOVED" | "ESCAPED" | "HTML_ALLOWED" | "RAW_HTML";

export interface XssCanary {
  uuid: string;
  /** `<strong data-security-test="UUID">SECURITY_TEST_UUID</strong>` — never executes any JavaScript. */
  payload: string;
}

/** A fresh, unique, non-executing canary — a `<strong>` tag with a marker attribute and matching text content. */
export function generateXssCanary(): XssCanary {
  const uuid = randomUUID();
  return { uuid, payload: `<strong data-security-test="${uuid}">SECURITY_TEST_${uuid}</strong>` };
}

/**
 * Classifies what a target actually stored/reflected for the base canary,
 * from the *decoded field value* (not a raw JSON response body — a JSON
 * string escapes embedded quotes, so comparing against undecoded JSON text
 * would never match the literal canary markup) — reaching only
 * REMOVED/ESCAPED/HTML_ALLOWED/RAW_HTML (design.md — the base test never
 * confirms JavaScript execution; see the separate Sanitizer Probe (Section
 * 11.3) for UNSAFE_ATTRIBUTE_SURVIVED/POTENTIALLY_EXECUTABLE, and the
 * opt-in Active XSS Confirmation (Section 11.4) for EXECUTION_CONFIRMED).
 */
export function classifyStoredXss(fieldValue: string, uuid: string): XssCanaryVerdict {
  const rawCanary = `<strong data-security-test="${uuid}">SECURITY_TEST_${uuid}</strong>`;
  if (fieldValue.includes(rawCanary)) return "RAW_HTML";

  const canaryText = `SECURITY_TEST_${uuid}`;
  if (!fieldValue.includes(canaryText)) return "REMOVED";

  if (fieldValue.includes("&lt;strong") || fieldValue.includes("&amp;lt;strong")) return "ESCAPED";
  if (fieldValue.includes(`<strong>${canaryText}</strong>`)) return "HTML_ALLOWED";

  // The marker text survived in some other shape we can't positively
  // confirm as raw, unexecuted HTML — the conservative, non-executable
  // classification.
  return "ESCAPED";
}
