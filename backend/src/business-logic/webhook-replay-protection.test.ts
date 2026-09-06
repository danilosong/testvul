import { describe, expect, it, vi } from "vitest";
import { evaluateWebhookReplayGate, testWebhookReplayProtection } from "./webhook-replay-protection";

describe("evaluateWebhookReplayGate (Section 13.26)", () => {
  it.each(["DEVELOPMENT", "STAGING", "PRODUCTION"] as const)("classifies PASSIVE for a %s (non-fixture) target", (targetEnvironment) => {
    expect(evaluateWebhookReplayGate({ targetEnvironment, isTestResource: true })).toBe("PASSIVE");
  });

  it("classifies INCONCLUSIVE for a LOCAL_FIXTURE target lacking an explicit TEST_RESOURCE declaration", () => {
    expect(evaluateWebhookReplayGate({ targetEnvironment: "LOCAL_FIXTURE", isTestResource: false })).toBe("INCONCLUSIVE");
  });

  it("classifies TESTED for a LOCAL_FIXTURE target with an explicit TEST_RESOURCE declaration", () => {
    expect(evaluateWebhookReplayGate({ targetEnvironment: "LOCAL_FIXTURE", isTestResource: true })).toBe("TESTED");
  });
});

describe("testWebhookReplayProtection (Section 13.26) — integrates with Section 13.13's Replay and Idempotency Analysis", () => {
  it("detects a correctly-idempotent webhook callback replay", async () => {
    const performCallback = vi.fn().mockResolvedValue({ ticket: { status: "PAID" } });
    const result = await testWebhookReplayProtection({
      targetEnvironment: "LOCAL_FIXTURE",
      isTestResource: true,
      operation: "POST /api/contest/payments/webhook",
      performCallback,
    });
    expect(performCallback).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      status: "TESTED",
      replay: {
        status: "TESTED",
        analysis: {
          operation: "POST /api/contest/payments/webhook",
          originalResult: { ticket: { status: "PAID" } },
          replayResult: { ticket: { status: "PAID" } },
          expectedIdempotent: true,
        },
        comparison: { consistent: true, finding: false },
      },
    });
  });

  it("flags Missing Idempotency Protection when replaying the callback duplicates its effect", async () => {
    const performCallback = vi
      .fn()
      .mockResolvedValueOnce({ balance: 100 })
      .mockResolvedValueOnce({ balance: 200 });
    const result = await testWebhookReplayProtection({
      targetEnvironment: "LOCAL_FIXTURE",
      isTestResource: true,
      operation: "POST /webhook/reward-credit",
      performCallback,
    });
    expect(result.status).toBe("TESTED");
    if (result.status !== "TESTED" || result.replay.status !== "TESTED") throw new Error("unreachable");
    expect(result.replay.comparison).toEqual({ consistent: false, finding: true });
  });

  it("never replays a callback against a production, non-TEST_RESOURCE target", async () => {
    const performCallback = vi.fn();
    const result = await testWebhookReplayProtection({
      targetEnvironment: "PRODUCTION",
      isTestResource: false,
      operation: "POST /api/contest/payments/webhook",
      performCallback,
    });
    expect(performCallback).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "PASSIVE" });
  });

  it("never replays a callback against a LOCAL_FIXTURE target whose resource isn't an explicit TEST_RESOURCE", async () => {
    const performCallback = vi.fn();
    const result = await testWebhookReplayProtection({
      targetEnvironment: "LOCAL_FIXTURE",
      isTestResource: false,
      operation: "POST /api/contest/payments/webhook",
      performCallback,
    });
    expect(performCallback).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "INCONCLUSIVE" });
  });
});
