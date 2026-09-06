import type { Db } from "../db/connection";
import type { FieldClassification } from "../analysis/field-classifier";

export interface DiscoveredField {
  id: number;
  scanRunId: number;
  endpointId?: number;
  fieldPath: string;
  classification: FieldClassification;
  sampleValueSanitized?: string;
}

/** Persists one analyzed field (Section 6's JSON Field Analyzer output), tied to the specific endpoint it was found on — the missing writer for `discovered_fields` (Section 15.4's Endpoint Detail needs a real per-endpoint field count/list, not scan-run-wide totals). */
export function recordDiscoveredField(
  db: Db,
  scanRunId: number,
  endpointId: number | undefined,
  fieldPath: string,
  classification: FieldClassification,
  sampleValueSanitized?: string,
): number {
  const result = db
    .prepare("INSERT INTO discovered_fields (scan_run_id, endpoint_id, field_path, classification, sample_value_sanitized) VALUES (?, ?, ?, ?, ?)")
    .run(scanRunId, endpointId ?? null, fieldPath, classification, sampleValueSanitized ?? null);
  return Number(result.lastInsertRowid);
}

interface DiscoveredFieldRow {
  id: number;
  scan_run_id: number;
  endpoint_id: number | null;
  field_path: string;
  classification: FieldClassification;
  sample_value_sanitized: string | null;
}

function rowToField(row: DiscoveredFieldRow): DiscoveredField {
  const field: DiscoveredField = { id: row.id, scanRunId: row.scan_run_id, fieldPath: row.field_path, classification: row.classification };
  if (row.endpoint_id !== null) field.endpointId = row.endpoint_id;
  if (row.sample_value_sanitized !== null) field.sampleValueSanitized = row.sample_value_sanitized;
  return field;
}

export function listDiscoveredFieldsForEndpoint(db: Db, endpointId: number): DiscoveredField[] {
  const rows = db.prepare("SELECT * FROM discovered_fields WHERE endpoint_id = ? ORDER BY id").all(endpointId) as unknown as DiscoveredFieldRow[];
  return rows.map(rowToField);
}
