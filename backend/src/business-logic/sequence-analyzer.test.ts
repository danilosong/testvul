import { describe, expect, it } from "vitest";
import { testSequenceBypass, type WorkflowStep } from "./sequence-analyzer";

const payWithoutPurchase: WorkflowStep = {
  objectType: "Ticket",
  operation: "PAY_VIA_WEBHOOK",
  requiredBefore: "PURCHASE",
};

describe("testSequenceBypass — anything with real financial/destructive impact is only ever actually attempted against a LOCAL_FIXTURE target (Section 13.7)", () => {
  it("actually attempts the skip-test when hasRealImpact is true and the target is LOCAL_FIXTURE", async () => {
    let attempted = false;
    const outcome = await testSequenceBypass({
      step: payWithoutPurchase,
      targetEnvironment: "LOCAL_FIXTURE",
      hasRealImpact: true,
      attemptStepSkippingPrerequisite: async () => {
        attempted = true;
        return { succeeded: true };
      },
    });

    expect(attempted).toBe(true);
    expect(outcome).toEqual({ status: "TESTED", bypassPossible: true });
  });

  it.each(["DEVELOPMENT", "STAGING", "PRODUCTION"] as const)(
    "never invokes attemptStepSkippingPrerequisite when hasRealImpact is true and the target is classified %s",
    async (targetEnvironment) => {
      let attempted = false;
      const outcome = await testSequenceBypass({
        step: payWithoutPurchase,
        targetEnvironment,
        hasRealImpact: true,
        attemptStepSkippingPrerequisite: async () => {
          attempted = true;
          return { succeeded: true };
        },
      });

      expect(attempted).toBe(false);
      expect(outcome).toEqual({ status: "SKIPPED_NOT_LOCAL_FIXTURE" });
    },
  );

  it("still performs a non-mutating probe (hasRealImpact: false) against a real, non-LOCAL_FIXTURE target", async () => {
    let attempted = false;
    const outcome = await testSequenceBypass({
      step: { objectType: "Ticket", operation: "READ_WITHOUT_RESERVATION", requiredBefore: "RESERVE" },
      targetEnvironment: "STAGING",
      hasRealImpact: false,
      attemptStepSkippingPrerequisite: async () => {
        attempted = true;
        return { succeeded: false };
      },
    });

    expect(attempted).toBe(true);
    expect(outcome).toEqual({ status: "TESTED", bypassPossible: false });
  });
});
