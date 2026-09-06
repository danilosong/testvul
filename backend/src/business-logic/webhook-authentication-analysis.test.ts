import { describe, expect, it } from "vitest";
import { analyzeWebhookAuthentication } from "./webhook-authentication-analysis";

describe("analyzeWebhookAuthentication (Section 13.24)", () => {
  it("returns INCONCLUSIVE when no call to the endpoint was ever observed", () => {
    expect(analyzeWebhookAuthentication({ requestObserved: false, headers: {} })).toBe("INCONCLUSIVE");
  });

  it("returns NO_MECHANISM_OBSERVED for an observed call carrying no authentication indicator at all — never itself a finding", () => {
    const result = analyzeWebhookAuthentication({ requestObserved: true, headers: { "Content-Type": "application/json" } });
    expect(result).toBe("NO_MECHANISM_OBSERVED");
  });

  it.each([
    ["X-Webhook-Signature", "signature header"],
    ["X-Hub-Signature-256", "HMAC-shaped signature header"],
    ["X-Api-Key", "shared-secret-shaped header"],
    ["X-Timestamp", "timestamp header"],
    ["X-Nonce", "nonce header"],
  ])("returns VERIFIED_MECHANISM_DETECTED when the observed call carries a %s (%s)", (headerName) => {
    const result = analyzeWebhookAuthentication({ requestObserved: true, headers: { [headerName]: "x" } });
    expect(result).toBe("VERIFIED_MECHANISM_DETECTED");
  });
});
