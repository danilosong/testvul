import type { Db } from "../db/connection";
import { classifyEligibility, type EligibilityCandidateInput, type EligibilityState } from "./eligibility-classifier";
import { classifyBrowserTestability, type BrowserTestability } from "./browser-testability";
import { hasEligibleOperation } from "../operation-discovery/discovered-operation";

export interface CandidateInsertInput extends Omit<EligibilityCandidateInput, "db"> {
  scanner: string;
  confidence?: "LOW" | "MEDIUM" | "HIGH";
  priority?: 1 | 2 | 3;
  endpointId?: number;
  operationId?: number;
  /** Whether the Browser Security Testing Engine (Section 12) has run against this candidate at all — defaults to false (REQUIRES_BROWSER_RUNTIME/pending, per Section 10.2). */
  browserDiscoveryAttempted?: boolean;
  browserRenderablePageFound?: boolean;
  dryRunOutcome?: "CAPTURED" | "AMBIGUOUS" | "UNAVAILABLE";
}

export type EvidentiaryOutcome = "PROVEN_VULNERABLE" | "PROVEN_BLOCKED" | "INCONCLUSIVE" | "NOT_TESTED";

export interface CandidateRecord {
  id: number;
  scanRunId: number;
  scanner: string;
  fieldPath?: string;
  confidence?: string;
  priority?: number;
  eligibilityState: EligibilityState;
  browserTestability: BrowserTestability;
  evidentiaryOutcome: EvidentiaryOutcome;
  createdAt: string;
}

interface CandidateRow {
  id: number;
  scan_run_id: number;
  scanner: string;
  field_path: string | null;
  confidence: string | null;
  priority: number | null;
  eligibility_state: EligibilityState;
  browser_testability: BrowserTestability;
  evidentiary_outcome: EvidentiaryOutcome;
  created_at: string;
}

function rowToRecord(row: CandidateRow): CandidateRecord {
  const record: CandidateRecord = {
    id: row.id,
    scanRunId: row.scan_run_id,
    scanner: row.scanner,
    eligibilityState: row.eligibility_state,
    browserTestability: row.browser_testability,
    evidentiaryOutcome: row.evidentiary_outcome,
    createdAt: row.created_at,
  };
  if (row.field_path !== null) record.fieldPath = row.field_path;
  if (row.confidence !== null) record.confidence = row.confidence;
  if (row.priority !== null) record.priority = row.priority;
  return record;
}

/** Records the result of an actual test run against a TESTABLE candidate. Never called for a SKIPPED_ or INCONCLUSIVE candidate — those never ran a test at all. */
export function updateEvidentiaryOutcome(db: Db, candidateId: number, outcome: EvidentiaryOutcome): void {
  db.prepare("UPDATE candidates SET evidentiary_outcome = ? WHERE id = ?").run(outcome, candidateId);
}

/**
 * Computes eligibility and browser testability synchronously (per
 * `candidate-eligibility`'s Eligibility Classification Before Queueing
 * requirement) and persists the candidate with both states already set —
 * there is no separate "queue admission" step that could ever see a
 * candidate before its eligibility is known.
 */
export function insertCandidate(db: Db, scanRunId: number, input: CandidateInsertInput): CandidateRecord {
  const eligibilityState = classifyEligibility({ db, ...input });

  const hasEligibleApiOperation = hasEligibleOperation(input.operations, input.writeMethod, input.resourceUrl, input.minConfidence);
  const browserTestability = classifyBrowserTestability({
    hasEligibleApiOperation,
    browserDiscoveryAttempted: input.browserDiscoveryAttempted ?? false,
    ...(input.browserRenderablePageFound !== undefined ? { browserRenderablePageFound: input.browserRenderablePageFound } : {}),
    ...(input.dryRunOutcome !== undefined ? { dryRunOutcome: input.dryRunOutcome } : {}),
  });

  const result = db
    .prepare(
      `INSERT INTO candidates (scan_run_id, scanner, endpoint_id, operation_id, field_path, confidence, priority, eligibility_state, browser_testability)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      scanRunId,
      input.scanner,
      input.endpointId ?? null,
      input.operationId ?? null,
      input.fieldPath ?? null,
      input.confidence ?? null,
      input.priority ?? null,
      eligibilityState,
      browserTestability,
    );

  return getCandidateById(db, Number(result.lastInsertRowid))!;
}

export function getCandidateById(db: Db, id: number): CandidateRecord | null {
  const row = db.prepare("SELECT * FROM candidates WHERE id = ?").get(id) as unknown as CandidateRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function listCandidatesForScanRun(db: Db, scanRunId: number): CandidateRecord[] {
  const rows = db.prepare("SELECT * FROM candidates WHERE scan_run_id = ? ORDER BY id").all(scanRunId) as unknown as CandidateRow[];
  return rows.map(rowToRecord);
}
