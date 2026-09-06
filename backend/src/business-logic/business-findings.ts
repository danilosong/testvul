/**
 * The business-logic finding taxonomy (Section 13.20). Severity,
 * confidence, and proof level are three independent attributes — a
 * finding always carries all three, and none is ever derived from
 * another. An OBSERVED/INFERRED hypothesis is never presented as
 * CONFIRMED: only CONFIRMED and SAFE_PROBE_CONFIRMED count as confirmed
 * for rendering purposes (`getFindingConfirmationLabel` below).
 */
export type BusinessFindingType =
  | "BUSINESS_LOGIC"
  | "WORKFLOW_BYPASS"
  | "PARAMETER_TAMPERING"
  | "SERVER_CONTROLLED_FIELD"
  | "STATE_EXPOSURE"
  | "PREDICTABILITY"
  | "REPLAY"
  | "MISSING_IDEMPOTENCY"
  | "RACE_CONDITION"
  | "LIMIT_BYPASS"
  | "INVALID_STATE_TRANSITION"
  | "BUSINESS_AUTHORIZATION"
  | "BUSINESS_STATE_INFERENCE";

export type BusinessFindingProofLevel = "OBSERVED" | "INFERRED" | "SAFE_PROBE_CONFIRMED" | "CONFIRMED" | "INCONCLUSIVE" | "NOT_TESTED";

export type BusinessFindingSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type BusinessFindingConfidence = "LOW" | "MEDIUM" | "HIGH";

export type FindingConfirmationLabel = "CONFIRMED" | "UNCONFIRMED";

/**
 * The single source of truth for whether a finding may ever be labeled
 * "confirmed" anywhere it's rendered (UI, report, API serialization).
 * OBSERVED and INFERRED — a raw observation and a logical inference,
 * neither independently verified — are always UNCONFIRMED, no matter how
 * severe their configured severity/confidence is.
 */
export function getFindingConfirmationLabel(proofLevel: BusinessFindingProofLevel): FindingConfirmationLabel {
  return proofLevel === "CONFIRMED" || proofLevel === "SAFE_PROBE_CONFIRMED" ? "CONFIRMED" : "UNCONFIRMED";
}

export interface RenderableBusinessFinding {
  title: string;
  proofLevel: BusinessFindingProofLevel;
}

/**
 * The rendering entry point every UI/report surface is meant to go
 * through — never its own ad hoc "confirmed" string. Prefixes the title
 * with the finding's actual proof level for an UNCONFIRMED finding, so a
 * reader never mistakes "we observed X" or "X was merely inferred" for a
 * proven vulnerability.
 */
export function describeBusinessFinding(finding: RenderableBusinessFinding): string {
  const label = getFindingConfirmationLabel(finding.proofLevel);
  return label === "CONFIRMED" ? `[CONFIRMED] ${finding.title}` : `[${finding.proofLevel}] ${finding.title}`;
}
