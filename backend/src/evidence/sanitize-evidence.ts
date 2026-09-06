import { createHash } from "node:crypto";
import { maskSecret } from "./mask-secrets";

const SENSITIVE_KEY_PATTERN = /password|token|secret|authorization|cookie|api[-_]?key|credential/i;

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Brazilian CPF (###.###.###-##) as the national-ID-style format example.
const NATIONAL_ID_PATTERN = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const PHONE_PATTERN = /\+?\d(?:[\d\s\-().]){7,}\d/g;
// "123 Main Street" / "Rua das Flores, 123" — a number adjacent to a
// street-type word, in either English or Portuguese conventions.
const ADDRESS_PATTERN = /\b\d+\s+[A-Za-zÀ-ÿ.]+(?:\s+[A-Za-zÀ-ÿ.]+){0,3}\s+(street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|rua|avenida)\b|\b(rua|avenida)\s+[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,3},?\s*\d+\b/gi;

function redactPatternsInString(value: string): string {
  return value
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(NATIONAL_ID_PATTERN, "[REDACTED_ID]")
    .replace(ADDRESS_PATTERN, "[REDACTED_ADDRESS]")
    .replace(PHONE_PATTERN, (match) => (match.replace(/\D/g, "").length >= 8 ? "[REDACTED_PHONE]" : match));
}

/**
 * The central Evidence Sanitization layer: every evidence write, log
 * statement, report render, and UI serialization is meant to pass through
 * this — not `maskSecrets` (Section 8.5) directly — since it's a strict
 * superset: known-sensitive key names are still fully masked, and on top
 * of that every other string is scanned for PII-shaped content (emails,
 * phone numbers, national-ID formats, address-like strings) regardless of
 * what the field happens to be named. A scanner with no masking logic of
 * its own still gets fully sanitized evidence — nothing here depends on
 * the caller remembering to do anything.
 */
export function sanitizeEvidence<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeEvidence(item)) as T;
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key) && typeof entryValue === "string") {
        result[key] = maskSecret(entryValue);
      } else if (typeof entryValue === "string") {
        result[key] = redactPatternsInString(entryValue);
      } else {
        result[key] = sanitizeEvidence(entryValue);
      }
    }
    return result as T;
  }

  if (typeof value === "string") {
    return redactPatternsInString(value) as T;
  }

  return value;
}

/**
 * A stable fingerprint sufficient for comparison purposes (e.g. confirming
 * two IDOR responses reference the same underlying record) without
 * persisting the raw content.
 */
export function fingerprint(value: unknown): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}
