/**
 * Masks a secret value for display — a short prefix and suffix stay
 * visible (enough for an operator to recognize which credential they're
 * looking at) while the bulk of the value is replaced with asterisks. Too
 * short a value to safely reveal any part of is masked entirely.
 *
 * This is the seed of the shared secret-masking boundary Section 8.5
 * generalizes for evidence/log/report serialization; the masking rule
 * itself lives here so every caller gets the identical behavior.
 */
export function maskSecret(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  const visibleStart = value.slice(0, 6);
  const visibleEnd = value.slice(-4);
  return `${visibleStart}${"*".repeat(5)}${visibleEnd}`;
}

const SENSITIVE_KEY_PATTERN = /password|token|secret|authorization|cookie|api[-_]?key|credential/i;

/**
 * The shared secret-masking serialization boundary: recursively walks any
 * JSON-shaped value (evidence records, headers objects, log payloads,
 * report sections) and masks every string held under a sensitive-looking
 * key, at any depth. Never mutates its input — every caller keeps its own
 * unredacted in-memory value (e.g. for actually issuing a request) and
 * only ever sends the *return value* of this function to evidence
 * persistence, logs, reports, or UI serialization.
 */
export function maskSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => maskSecrets(item)) as T;
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      result[key] =
        SENSITIVE_KEY_PATTERN.test(key) && typeof entryValue === "string" ? maskSecret(entryValue) : maskSecrets(entryValue);
    }
    return result as T;
  }

  return value;
}
