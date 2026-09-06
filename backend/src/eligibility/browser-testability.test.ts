import { describe, expect, it } from "vitest";
import { classifyBrowserTestability } from "./browser-testability";

describe("classifyBrowserTestability", () => {
  it("stays REQUIRES_BROWSER_RUNTIME/pending until browser-runtime discovery has run at all", () => {
    expect(
      classifyBrowserTestability({ hasEligibleApiOperation: true, browserDiscoveryAttempted: false }),
    ).toBe("REQUIRES_BROWSER_RUNTIME");
  });

  it("is FULLY_TESTABLE once both an eligible API operation and a discovered browser-renderable page are present", () => {
    expect(
      classifyBrowserTestability({
        hasEligibleApiOperation: true,
        browserDiscoveryAttempted: true,
        browserRenderablePageFound: true,
      }),
    ).toBe("FULLY_TESTABLE");
  });

  it("is BROWSER_TESTABLE when only browser-level verification is available, with no API-level operation", () => {
    expect(
      classifyBrowserTestability({
        hasEligibleApiOperation: false,
        browserDiscoveryAttempted: true,
        browserRenderablePageFound: true,
      }),
    ).toBe("BROWSER_TESTABLE");
  });

  it("is FULLY_TESTABLE when a successful dry-run capture provides the operation, alongside an API-level operation", () => {
    expect(
      classifyBrowserTestability({ hasEligibleApiOperation: true, browserDiscoveryAttempted: true, dryRunOutcome: "CAPTURED" }),
    ).toBe("FULLY_TESTABLE");
  });

  it("is DRY_RUN_UNAVAILABLE when the only path to an operation is an unsafely-capturable dry-run", () => {
    expect(
      classifyBrowserTestability({ hasEligibleApiOperation: false, browserDiscoveryAttempted: true, dryRunOutcome: "UNAVAILABLE" }),
    ).toBe("DRY_RUN_UNAVAILABLE");
  });

  it("is BROWSER_INCONCLUSIVE when a dry-run capture is ambiguous", () => {
    expect(
      classifyBrowserTestability({ hasEligibleApiOperation: false, browserDiscoveryAttempted: true, dryRunOutcome: "AMBIGUOUS" }),
    ).toBe("BROWSER_INCONCLUSIVE");
  });

  it("is BROWSER_INCONCLUSIVE when browser discovery was attempted but found nothing usable", () => {
    expect(
      classifyBrowserTestability({ hasEligibleApiOperation: true, browserDiscoveryAttempted: true }),
    ).toBe("BROWSER_INCONCLUSIVE");
  });
});
