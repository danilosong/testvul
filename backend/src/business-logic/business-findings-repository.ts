import type { Db } from "../db/connection";
import type { BusinessFindingConfidence, BusinessFindingProofLevel, BusinessFindingSeverity, BusinessFindingType } from "./business-findings";

export interface BusinessFindingInput {
  scanRunId: number;
  title: string;
  severity: BusinessFindingSeverity;
  category: BusinessFindingType;
  confidence: BusinessFindingConfidence;
  proofLevel: BusinessFindingProofLevel;
  targetEndpoint?: string;
  fieldPath?: string;
  evidenceId?: number;
  recommendation?: string;
  restoreStatus?: string;
}

/** The `findings` table's first writer for business-logic findings — severity/category/confidence/proofLevel are always persisted as the four independent columns the schema already defines, never collapsed into one. */
export function recordBusinessFinding(db: Db, input: BusinessFindingInput): number {
  const result = db
    .prepare(
      `INSERT INTO findings (scan_run_id, title, severity, category, confidence, proof_level, target_endpoint, field_path, evidence_id, recommendation, restore_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.scanRunId,
      input.title,
      input.severity,
      input.category,
      input.confidence,
      input.proofLevel,
      input.targetEndpoint ?? null,
      input.fieldPath ?? null,
      input.evidenceId ?? null,
      input.recommendation ?? null,
      input.restoreStatus ?? null,
    );
  return Number(result.lastInsertRowid);
}

interface BusinessFindingRow {
  id: number;
  scan_run_id: number;
  title: string;
  severity: BusinessFindingSeverity;
  category: BusinessFindingType | null;
  confidence: BusinessFindingConfidence | null;
  proof_level: BusinessFindingProofLevel | null;
  target_endpoint: string | null;
  field_path: string | null;
  evidence_id: number | null;
  recommendation: string | null;
  restore_status: string | null;
}

export interface BusinessFindingRecord {
  id: number;
  scanRunId: number;
  title: string;
  severity: BusinessFindingSeverity;
  category?: BusinessFindingType;
  confidence?: BusinessFindingConfidence;
  proofLevel?: BusinessFindingProofLevel;
  targetEndpoint?: string;
  fieldPath?: string;
  evidenceId?: number;
  recommendation?: string;
  restoreStatus?: string;
}

function rowToRecord(row: BusinessFindingRow): BusinessFindingRecord {
  const record: BusinessFindingRecord = { id: row.id, scanRunId: row.scan_run_id, title: row.title, severity: row.severity };
  if (row.category !== null) record.category = row.category;
  if (row.confidence !== null) record.confidence = row.confidence;
  if (row.proof_level !== null) record.proofLevel = row.proof_level;
  if (row.target_endpoint !== null) record.targetEndpoint = row.target_endpoint;
  if (row.field_path !== null) record.fieldPath = row.field_path;
  if (row.evidence_id !== null) record.evidenceId = row.evidence_id;
  if (row.recommendation !== null) record.recommendation = row.recommendation;
  if (row.restore_status !== null) record.restoreStatus = row.restore_status;
  return record;
}

export function listBusinessFindings(db: Db, scanRunId: number): BusinessFindingRecord[] {
  const rows = db.prepare("SELECT * FROM findings WHERE scan_run_id = ? ORDER BY id").all(scanRunId) as unknown as BusinessFindingRow[];
  return rows.map(rowToRecord);
}
