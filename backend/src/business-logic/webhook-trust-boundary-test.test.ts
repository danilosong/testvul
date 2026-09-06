import { describe, expect, it, vi } from "vitest";
import { evaluateWebhookTrustBoundaryGate, testWebhookTrustBoundary } from "./webhook-trust-boundary-test";

describe("evaluateWebhookTrustBoundaryGate (Section 13.25)", () => {
  it.each(["DEVELOPMENT", "STAGING", "PRODUCTION"] as const)("classifies PASSIVE for a %s (non-fixture) target regardless of TEST_RESOURCE status", (targetEnvironment) => {
    expect(evaluateWebhookTrustBoundaryGate({ targetEnvironment, isTestResource: true })).toBe("PASSIVE");
  });

  it("classifies INCONCLUSIVE for a LOCAL_FIXTURE target whose resource isn't declared TEST_RESOURCE", () => {
    expect(evaluateWebhookTrustBoundaryGate({ targetEnvironment: "LOCAL_FIXTURE", isTestResource: false })).toBe("INCONCLUSIVE");
  });

  it("classifies TESTED only for a LOCAL_FIXTURE target with an explicit TEST_RESOURCE declaration", () => {
    expect(evaluateWebhookTrustBoundaryGate({ targetEnvironment: "LOCAL_FIXTURE", isTestResource: true })).toBe("TESTED");
  });
});

describe("testWebhookTrustBoundary (Section 13.25)", () => {
  it("never sends a forged callback against a non-fixture target", async () => {
    const performForgedCallback = vi.fn();
    const result = await testWebhookTrustBoundary({ targetEnvironment: "PRODUCTION", isTestResource: true, performForgedCallback });
    expect(performForgedCallback).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "PASSIVE" });
  });

  it("never sends a forged callback against a LOCAL_FIXTURE target lacking an explicit TEST_RESOURCE declaration", async () => {
    const performForgedCallback = vi.fn();
    const result = await testWebhookTrustBoundary({ targetEnvironment: "LOCAL_FIXTURE", isTestResource: false, performForgedCallback });
    expect(performForgedCallback).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "INCONCLUSIVE" });
  });

  it("raises a BUSINESS_TRUST_BOUNDARY finding when the forged callback is accepted and causes a real state transition", async () => {
    const performForgedCallback = vi.fn().mockResolvedValue({ accepted: true, stateTransitionOccurred: true });
    const result = await testWebhookTrustBoundary({ targetEnvironment: "LOCAL_FIXTURE", isTestResource: true, performForgedCallback });
    expect(result).toEqual({ status: "TESTED", accepted: true, causedStateTransition: true, finding: true });
  });

  it("raises no finding when the forged callback is rejected", async () => {
    const performForgedCallback = vi.fn().mockResolvedValue({ accepted: false, stateTransitionOccurred: false });
    const result = await testWebhookTrustBoundary({ targetEnvironment: "LOCAL_FIXTURE", isTestResource: true, performForgedCallback });
    expect(result).toEqual({ status: "TESTED", accepted: false, causedStateTransition: false, finding: false });
  });

  it("raises no finding when the forged callback is accepted but inert (no real effect)", async () => {
    const performForgedCallback = vi.fn().mockResolvedValue({ accepted: true, stateTransitionOccurred: false });
    const result = await testWebhookTrustBoundary({ targetEnvironment: "LOCAL_FIXTURE", isTestResource: true, performForgedCallback });
    expect(result.finding).toBe(false);
  });
});
