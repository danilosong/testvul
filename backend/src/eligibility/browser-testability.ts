export type BrowserTestability = "REQUIRES_BROWSER_RUNTIME" | "BROWSER_TESTABLE" | "BROWSER_INCONCLUSIVE" | "DRY_RUN_UNAVAILABLE" | "FULLY_TESTABLE";

export interface BrowserTestabilityInput {
  /** An API-level `DiscoveredOperation` eligible for the write, independent of any browser data. */
  hasEligibleApiOperation: boolean;
  /** Whether the Browser Security Testing Engine (Section 12) has run against this candidate at all. */
  browserDiscoveryAttempted: boolean;
  /** A page hosting the corresponding UI action was discovered during browser-runtime discovery. */
  browserRenderablePageFound?: boolean;
  /** The Browser Dry-Run Request Capture outcome (design.md Decision 38), when a dry-run was the path to an operation. */
  dryRunOutcome?: "CAPTURED" | "AMBIGUOUS" | "UNAVAILABLE";
}

/**
 * Tags a candidate's browser testability. Every candidate starts (and, per
 * Section 10.2, stays until Section 12 actually runs browser-runtime
 * discovery) as REQUIRES_BROWSER_RUNTIME/pending — there is no code path
 * that infers browser testability from API-only data.
 */
export function classifyBrowserTestability(input: BrowserTestabilityInput): BrowserTestability {
  if (!input.browserDiscoveryAttempted) return "REQUIRES_BROWSER_RUNTIME";

  if (input.dryRunOutcome === "UNAVAILABLE") return "DRY_RUN_UNAVAILABLE";
  if (input.dryRunOutcome === "AMBIGUOUS") return "BROWSER_INCONCLUSIVE";

  const browserVerificationAvailable = input.browserRenderablePageFound === true || input.dryRunOutcome === "CAPTURED";
  if (!browserVerificationAvailable) return "BROWSER_INCONCLUSIVE";

  return input.hasEligibleApiOperation ? "FULLY_TESTABLE" : "BROWSER_TESTABLE";
}
