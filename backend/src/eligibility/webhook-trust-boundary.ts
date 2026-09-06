export type WebhookAuthAnalysisResult = "VERIFIED_MECHANISM_DETECTED" | "NO_MECHANISM_OBSERVED" | "INCONCLUSIVE";

/**
 * Classifies a webhook/callback's authentication analysis into the
 * business-logic-specific eligibility state per `candidate-eligibility`:
 * INCONCLUSIVE_TRUST_BOUNDARY when the mechanism could not be determined
 * with confidence. Returns `undefined` for the other two outcomes — those
 * feed Section 13's full business-logic finding evaluation rather than
 * this narrow classification.
 */
export function classifyWebhookTrustBoundary(authAnalysisResult: WebhookAuthAnalysisResult): "INCONCLUSIVE_TRUST_BOUNDARY" | undefined {
  return authAnalysisResult === "INCONCLUSIVE" ? "INCONCLUSIVE_TRUST_BOUNDARY" : undefined;
}
