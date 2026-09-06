import type { Db } from "../db/connection";
import type { BusinessFindingConfidence, BusinessFindingProofLevel, BusinessFindingType } from "../business-logic/business-findings";
import type { EvidentiaryOutcome, Finding, FindingInput } from "./finding";

/** The single insertion path every technical scanner and every business-logic test plan is meant to go through to record a finding (Section 15.1) — the same `findings` table 13.20's business-logic-specific writer already used, generalized so a technical finding can populate it too. */
export function recordFinding(db: Db, input: FindingInput): number {
  const result = db
    .prepare(
      `INSERT INTO findings (scan_run_id, title, severity, evidentiary_outcome, category, confidence, proof_level, target_endpoint, field_path, auth_profile_id, evidence_id, recommendation, restore_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.scanRunId,
      input.title,
      input.severity,
      input.evidentiaryOutcome,
      input.category ?? null,
      input.confidence ?? null,
      input.proofLevel ?? null,
      input.targetEndpoint ?? null,
      input.fieldPath ?? null,
      input.authProfileId ?? null,
      input.evidenceId ?? null,
      input.recommendation ?? null,
      input.restoreStatus ?? null,
    );
  return Number(result.lastInsertRowid);
}

interface FindingRow {
  id: number;
  scan_run_id: number;
  title: string;
  severity: Finding["severity"];
  evidentiary_outcome: EvidentiaryOutcome;
  category: BusinessFindingType | null;
  confidence: BusinessFindingConfidence | null;
  proof_level: BusinessFindingProofLevel | null;
  target_endpoint: string | null;
  field_path: string | null;
  auth_profile_id: number | null;
  evidence_id: number | null;
  recommendation: string | null;
  restore_status: string | null;
}

function rowToFinding(row: FindingRow): Finding {
  const finding: Finding = { id: row.id, scanRunId: row.scan_run_id, title: row.title, severity: row.severity, evidentiaryOutcome: row.evidentiary_outcome };
  if (row.category !== null) finding.category = row.category;
  if (row.confidence !== null) finding.confidence = row.confidence;
  if (row.proof_level !== null) finding.proofLevel = row.proof_level;
  if (row.target_endpoint !== null) finding.targetEndpoint = row.target_endpoint;
  if (row.field_path !== null) finding.fieldPath = row.field_path;
  if (row.auth_profile_id !== null) finding.authProfileId = row.auth_profile_id;
  if (row.evidence_id !== null) finding.evidenceId = row.evidence_id;
  if (row.recommendation !== null) finding.recommendation = row.recommendation;
  if (row.restore_status !== null) finding.restoreStatus = row.restore_status;
  return finding;
}

export function listFindings(db: Db, scanRunId: number): Finding[] {
  const rows = db.prepare("SELECT * FROM findings WHERE scan_run_id = ? ORDER BY id").all(scanRunId) as unknown as FindingRow[];
  return rows.map(rowToFinding);
}

export function getFinding(db: Db, id: number): Finding | null {
  const row = db.prepare("SELECT * FROM findings WHERE id = ?").get(id) as unknown as FindingRow | undefined;
  return row ? rowToFinding(row) : null;
}
