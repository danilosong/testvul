import { describe, expect, it, vi } from "vitest";
import type { Locator } from "playwright";
import {
  classifyClientLimitSignal,
  evaluateBusinessLimitEnforcement,
  observeClientLimitElementState,
  testBusinessLimitEnforcement,
} from "./business-limit-analyzer";

describe("classifyClientLimitSignal (Section 13.16)", () => {
  it("classifies DISABLED first when multiple signals are present", () => {
    expect(classifyClientLimitSignal({ disabled: true, hidden: true, readonly: true })).toBe("DISABLED");
  });

  it("classifies HIDDEN when not disabled but hidden", () => {
    expect(classifyClientLimitSignal({ disabled: false, hidden: true, readonly: false })).toBe("HIDDEN");
  });

  it("classifies READONLY when neither disabled nor hidden", () => {
    expect(classifyClientLimitSignal({ disabled: false, hidden: false, readonly: true })).toBe("READONLY");
  });

  it("classifies NONE when no signal is present", () => {
    expect(classifyClientLimitSignal({ disabled: false, hidden: false, readonly: false })).toBe("NONE");
  });
});

describe("observeClientLimitElementState (Section 13.16)", () => {
  it("delegates to the locator's own DOM evaluation", async () => {
    const evaluate = vi.fn().mockResolvedValue({ disabled: true, hidden: false, readonly: false });
    const locator = { evaluate } as unknown as Locator;
    const state = await observeClientLimitElementState(locator);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(state).toEqual({ disabled: true, hidden: false, readonly: false });
  });
});

describe("evaluateBusinessLimitEnforcement (Section 13.16)", () => {
  it("raises a Server-Side Business Limit Not Enforced finding when the UI signals a limit but the backend accepts an over-limit request", () => {
    expect(evaluateBusinessLimitEnforcement("DISABLED", true)).toEqual({ clientLimitSignal: "DISABLED", backendAccepted: true, finding: true });
  });

  it("raises no finding when the UI signals a limit and the backend correctly rejects the over-limit request", () => {
    expect(evaluateBusinessLimitEnforcement("DISABLED", false)).toEqual({ clientLimitSignal: "DISABLED", backendAccepted: false, finding: false });
  });

  it("raises no finding when the UI never signaled any limit at all, regardless of backend behavior", () => {
    expect(evaluateBusinessLimitEnforcement("NONE", true)).toEqual({ clientLimitSignal: "NONE", backendAccepted: true, finding: false });
  });
});

describe("testBusinessLimitEnforcement (Section 13.16)", () => {
  it("composes the client-side observation and the backend probe into one result", async () => {
    const result = await testBusinessLimitEnforcement({
      observeClientLimitSignal: async () => "DISABLED",
      attemptOverLimitRequest: async () => ({ accepted: true }),
    });
    expect(result).toEqual({ clientLimitSignal: "DISABLED", backendAccepted: true, finding: true });
  });
});
