/**
 * Webhook Authentication Analysis (Section 13.24). Passively inspects an
 * *observed* inbound call's own headers/body for signature/HMAC/shared-
 * secret/timestamp/nonce indicators — never declares a vulnerability from
 * their absence alone: `NO_MECHANISM_OBSERVED` is a classification, not a
 * finding. (Certificate/provider-verification indicators come from TLS/
 * technology detection elsewhere, not this function's own signal set.)
 */
export type WebhookAuthAnalysisResult = "VERIFIED_MECHANISM_DETECTED" | "NO_MECHANISM_OBSERVED" | "INCONCLUSIVE";

export interface WebhookAuthenticationObservation {
  /** False when no call to this endpoint was ever observed at all — there is nothing to analyze, so the result is INCONCLUSIVE rather than a guessed NO_MECHANISM_OBSERVED. */
  requestObserved: boolean;
  headers: Readonly<Record<string, string>>;
}

const SIGNATURE_OR_HMAC_HEADER_PATTERN = /signature|hmac/i;
const SHARED_SECRET_HEADER_PATTERN = /secret|api-?key/i;
const TIMESTAMP_HEADER_PATTERN = /timestamp/i;
const NONCE_HEADER_PATTERN = /nonce/i;

function hasAuthenticationIndicator(headers: Readonly<Record<string, string>>): boolean {
  return Object.keys(headers).some(
    (name) =>
      SIGNATURE_OR_HMAC_HEADER_PATTERN.test(name) ||
      SHARED_SECRET_HEADER_PATTERN.test(name) ||
      TIMESTAMP_HEADER_PATTERN.test(name) ||
      NONCE_HEADER_PATTERN.test(name),
  );
}

export function analyzeWebhookAuthentication(observation: WebhookAuthenticationObservation): WebhookAuthAnalysisResult {
  if (!observation.requestObserved) return "INCONCLUSIVE";
  return hasAuthenticationIndicator(observation.headers) ? "VERIFIED_MECHANISM_DETECTED" : "NO_MECHANISM_OBSERVED";
}
