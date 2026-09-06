import type { Db } from "../db/connection";
import type { ObservedProperty, ObservedPropertyInput } from "./business-observed-property";

interface ObservedPropertyRow {
  id: number;
  scan_run_id: number;
  object_type: string;
  property_or_action: string;
  observed_value_json: string;
  evidence_id: number | null;
  created_at: string;
}

function rowToObservedProperty(row: ObservedPropertyRow): ObservedProperty {
  const property: ObservedProperty = {
    id: row.id,
    scanRunId: row.scan_run_id,
    objectType: row.object_type,
    propertyOrAction: row.property_or_action,
    observedValue: JSON.parse(row.observed_value_json),
    createdAt: row.created_at,
  };
  if (row.evidence_id !== null) property.evidenceId = row.evidence_id;
  return property;
}

/**
 * Records a mechanical fact the engine itself determined — kept in a
 * table entirely separate from `business_expectations` (design.md
 * Decision 41). There is no code path here that reads or references an
 * expectation; an observation is recorded purely from what was observed.
 */
export function recordObservedProperty(db: Db, input: ObservedPropertyInput): number {
  const result = db
    .prepare(
      "INSERT INTO business_observed_properties (scan_run_id, object_type, property_or_action, observed_value_json, evidence_id) VALUES (?, ?, ?, ?, ?)",
    )
    .run(input.scanRunId, input.objectType, input.propertyOrAction, JSON.stringify(input.observedValue), input.evidenceId ?? null);
  return Number(result.lastInsertRowid);
}

export function listObservedProperties(db: Db, scanRunId: number, objectType: string, propertyOrAction: string): ObservedProperty[] {
  const rows = db
    .prepare("SELECT * FROM business_observed_properties WHERE scan_run_id = ? AND object_type = ? AND property_or_action = ?")
    .all(scanRunId, objectType, propertyOrAction) as unknown as ObservedPropertyRow[];
  return rows.map(rowToObservedProperty);
}

/** Every observed property for a scan run — the "Observed Behavior" view's data source (Section 13.22). */
export function listAllObservedPropertiesForScanRun(db: Db, scanRunId: number): ObservedProperty[] {
  const rows = db
    .prepare("SELECT * FROM business_observed_properties WHERE scan_run_id = ? ORDER BY object_type, property_or_action")
    .all(scanRunId) as unknown as ObservedPropertyRow[];
  return rows.map(rowToObservedProperty);
}
