export type FieldClassification =
  | "HTML"
  | "URL"
  | "IDENTIFIER"
  | "GTM"
  | "PIXEL"
  | "EMAIL"
  | "PHONE"
  | "BOOLEAN"
  | "NUMBER"
  | "GENERIC_STRING";

const GTM_ID_PATTERN = /^GTM-[A-Z0-9]+$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[\d\s\-().]{7,}$/;
const HTML_PATTERN = /<([a-z][a-z0-9]*)\b[^>]*>/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lastPathSegment(path: string): string {
  return path.split(".").pop() ?? path;
}

/**
 * Classifies a single field's value (and, where the value alone is
 * ambiguous, its field path) into one of the fixed classification
 * categories. Checked most-specific-first so, e.g., a `gtmId` field
 * (whose name also ends in "Id") is classified GTM, not IDENTIFIER.
 */
export function classifyField(path: string, value: unknown): FieldClassification {
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "number") return "NUMBER";
  if (typeof value !== "string") return "GENERIC_STRING";

  const segment = lastPathSegment(path).toLowerCase();

  if (segment.endsWith("gtmid") || segment === "gtm" || GTM_ID_PATTERN.test(value)) return "GTM";
  if (segment.includes("pixel")) return "PIXEL";
  if (EMAIL_PATTERN.test(value)) return "EMAIL";
  if (segment.includes("phone") && PHONE_PATTERN.test(value)) return "PHONE";
  if (/^https?:\/\//i.test(value)) return "URL";
  if (HTML_PATTERN.test(value)) return "HTML";
  if (UUID_PATTERN.test(value) || /id$/.test(segment)) return "IDENTIFIER";

  return "GENERIC_STRING";
}
