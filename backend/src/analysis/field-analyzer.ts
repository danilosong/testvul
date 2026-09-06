export interface AnalyzedField {
  path: string;
  value: unknown;
}

/**
 * Recursively walks a JSON value and produces a dotted-path/value pair for
 * every leaf field, including through arrays (indexed by position).
 */
export function analyzeFields(data: unknown, prefix = ""): AnalyzedField[] {
  if (Array.isArray(data)) {
    return data.flatMap((item, index) => analyzeFields(item, prefix ? `${prefix}.${index}` : String(index)));
  }

  if (data !== null && typeof data === "object") {
    return Object.entries(data).flatMap(([key, value]) => analyzeFields(value, prefix ? `${prefix}.${key}` : key));
  }

  return [{ path: prefix, value: data }];
}
