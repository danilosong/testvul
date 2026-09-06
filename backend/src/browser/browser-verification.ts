/**
 * Scaffold — filled in alongside Sections 12.22/12.24/12.25 (browser-
 * assisted authorization testing, DOM-based Stored XSS verification, GTM
 * Runtime Verification). Orchestrates a verification pass over a
 * navigated page using `dom-analyzer`/`network-observer`, producing a
 * confirmed outcome rather than concluding from a status code or
 * discovery-time data alone (e.g. "a 200 status is never sufficient" —
 * the same principle Section 11.10's Read IDOR positive-content
 * confirmation already applies to the API-only path).
 */
export type BrowserVerificationOutcome = "CONFIRMED" | "NOT_CONFIRMED" | "INCONCLUSIVE";
