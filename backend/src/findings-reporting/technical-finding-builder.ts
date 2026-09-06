import type { ScannerVerdict } from "../scanners/security-scanner";
import type { FindingInput, FindingSeverity } from "./finding";

/**
 * Populates a Finding from a technical scanner's `verify()` result
 * (Section 15.1). Only a verdict that is actually finding-worthy ever
 * reaches here — REMOVED/ESCAPED/HTML_ALLOWED (the base canary was
 * neutralized, including by a working, intentional sanitizer allowlist)
 * are never findings at all, matching design.md Decision 23's "never use
 * execution language unless execution was actually observed" and "give
 * fields with an intentional, working HTML allowlist a non-alarming
 * classification instead of flagging them as vulnerable."
 */
const XSS_FINDING_SEVERITY: Partial<Record<ScannerVerdict, FindingSeverity>> = {
  RAW_HTML: "HIGH",
  UNSAFE_ATTRIBUTE_SURVIVED: "HIGH",
  POTENTIALLY_EXECUTABLE: "CRITICAL",
  EXECUTION_CONFIRMED: "CRITICAL",
};

export function isXssFindingWorthyVerdict(verdict: ScannerVerdict): boolean {
  return verdict in XSS_FINDING_SEVERITY;
}

export class NotAFindingWorthyVerdictError extends Error {
  constructor(verdict: string) {
    super(`"${verdict}" is not a finding-worthy XSS verdict — REMOVED/ESCAPED/HTML_ALLOWED never produce a finding`);
    this.name = "NotAFindingWorthyVerdictError";
  }
}

export function severityForXssVerdict(verdict: ScannerVerdict): FindingSeverity {
  const severity = XSS_FINDING_SEVERITY[verdict];
  if (!severity) throw new NotAFindingWorthyVerdictError(verdict);
  return severity;
}

export interface BuildTechnicalFindingParams {
  scanRunId: number;
  title: string;
  severity: FindingSeverity;
  /** Compute via `evidentiaryOutcomeForXssVerdict`/the equivalent for whichever scanner this finding came from (Section 15.2) — never left to the schema's NOT_TESTED default. */
  evidentiaryOutcome: FindingInput["evidentiaryOutcome"];
  targetEndpoint: string;
  fieldPath?: string;
  authProfileId?: number;
  evidenceId?: number;
  recommendation?: string;
  restoreStatus?: string;
}

/** A technical finding never carries the business-logic taxonomy (category/confidence/proofLevel) — there is no field in this function's own parameter list capable of setting one. */
export function buildTechnicalFindingInput(params: BuildTechnicalFindingParams): FindingInput {
  return { ...params };
}
