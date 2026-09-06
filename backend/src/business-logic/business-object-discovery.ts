import type { Db } from "../db/connection";

export type BusinessObjectSource = "OPENAPI" | "JSON_FIELD" | "BROWSER_RUNTIME" | "FORM" | "URL" | "ENDPOINT_NAME";

export interface DiscoveredBusinessObject {
  id: number;
  scanRunId: number;
  objectType: string;
  source: BusinessObjectSource;
}

function singularize(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ses")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function toPascalCase(word: string): string {
  if (word.length === 0) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

const NON_OBJECT_SEGMENTS = new Set(["api", "v1", "v2", "app"]);

/**
 * Recognizes candidate business object type names from a URL's path
 * segments (e.g. `/api/campaigns/{id}` → "Campaign") — a purely
 * structural naming heuristic (pluralized-noun-as-path-segment,
 * singularized and PascalCased). Extensible and never hardcoded to any
 * specific domain's object type names — the exact same function
 * recognizes "Campaign"/"Ticket"/"Project"/anything else shaped the same
 * way, with no dependency on any optional Profile Plugin.
 */
export function recognizeObjectTypesFromUrl(url: string): string[] {
  let pathname: string;
  try {
    pathname = new URL(url, "http://placeholder.invalid").pathname;
  } catch {
    return [];
  }
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .filter((segment) => !/^\d+$/.test(segment) && !/^[{:].*[}]?$/.test(segment) && !NON_OBJECT_SEGMENTS.has(segment.toLowerCase()));
  return segments.map((segment) => toPascalCase(singularize(segment)));
}

/** Recognizes a business object type from a JSON field name shaped like `<objectType>Id` — e.g. "campaignId" → "Campaign". */
export function recognizeObjectTypeFromFieldName(fieldName: string): string | null {
  const lastSegment = fieldName.split(".").pop() ?? fieldName;
  const match = /^([a-zA-Z]+)Id$/.exec(lastSegment);
  return match ? toPascalCase(match[1]!) : null;
}

/** Persists a discovered business object — the single insertion path every discovery source (OpenAPI, JSON fields, browser-runtime observation, forms, URLs, endpoint names) is meant to go through. */
export function recordBusinessObject(db: Db, scanRunId: number, objectType: string, source: BusinessObjectSource): number {
  const result = db.prepare("INSERT INTO business_objects (scan_run_id, object_type, source) VALUES (?, ?, ?)").run(scanRunId, objectType, source);
  return Number(result.lastInsertRowid);
}

interface BusinessObjectRow {
  id: number;
  scan_run_id: number;
  object_type: string;
  source: BusinessObjectSource;
}

export function listBusinessObjects(db: Db, scanRunId: number): DiscoveredBusinessObject[] {
  const rows = db.prepare("SELECT * FROM business_objects WHERE scan_run_id = ? ORDER BY id").all(scanRunId) as unknown as BusinessObjectRow[];
  return rows.map((row) => ({ id: row.id, scanRunId: row.scan_run_id, objectType: row.object_type, source: row.source }));
}
