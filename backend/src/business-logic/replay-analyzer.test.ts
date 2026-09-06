import { describe, expect, it, vi } from "vitest";
import { compareReplayResults, detectIdempotencyMechanism, testReplay, type ReplayAnalysis } from "./replay-analyzer";

describe("detectIdempotencyMechanism (Section 13.13)", () => {
  it("detects an Idempotency-Key header case-insensitively", () => {
    expect(detectIdempotencyMechanism({ "Idempotency-Key": "abc" })).toBe("IDEMPOTENCY_KEY_HEADER");
  });

  it("detects an X-Request-Id header when no Idempotency-Key is present", () => {
    expect(detectIdempotencyMechanism({ "X-Request-Id": "abc" })).toBe("REQUEST_ID_HEADER");
  });

  it("detects a nonce-shaped body field when no header mechanism is present", () => {
    expect(detectIdempotencyMechanism({}, ["nonce"])).toBe("NONCE_FIELD");
  });

  it("returns NONE_DETECTED when nothing is present", () => {
    expect(detectIdempotencyMechanism({ "Content-Type": "application/json" }, ["amount"])).toBe("NONE_DETECTED");
  });
});

describe("compareReplayResults (Section 13.13)", () => {
  it("raises no finding when results are consistent and idempotency was expected", () => {
    const analysis: ReplayAnalysis = { operation: "claim", originalResult: { balance: 100 }, replayResult: { balance: 100 }, expectedIdempotent: true };
    expect(compareReplayResults(analysis)).toEqual({ consistent: true, finding: false });
  });

  it("raises a finding when results differ and idempotency was expected (missing idempotency protection)", () => {
    const analysis: ReplayAnalysis = { operation: "claim", originalResult: { balance: 100 }, replayResult: { balance: 200 }, expectedIdempotent: true };
    expect(compareReplayResults(analysis)).toEqual({ consistent: false, finding: true });
  });

  it("raises no finding when results differ but idempotency was never expected for this operation", () => {
    const analysis: ReplayAnalysis = { operation: "create-order", originalResult: { id: 1 }, replayResult: { id: 2 }, expectedIdempotent: false };
    expect(compareReplayResults(analysis)).toEqual({ consistent: false, finding: false });
  });
});

describe("testReplay (Section 13.13) — LOCAL_FIXTURE gate for FINANCIAL/SENSITIVE candidates", () => {
  it("actually replays a FINANCIAL operation on a LOCAL_FIXTURE target", async () => {
    const performOperation = vi.fn().mockResolvedValueOnce({ balance: 100 }).mockResolvedValueOnce({ balance: 200 });
    const result = await testReplay({
      operation: "claim",
      targetEnvironment: "LOCAL_FIXTURE",
      isFinancialOrSensitive: true,
      expectedIdempotent: true,
      performOperation,
    });
    expect(performOperation).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      status: "TESTED",
      analysis: { operation: "claim", originalResult: { balance: 100 }, replayResult: { balance: 200 }, expectedIdempotent: true },
      comparison: { consistent: false, finding: true },
    });
  });

  it.each(["DEVELOPMENT", "STAGING", "PRODUCTION"] as const)(
    "never invokes performOperation for a FINANCIAL/SENSITIVE candidate against a %s target",
    async (targetEnvironment) => {
      const performOperation = vi.fn();
      const result = await testReplay({
        operation: "claim",
        targetEnvironment,
        isFinancialOrSensitive: true,
        expectedIdempotent: true,
        performOperation,
      });
      expect(performOperation).not.toHaveBeenCalled();
      expect(result).toEqual({ status: "SKIPPED_NOT_LOCAL_FIXTURE" });
    },
  );

  it("still replays a non-financial/non-sensitive candidate on a non-fixture target", async () => {
    const performOperation = vi.fn().mockResolvedValue({ ok: true });
    const result = await testReplay({
      operation: "resend-verification-email",
      targetEnvironment: "PRODUCTION",
      isFinancialOrSensitive: false,
      expectedIdempotent: true,
      performOperation,
    });
    expect(performOperation).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("TESTED");
  });
});
