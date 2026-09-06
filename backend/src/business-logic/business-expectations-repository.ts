import type { Db } from "../db/connection";
import { isValidCondition, type Condition } from "./rule-engine";
import type { BusinessExpectation, BusinessExpectationInput } from "./business-expectation";

export class InvalidLifecycleConditionError extends Error {
  constructor() {
    super("lifecycleCondition must be valid declarative condition DSL data — rejected before it is ever stored");
    this.name = "InvalidLifecycleConditionError";
  }
}

interface BusinessExpectationRow {
  id: number;
  target_id: number;
  object_type: string;
  property_or_action: string;
  expectation_type: BusinessExpectation["expectationType"];
  expected_value: string;
  lifecycle_condition_json: string | null;
  severity: BusinessExpectation["severity"];
}

function rowToExpectation(row: BusinessExpectationRow): BusinessExpectation {
  const expectation: BusinessExpectation = {
    id: row.id,
    targetId: row.target_id,
    objectType: row.object_type,
    propertyOrAction: row.property_or_action,
    expectationType: row.expectation_type,
    expectedValue: row.expected_value,
    severity: row.severity,
  };
  if (row.lifecycle_condition_json !== null) expectation.lifecycleCondition = JSON.parse(row.lifecycle_condition_json) as Condition;
  return expectation;
}

/** Schema validation happens at write time (design.md Decision 50) — a `lifecycleCondition` that isn't valid DSL data (including any raw string, however code-shaped) is refused before it is ever persisted or could ever be evaluated. */
export function createBusinessExpectation(db: Db, input: BusinessExpectationInput): number {
  if (input.lifecycleCondition !== undefined && !isValidCondition(input.lifecycleCondition)) {
    throw new InvalidLifecycleConditionError();
  }
  const result = db
    .prepare(
      `INSERT INTO business_expectations (target_id, object_type, property_or_action, expectation_type, expected_value, lifecycle_condition_json, severity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.targetId,
      input.objectType,
      input.propertyOrAction,
      input.expectationType,
      input.expectedValue,
      input.lifecycleCondition !== undefined ? JSON.stringify(input.lifecycleCondition) : null,
      input.severity,
    );
  return Number(result.lastInsertRowid);
}

export function getBusinessExpectations(db: Db, targetId: number, objectType: string, propertyOrAction: string): BusinessExpectation[] {
  const rows = db
    .prepare("SELECT * FROM business_expectations WHERE target_id = ? AND object_type = ? AND property_or_action = ?")
    .all(targetId, objectType, propertyOrAction) as unknown as BusinessExpectationRow[];
  return rows.map(rowToExpectation);
}
