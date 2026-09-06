import { describe, expect, it } from "vitest";
import type { EligibilityState } from "../eligibility/eligibility-classifier";
import {
  candidateReachedSecurityTestQueue,
  evidentiaryOutcomeForBusinessProofLevel,
  evidentiaryOutcomeForEligibilityState,
  evidentiaryOutcomeForXssVerdict,
} from "./evidentiary-outcome";

const SKIPPED_AND_INCONCLUSIVE_STATES: EligibilityState[] = [
  "SKIPPED_NO_WRITE_TEMPLATE",
  "SKIPPED_NO_AUTH",
  "SKIPPED_NO_OWNERSHIP_DATA",
  "SKIPPED_SENSITIVE_RESOURCE",
  "SKIPPED_OUT_OF_SCOPE",
  "SKIPPED_NON_TEST_RESOURCE",
  "SKIPPED_REVERSIBILITY_NOT_PROVEN",
  "SKIPPED_ENVIRONMENT_POLICY",
  "INCONCLUSIVE",
  "INCONCLUSIVE_BUSINESS_EXPECTATION",
  "INCONCLUSIVE_TRUST_BOUNDARY",
];

describe("evidentiaryOutcomeForEligibilityState (Section 15.2)", () => {
  it.each(SKIPPED_AND_INCONCLUSIVE_STATES)("a %s candidate is NOT_TESTED — never displayed as blocked or safe", (eligibilityState) => {
    expect(candidateReachedSecurityTestQueue(eligibilityState)).toBe(false);
    expect(evidentiaryOutcomeForEligibilityState(eligibilityState)).toBe("NOT_TESTED");
  });

  it("TESTABLE and PASSIVE_ONLY candidates reached the queue — their outcome is null here, computed from the actual result instead", () => {
    expect(candidateReachedSecurityTestQueue("TESTABLE")).toBe(true);
    expect(evidentiaryOutcomeForEligibilityState("TESTABLE")).toBeNull();
    expect(candidateReachedSecurityTestQueue("PASSIVE_ONLY")).toBe(true);
    expect(evidentiaryOutcomeForEligibilityState("PASSIVE_ONLY")).toBeNull();
  });
});

describe("evidentiaryOutcomeForXssVerdict (Section 15.2)", () => {
  it("REMOVED/ESCAPED/HTML_ALLOWED are PROVEN_BLOCKED", () => {
    expect(evidentiaryOutcomeForXssVerdict("REMOVED")).toBe("PROVEN_BLOCKED");
    expect(evidentiaryOutcomeForXssVerdict("ESCAPED")).toBe("PROVEN_BLOCKED");
    expect(evidentiaryOutcomeForXssVerdict("HTML_ALLOWED")).toBe("PROVEN_BLOCKED");
  });

  it("RAW_HTML/UNSAFE_ATTRIBUTE_SURVIVED/POTENTIALLY_EXECUTABLE/EXECUTION_CONFIRMED are PROVEN_VULNERABLE", () => {
    expect(evidentiaryOutcomeForXssVerdict("RAW_HTML")).toBe("PROVEN_VULNERABLE");
    expect(evidentiaryOutcomeForXssVerdict("UNSAFE_ATTRIBUTE_SURVIVED")).toBe("PROVEN_VULNERABLE");
    expect(evidentiaryOutcomeForXssVerdict("POTENTIALLY_EXECUTABLE")).toBe("PROVEN_VULNERABLE");
    expect(evidentiaryOutcomeForXssVerdict("EXECUTION_CONFIRMED")).toBe("PROVEN_VULNERABLE");
  });
});

describe("evidentiaryOutcomeForBusinessProofLevel (Section 15.2) — PROVEN_VULNERABLE is gated on CONFIRMED/SAFE_PROBE_CONFIRMED", () => {
  it("an OBSERVED hypothesis with a detected violation is never shown as PROVEN_VULNERABLE", () => {
    expect(evidentiaryOutcomeForBusinessProofLevel("OBSERVED", true)).toBe("INCONCLUSIVE");
  });

  it("an INFERRED hypothesis with a detected violation is never shown as PROVEN_VULNERABLE", () => {
    expect(evidentiaryOutcomeForBusinessProofLevel("INFERRED", true)).toBe("INCONCLUSIVE");
  });

  it("CONFIRMED with a detected violation is PROVEN_VULNERABLE", () => {
    expect(evidentiaryOutcomeForBusinessProofLevel("CONFIRMED", true)).toBe("PROVEN_VULNERABLE");
  });

  it("SAFE_PROBE_CONFIRMED with a detected violation is PROVEN_VULNERABLE", () => {
    expect(evidentiaryOutcomeForBusinessProofLevel("SAFE_PROBE_CONFIRMED", true)).toBe("PROVEN_VULNERABLE");
  });

  it("CONFIRMED with no violation detected is PROVEN_BLOCKED, not PROVEN_VULNERABLE", () => {
    expect(evidentiaryOutcomeForBusinessProofLevel("CONFIRMED", false)).toBe("PROVEN_BLOCKED");
  });

  it("NOT_TESTED and INCONCLUSIVE proof levels pass through unchanged regardless of violationDetected", () => {
    expect(evidentiaryOutcomeForBusinessProofLevel("NOT_TESTED", true)).toBe("NOT_TESTED");
    expect(evidentiaryOutcomeForBusinessProofLevel("INCONCLUSIVE", true)).toBe("INCONCLUSIVE");
  });
});
