import { describe, expect, it } from "vitest";
import { classifyWebhookTrustBoundary } from "./webhook-trust-boundary";

describe("classifyWebhookTrustBoundary", () => {
  it("classifies INCONCLUSIVE_TRUST_BOUNDARY when the authentication mechanism could not be determined with confidence", () => {
    expect(classifyWebhookTrustBoundary("INCONCLUSIVE")).toBe("INCONCLUSIVE_TRUST_BOUNDARY");
  });

  it("defers to business-logic-testing (returns undefined) when a mechanism was confidently detected", () => {
    expect(classifyWebhookTrustBoundary("VERIFIED_MECHANISM_DETECTED")).toBeUndefined();
  });

  it("defers to business-logic-testing (returns undefined) when no mechanism was observed at all", () => {
    expect(classifyWebhookTrustBoundary("NO_MECHANISM_OBSERVED")).toBeUndefined();
  });
});
