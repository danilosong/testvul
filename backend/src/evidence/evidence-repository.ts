import type { Db } from "../db/connection";
import type { EvidenceRecord } from "./evidence-record";

export interface SanitizedEvidenceInput {
  candidateId?: number;
  authProfileId?: number;
  endpoint: string;
  fieldPath: string;
  requestSanitized: unknown;
  responseSanitized: unknown;
  originalValueSanitized: unknown;
  testValueSanitized: unknown;
  verificationOutcome: string;
  restoreStatus?: string;
  /** Set when the response body exceeded `maxEvidenceBodyBytes` and was persisted as a sanitized prefix instead of in full (Section 9.14). */
  truncated?: boolean;
  originalSize?: number;
  contentHash?: string;
}

/** `JSON.stringify(undefined)` returns `undefined` itself (not a string),
 * which SQLite can't bind — an `undefined` sanitized value (e.g. a
 * scanner that never tracked an "original value") is stored as literal
 * JSON `null` instead. */
function stringifyForStorage(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

/** Persists an already-sanitized evidence record — this module never
 * decides what's sensitive; that's the Evidence Collector's job. */
export function saveEvidence(db: Db, scanRunId: number, input: SanitizedEvidenceInput): number {
  const result = db
    .prepare(
      `INSERT INTO evidence
        (scan_run_id, candidate_id, auth_profile_id, endpoint, field_path,
         request_sanitized_json, response_sanitized_json, original_value_sanitized, test_value_sanitized,
         verification_outcome, restore_status, truncated, original_size, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      scanRunId,
      input.candidateId ?? null,
      input.authProfileId ?? null,
      input.endpoint,
      input.fieldPath,
      stringifyForStorage(input.requestSanitized),
      stringifyForStorage(input.responseSanitized),
      stringifyForStorage(input.originalValueSanitized),
      stringifyForStorage(input.testValueSanitized),
      input.verificationOutcome,
      input.restoreStatus ?? null,
      input.truncated ? 1 : 0,
      input.originalSize ?? null,
      input.contentHash ?? null,
    );
  return Number(result.lastInsertRowid);
}

interface EvidenceRow {
  id: number;
  candidate_id: number | null;
  auth_profile_id: number | null;
  endpoint: string;
  field_path: string;
  request_sanitized_json: string;
  response_sanitized_json: string;
  original_value_sanitized: string;
  test_value_sanitized: string;
  verification_outcome: string;
  restore_status: string | null;
  truncated: number;
  original_size: number | null;
  content_hash: string | null;
  created_at: string;
}

function rowToRecord(row: EvidenceRow): EvidenceRecord {
  const record: EvidenceRecord = {
    id: row.id,
    endpoint: row.endpoint,
    fieldPath: row.field_path,
    requestSanitized: JSON.parse(row.request_sanitized_json),
    responseSanitized: JSON.parse(row.response_sanitized_json),
    originalValueSanitized: JSON.parse(row.original_value_sanitized),
    testValueSanitized: JSON.parse(row.test_value_sanitized),
    verificationOutcome: row.verification_outcome,
    truncated: row.truncated === 1,
    createdAt: row.created_at,
  };
  if (row.candidate_id !== null) record.candidateId = row.candidate_id;
  if (row.auth_profile_id !== null) record.authProfileId = row.auth_profile_id;
  if (row.restore_status !== null) record.restoreStatus = row.restore_status;
  if (row.original_size !== null) record.originalSize = row.original_size;
  if (row.content_hash !== null) record.contentHash = row.content_hash;
  return record;
}

export function getEvidenceById(db: Db, id: number): EvidenceRecord | null {
  const row = db.prepare("SELECT * FROM evidence WHERE id = ?").get(id) as unknown as EvidenceRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function listEvidenceForScanRun(db: Db, scanRunId: number): EvidenceRecord[] {
  const rows = db.prepare("SELECT * FROM evidence WHERE scan_run_id = ? ORDER BY id").all(scanRunId) as unknown as EvidenceRow[];
  return rows.map(rowToRecord);
}
