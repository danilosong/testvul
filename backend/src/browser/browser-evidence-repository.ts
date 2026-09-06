import type { Db } from "../db/connection";

export type BrowserEvidenceKind = "SCREENSHOT" | "DOM_SNAPSHOT";

export interface BrowserEvidenceInput {
  scanRunId: number;
  findingId?: number;
  kind: BrowserEvidenceKind;
  /** An opaque reference to where the actual asset (e.g. a screenshot image) is stored — never the raw asset content itself. */
  assetRef?: string;
  /** For a browser-assisted finding (Section 15.5): exactly which browser page/API call/result combination proved it — e.g. `{pageUrl, apiCall: {method, url}, result}`. */
  structuralData?: unknown;
}

/** The missing writer for `browser_evidence` (existed since Section 1's migration, tied to `findings` via `finding_id`, but had no insertion path until Section 15.5's Finding Detail needed to trace a browser-assisted finding back to exactly what proved it). */
export function recordBrowserEvidence(db: Db, input: BrowserEvidenceInput): number {
  const result = db
    .prepare("INSERT INTO browser_evidence (scan_run_id, finding_id, kind, asset_ref, structural_data_json) VALUES (?, ?, ?, ?, ?)")
    .run(input.scanRunId, input.findingId ?? null, input.kind, input.assetRef ?? null, input.structuralData !== undefined ? JSON.stringify(input.structuralData) : null);
  return Number(result.lastInsertRowid);
}

export interface BrowserEvidence {
  id: number;
  scanRunId: number;
  findingId?: number;
  kind: BrowserEvidenceKind;
  assetRef?: string;
  structuralData?: unknown;
}

interface BrowserEvidenceRow {
  id: number;
  scan_run_id: number;
  finding_id: number | null;
  kind: BrowserEvidenceKind;
  asset_ref: string | null;
  structural_data_json: string | null;
}

function rowToEvidence(row: BrowserEvidenceRow): BrowserEvidence {
  const evidence: BrowserEvidence = { id: row.id, scanRunId: row.scan_run_id, kind: row.kind };
  if (row.finding_id !== null) evidence.findingId = row.finding_id;
  if (row.asset_ref !== null) evidence.assetRef = row.asset_ref;
  if (row.structural_data_json !== null) evidence.structuralData = JSON.parse(row.structural_data_json);
  return evidence;
}

export function listBrowserEvidenceForFinding(db: Db, findingId: number): BrowserEvidence[] {
  const rows = db.prepare("SELECT * FROM browser_evidence WHERE finding_id = ? ORDER BY id").all(findingId) as unknown as BrowserEvidenceRow[];
  return rows.map(rowToEvidence);
}
