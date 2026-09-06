import type { BusinessFindingConfidence, BusinessFindingProofLevel, BusinessFindingType } from "../business-logic/business-findings";
import type { EvidentiaryOutcome } from "../eligibility/candidates-repository";

export type { EvidentiaryOutcome };

/**
 * The Finding data model and severity taxonomy (Section 15.1), shared by
 * every technical scanner's `verify()` result and every business-logic
 * test-plan result — the same `findings` table row shape either kind
 * populates. `category`/`confidence`/`proofLevel` are the business-logic
 * taxonomy (Section 13.20) and stay absent on a technical finding, which
 * has no equivalent — never populated with a guessed or default value.
 */
export type FindingSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface FindingInput {
  scanRunId: number;
  title: string;
  severity: FindingSeverity;
  /** Section 15.2's own taxonomy — required, never left to the schema's NOT_TESTED default by omission. */
  evidentiaryOutcome: EvidentiaryOutcome;
  targetEndpoint?: string;
  fieldPath?: string;
  authProfileId?: number;
  evidenceId?: number;
  recommendation?: string;
  restoreStatus?: string;
  /** Business-logic-only (Section 13.20) — always all three together, or none at all. */
  category?: BusinessFindingType;
  confidence?: BusinessFindingConfidence;
  proofLevel?: BusinessFindingProofLevel;
}

export interface Finding extends FindingInput {
  id: number;
}
