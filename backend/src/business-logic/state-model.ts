import type { Db } from "../db/connection";

export interface BusinessState {
  id: number;
  scanRunId: number;
  objectType: string;
  stateValue: string;
}

/**
 * Business State Modeling (Section 13.5): records a distinct state value
 * observed for an object type — no fixed/universal naming scheme is ever
 * assumed anywhere in this module. A Ticket's states might be
 * RESERVED/PAID/CANCELLED; some other object type's states could be
 * anything else entirely, and this function neither knows nor cares.
 * Deduplicates automatically — recording the same (objectType,
 * stateValue) pair twice within a scan run is a no-op.
 */
export function recordObservedState(db: Db, scanRunId: number, objectType: string, stateValue: string): number {
  const existing = db
    .prepare("SELECT id FROM business_states WHERE scan_run_id = ? AND object_type = ? AND state_value = ?")
    .get(scanRunId, objectType, stateValue) as { id: number } | undefined;
  if (existing) return existing.id;

  const result = db
    .prepare("INSERT INTO business_states (scan_run_id, object_type, state_value) VALUES (?, ?, ?)")
    .run(scanRunId, objectType, stateValue);
  return Number(result.lastInsertRowid);
}

/**
 * Operator manual-override support: declares a state value for an object
 * type explicitly, even if it was never actually observed during this
 * scan (e.g. a rare edge-case state the operator knows exists) — recorded
 * through the identical path as an observed one, since the table itself
 * makes no structural distinction between the two.
 */
export function recordManualState(db: Db, scanRunId: number, objectType: string, stateValue: string): number {
  return recordObservedState(db, scanRunId, objectType, stateValue);
}

/** Infers every distinct state from a batch of observed field values (e.g. every `status` value seen across several Ticket instances) and records each one. */
export function inferStatesFromObservedValues(db: Db, scanRunId: number, objectType: string, observedValues: readonly string[]): string[] {
  const distinct = [...new Set(observedValues)];
  for (const value of distinct) recordObservedState(db, scanRunId, objectType, value);
  return distinct;
}

interface BusinessStateRow {
  id: number;
  scan_run_id: number;
  object_type: string;
  state_value: string;
}

export function listObservedStates(db: Db, scanRunId: number, objectType: string): string[] {
  const rows = db
    .prepare("SELECT DISTINCT state_value FROM business_states WHERE scan_run_id = ? AND object_type = ?")
    .all(scanRunId, objectType) as unknown as { state_value: string }[];
  return rows.map((row) => row.state_value);
}

export function listBusinessStates(db: Db, scanRunId: number): BusinessState[] {
  const rows = db.prepare("SELECT * FROM business_states WHERE scan_run_id = ? ORDER BY id").all(scanRunId) as unknown as BusinessStateRow[];
  return rows.map((row) => ({ id: row.id, scanRunId: row.scan_run_id, objectType: row.object_type, stateValue: row.state_value }));
}
