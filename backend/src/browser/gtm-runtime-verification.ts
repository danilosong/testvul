import type { ObservedRequest } from "./network-observer";

export type GtmRuntimeVerificationResult = "CONFIG_SAVED" | "FRONTEND_CONSUMED" | "NOT_CONSUMED" | "RUNTIME_INCONCLUSIVE";

const GTM_REQUEST_PATTERN = /googletagmanager\.com\/gtm\.js\?id=([A-Za-z0-9_%-]+)/i;

/**
 * GTM Runtime Verification (Section 12.25): classifies frontend GTM
 * consumption from *observed* post-hydration network requests
 * (`network-observer`) — never by loading a malicious/attacker-controlled
 * container, only ever inspecting what the real page itself already
 * requested. Feeds back into Section 11.7's static-only
 * FRONTEND_RUNTIME_NOT_VERIFIED fallback: when this dynamic check is
 * unavailable at all (browser verification disabled), that static
 * fallback is what's used instead; when it *is* available and runs, it
 * produces one of this function's results instead. CONFIG_SAVED is the
 * pre-verification state a GTM Permission Test (Section 11.6) leaves
 * behind before this function has run at all — never a value this
 * function itself returns.
 */
export function classifyGtmRuntimeVerification(
  observedRequests: readonly ObservedRequest[],
  expectedGtmId?: string,
): GtmRuntimeVerificationResult {
  const gtmRequests = observedRequests.filter((r) => GTM_REQUEST_PATTERN.test(r.url));
  if (gtmRequests.length === 0) return "NOT_CONSUMED";

  if (expectedGtmId) {
    const matchesExpected = gtmRequests.some((r) => {
      const match = GTM_REQUEST_PATTERN.exec(r.url);
      return match && decodeURIComponent(match[1]!) === expectedGtmId;
    });
    return matchesExpected ? "FRONTEND_CONSUMED" : "RUNTIME_INCONCLUSIVE";
  }

  return "FRONTEND_CONSUMED";
}
