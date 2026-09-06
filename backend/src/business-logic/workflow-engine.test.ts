import { describe, expect, it } from "vitest";
import { testStateTransition, type StateTransition } from "./workflow-engine";

const illegitimateTransition: StateTransition = {
  objectType: "Ticket",
  from: "CANCELLED",
  to: "AWARDED",
  operation: "PRIZE_ELIGIBILITY_CHECK",
  profile: "contest",
  expectedAllowed: false,
};

describe("testStateTransition — anything with real financial/destructive impact is only ever actually attempted against a LOCAL_FIXTURE target (Section 13.6)", () => {
  it("actually performs the transition when hasRealImpact is true and the target is LOCAL_FIXTURE", async () => {
    let performed = false;
    const outcome = await testStateTransition({
      transition: illegitimateTransition,
      targetEnvironment: "LOCAL_FIXTURE",
      hasRealImpact: true,
      performTransition: async () => {
        performed = true;
        return { succeeded: true };
      },
    });

    expect(performed).toBe(true);
    expect(outcome).toEqual({ status: "TESTED", allowed: true });
  });

  it.each(["DEVELOPMENT", "STAGING", "PRODUCTION"] as const)(
    "never invokes performTransition when hasRealImpact is true and the target is classified %s",
    async (targetEnvironment) => {
      let performed = false;
      const outcome = await testStateTransition({
        transition: illegitimateTransition,
        targetEnvironment,
        hasRealImpact: true,
        performTransition: async () => {
          performed = true;
          return { succeeded: true };
        },
      });

      expect(performed).toBe(false);
      expect(outcome).toEqual({ status: "SKIPPED_NOT_LOCAL_FIXTURE" });
    },
  );

  it("still performs a safe/reversible probe (hasRealImpact: false) against a real, non-LOCAL_FIXTURE target", async () => {
    let performed = false;
    const outcome = await testStateTransition({
      transition: { ...illegitimateTransition, operation: "READ_ONLY_PRIZE_CHECK" },
      targetEnvironment: "STAGING",
      hasRealImpact: false,
      performTransition: async () => {
        performed = true;
        return { succeeded: false };
      },
    });

    expect(performed).toBe(true);
    expect(outcome).toEqual({ status: "TESTED", allowed: false });
  });
});
