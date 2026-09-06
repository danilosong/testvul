import type { Db } from "../db/connection";
import { isValidCondition, type Condition } from "./rule-engine";
import type { BusinessInvariant, BusinessInvariantInput } from "./invariant-engine";

export class InvalidInvariantConditionError extends Error {
  constructor() {
    super("condition must be valid declarative condition DSL data — rejected before it is ever stored");
    this.name = "InvalidInvariantConditionError";
  }
}

interface BusinessInvariantRow {
  id: number;
  target_id: number;
  name: string;
  object_type: string;
  condition_json: string;
  expected_json: string;
  severity: BusinessInvariant["severity"];
}

function rowToInvariant(row: BusinessInvariantRow): BusinessInvariant {
  return {
    id: row.id,
    targetId: row.target_id,
    name: row.name,
    objectType: row.object_type,
    condition: JSON.parse(row.condition_json) as Condition,
    expected: JSON.parse(row.expected_json) as boolean,
    severity: row.severity,
  };
}

/** Schema validation happens at write time (design.md Decision 50, mirroring `business_expectations.lifecycle_condition_json`) — a `condition` that isn't valid DSL data is refused before it is ever persisted or could ever be evaluated. */
export function createBusinessInvariant(db: Db, input: BusinessInvariantInput): number {
  if (!isValidCondition(input.condition)) throw new InvalidInvariantConditionError();
  const result = db
    .prepare(
      `INSERT INTO business_invariants (target_id, name, object_type, condition_json, expected_json, severity)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.targetId, input.name, input.objectType, JSON.stringify(input.condition), JSON.stringify(input.expected), input.severity);
  return Number(result.lastInsertRowid);
}

export function listBusinessInvariants(db: Db, targetId: number, objectType: string): BusinessInvariant[] {
  const rows = db
    .prepare("SELECT * FROM business_invariants WHERE target_id = ? AND object_type = ?")
    .all(targetId, objectType) as unknown as BusinessInvariantRow[];
  return rows.map(rowToInvariant);
}

/** Every configured invariant for a target, across all object types — the "Configured Rules" view's data source (Section 13.22). */
export function listBusinessInvariantsForTarget(db: Db, targetId: number): BusinessInvariant[] {
  const rows = db.prepare("SELECT * FROM business_invariants WHERE target_id = ? ORDER BY object_type, name").all(targetId) as unknown as BusinessInvariantRow[];
  return rows.map(rowToInvariant);
}

export type BusinessInvariantUpdateInput = Partial<Omit<BusinessInvariantInput, "targetId" | "objectType">>;

export function updateBusinessInvariant(db: Db, id: number, input: BusinessInvariantUpdateInput): void {
  if (input.condition !== undefined && !isValidCondition(input.condition)) throw new InvalidInvariantConditionError();
  const existing = db.prepare("SELECT * FROM business_invariants WHERE id = ?").get(id) as unknown as BusinessInvariantRow | undefined;
  if (!existing) return;
  db.prepare(`UPDATE business_invariants SET name = ?, condition_json = ?, expected_json = ?, severity = ?, updated_at = datetime('now') WHERE id = ?`).run(
    input.name ?? existing.name,
    input.condition !== undefined ? JSON.stringify(input.condition) : existing.condition_json,
    input.expected !== undefined ? JSON.stringify(input.expected) : existing.expected_json,
    input.severity ?? existing.severity,
    id,
  );
}

export function deleteBusinessInvariant(db: Db, id: number): void {
  db.prepare("DELETE FROM business_invariants WHERE id = ?").run(id);
}
