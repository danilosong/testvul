export type GtmFrontendVerdict =
  | { status: "STATIC_REFERENCE_FOUND"; gtmId: string }
  | { status: "FRONTEND_RUNTIME_NOT_VERIFIED" }
  | { status: "INCONCLUSIVE" };

// The id group is restricted to typical GTM-container-id/query-value
// characters so a dynamically-constructed URL in JS source (e.g.
// `...gtm.js?id=${expression}`) is correctly *not* treated as a static
// reference — `$`, `{`, `(`, and `.` aren't valid here, so the pattern
// simply fails to match template-literal interpolation.
const GTM_SCRIPT_PATTERN = /googletagmanager\.com\/gtm\.js\?id=([A-Za-z0-9_%-]+)/i;

/**
 * GTM frontend consumption verification: detects a static
 * `googletagmanager.com/gtm.js?id=` reference in already-fetched HTML/JS
 * text and extracts the id it loads. A page showing no *static* reference
 * is never concluded "not consumed" — the frontend may still construct
 * the URL dynamically at runtime (client-side JS building the query string
 * from a fetched config value, exactly like this project's own fixture
 * does), which only Section 12's browser-runtime verification can
 * actually confirm. Without that runtime check available,
 * FRONTEND_RUNTIME_NOT_VERIFIED communicates "we could not determine
 * this," never a false negative; with runtime verification available but
 * not yet run through this call, INCONCLUSIVE defers to it.
 */
export function detectGtmFrontendReference(html: string, browserVerificationAvailable: boolean): GtmFrontendVerdict {
  const match = GTM_SCRIPT_PATTERN.exec(html);
  if (match) {
    return { status: "STATIC_REFERENCE_FOUND", gtmId: decodeURIComponent(match[1]!) };
  }
  return browserVerificationAvailable ? { status: "INCONCLUSIVE" } : { status: "FRONTEND_RUNTIME_NOT_VERIFIED" };
}
