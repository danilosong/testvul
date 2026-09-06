import type { Db } from "../db/connection";
import type { ResourceKey } from "../mutation/resource-key";
import type { BusinessSafetyClassification } from "./business-test-plan";
import type { BusinessFindingProofLevel } from "./business-findings";

export interface BusinessTestPlanRecordInput {
  scanRunId: number;
  resourceKey: ResourceKey;
  candidateId?: number;
  operationId?: number;
  invariantId?: number;
  expectationId?: number;
  safetyClassification: BusinessSafetyClassification;
  proofLevel?: BusinessFindingProofLevel;
}

/** Persists only the referential subset of a `BusinessTestPlan` (Section 13.18) — the resolved candidate/operation/invariant objects and derived preconditions/expectedBehavior/safeValidation/cleanup text live at the application layer, reassembled from these same ids on read. */
export function recordBusinessTestPlan(db: Db, input: BusinessTestPlanRecordInput): number {
  const result = db
    .prepare(
      `INSERT INTO business_test_plans
         (scan_run_id, target_id, origin, tenant_id, object_type, resource_id, candidate_id, operation_id, invariant_id, expectation_id, safety_classification, proof_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.scanRunId,
      input.resourceKey.targetId,
      input.resourceKey.origin,
      input.resourceKey.tenantId ?? null,
      input.resourceKey.objectType,
      input.resourceKey.resourceId,
      input.candidateId ?? null,
      input.operationId ?? null,
      input.invariantId ?? null,
      input.expectationId ?? null,
      input.safetyClassification,
      input.proofLevel ?? null,
    );
  return Number(result.lastInsertRowid);
}

interface BusinessTestPlanRow {
  id: number;
  scan_run_id: number;
  target_id: number | null;
  origin: string | null;
  tenant_id: string | null;
  object_type: string | null;
  resource_id: string | null;
  candidate_id: number | null;
  operation_id: number | null;
  invariant_id: number | null;
  expectation_id: number | null;
  safety_classification: BusinessSafetyClassification;
  proof_level: BusinessFindingProofLevel | null;
}

export interface BusinessTestPlanRecord {
  id: number;
  scanRunId: number;
  candidateId?: number;
  operationId?: number;
  invariantId?: number;
  expectationId?: number;
  safetyClassification: BusinessSafetyClassification;
  proofLevel?: BusinessFindingProofLevel;
}

function rowToRecord(row: BusinessTestPlanRow): BusinessTestPlanRecord {
  const record: BusinessTestPlanRecord = { id: row.id, scanRunId: row.scan_run_id, safetyClassification: row.safety_classification };
  if (row.candidate_id !== null) record.candidateId = row.candidate_id;
  if (row.operation_id !== null) record.operationId = row.operation_id;
  if (row.invariant_id !== null) record.invariantId = row.invariant_id;
  if (row.expectation_id !== null) record.expectationId = row.expectation_id;
  if (row.proof_level !== null) record.proofLevel = row.proof_level;
  return record;
}

export function listBusinessTestPlans(db: Db, scanRunId: number): BusinessTestPlanRecord[] {
  const rows = db.prepare("SELECT * FROM business_test_plans WHERE scan_run_id = ?").all(scanRunId) as unknown as BusinessTestPlanRow[];
  return rows.map(rowToRecord);
}
