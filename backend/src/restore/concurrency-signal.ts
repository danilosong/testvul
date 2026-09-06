export type ConcurrencySignal = { type: "etag"; value: string } | { type: "field"; field: string; value: unknown };

const VERSION_FIELD_NAMES = ["version", "revision", "updatedAt"];

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Looks for an ETag response header first, then a version/revision/updatedAt
 * field in a JSON body — the three concurrency-signal shapes the spec names. */
export function detectConcurrencySignal(response: { headers: Record<string, string | string[] | undefined>; body: string }): ConcurrencySignal | null {
  const etag = firstHeaderValue(response.headers["etag"]);
  if (etag) return { type: "etag", value: etag };

  try {
    const parsed = JSON.parse(response.body) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      for (const field of VERSION_FIELD_NAMES) {
        if (field in parsed) return { type: "field", field, value: parsed[field] };
      }
    }
  } catch {
    // not JSON — no field-based signal available
  }

  return null;
}

export function concurrencySignalsEqual(a: ConcurrencySignal, b: ConcurrencySignal): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "etag" && b.type === "etag") return a.value === b.value;
  if (a.type === "field" && b.type === "field") return a.field === b.field && JSON.stringify(a.value) === JSON.stringify(b.value);
  return false;
}
