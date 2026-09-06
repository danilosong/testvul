/**
 * Scaffold — filled in by Section 13.20 (the business-logic finding
 * taxonomy). An OBSERVED/INFERRED hypothesis is never presented as
 * CONFIRMED — severity, confidence, and proof-level are tracked as three
 * independent attributes.
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
