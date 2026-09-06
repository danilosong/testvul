import { describe, expect, it } from "vitest";
import { summarizeCandidateOutcome } from "./candidate-outcome-summary";

describe("summarizeCandidateOutcome", () => {
  it("a SKIPPED_NO_AUTH candidate is structurally distinguishable from a tested candidate with zero findings", () => {
    const skipped = summarizeCandidateOutcome({ eligibilityState: "SKIPPED_NO_AUTH", evidentiaryOutcome: "NOT_TESTED" });
    const testedClean = summarizeCandidateOutcome({ eligibilityState: "TESTABLE", evidentiaryOutcome: "PROVEN_BLOCKED" });

    expect(skipped.kind).toBe("SKIPPED");
    expect(testedClean.kind).toBe("TESTED");
    expect(skipped.kind).not.toBe(testedClean.kind);
    // The skipped variant carries a reason, never an evidentiaryOutcome —
    // there is no field a report could misread as "no finding."
    expect(skipped).not.toHaveProperty("evidentiaryOutcome");
    expect((skipped as { reason: string }).reason).toBe("SKIPPED_NO_AUTH");
  });

  it("a tested candidate exposes its real evidentiaryOutcome", () => {
    const summary = summarizeCandidateOutcome({ eligibilityState: "TESTABLE", evidentiaryOutcome: "PROVEN_VULNERABLE" });
    expect(summary).toEqual({ kind: "TESTED", evidentiaryOutcome: "PROVEN_VULNERABLE" });
  });

  it("classifies PASSIVE_ONLY distinctly from both TESTED and SKIPPED", () => {
    const summary = summarizeCandidateOutcome({ eligibilityState: "PASSIVE_ONLY", evidentiaryOutcome: "NOT_TESTED" });
    expect(summary).toEqual({ kind: "PASSIVE_ONLY" });
  });

  it("classifies every INCONCLUSIVE-family state as kind INCONCLUSIVE, never TESTED", () => {
    expect(summarizeCandidateOutcome({ eligibilityState: "INCONCLUSIVE", evidentiaryOutcome: "NOT_TESTED" })).toEqual({
      kind: "INCONCLUSIVE",
    });
    expect(
      summarizeCandidateOutcome({ eligibilityState: "INCONCLUSIVE_BUSINESS_EXPECTATION", evidentiaryOutcome: "NOT_TESTED" }),
    ).toEqual({ kind: "INCONCLUSIVE" });
    expect(summarizeCandidateOutcome({ eligibilityState: "INCONCLUSIVE_TRUST_BOUNDARY", evidentiaryOutcome: "NOT_TESTED" })).toEqual({
      kind: "INCONCLUSIVE",
    });
  });

  it("classifies every other SKIPPED_* state with its specific reason preserved", () => {
    const summary = summarizeCandidateOutcome({ eligibilityState: "SKIPPED_NON_TEST_RESOURCE", evidentiaryOutcome: "NOT_TESTED" });
    expect(summary).toEqual({ kind: "SKIPPED", reason: "SKIPPED_NON_TEST_RESOURCE" });
  });
});
