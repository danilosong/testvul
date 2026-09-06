import type { BusinessFindingConfidence, BusinessFindingProofLevel, BusinessFindingType } from "../business-logic/business-findings";
import type { BusinessTestPlan } from "../business-logic/business-test-plan";
import type { FindingInput, FindingSeverity } from "./finding";
import { evidentiaryOutcomeForBusinessProofLevel } from "./evidentiary-outcome";

export interface BuildBusinessFindingParams {
  scanRunId: number;
  plan: BusinessTestPlan;
  category: BusinessFindingType;
  confidence: BusinessFindingConfidence;
  proofLevel: BusinessFindingProofLevel;
  severity: FindingSeverity;
  /** Whether the underlying comparison/invariant evaluation actually detected a violation — feeds `evidentiaryOutcomeForBusinessProofLevel` (Section 15.2), so PROVEN_VULNERABLE still only ever comes from CONFIRMED/SAFE_PROBE_CONFIRMED. */
  violationDetected: boolean;
  evidenceId?: number;
}

/** Populates a Finding from a business-logic test-plan result (Section 15.1) — always carries all three of category/confidence/proofLevel, since a business-logic finding without them would leave design.md's OBSERVED/INFERRED-never-CONFIRMED distinction (Section 13.20) unrepresented. */
export function buildBusinessFindingInput(params: BuildBusinessFindingParams): FindingInput {
  const finding: FindingInput = {
    scanRunId: params.scanRunId,
    title: params.plan.expectedBehavior,
    severity: params.severity,
    evidentiaryOutcome: evidentiaryOutcomeForBusinessProofLevel(params.proofLevel, params.violationDetected),
    targetEndpoint: params.plan.candidate.resourceUrl,
    category: params.category,
    confidence: params.confidence,
    proofLevel: params.proofLevel,
  };
  if (params.plan.candidate.fieldPath !== undefined) finding.fieldPath = params.plan.candidate.fieldPath;
  if (params.evidenceId !== undefined) finding.evidenceId = params.evidenceId;
  return finding;
}
