import { describe, expect, it, vi } from "vitest";
import {
  analyzePriceIntegrity,
  buildQuantityBoundaryProbes,
  evaluateQuantityBoundaryFinding,
  evaluateSensitiveFieldMutationGate,
  testPriceIntegrity,
  testQuantityBoundaries,
} from "./price-integrity-analyzer";

describe("evaluateSensitiveFieldMutationGate (Section 13.15)", () => {
  it("allows mutation for a non-denylisted field ('quantity') on any target", () => {
    expect(
      evaluateSensitiveFieldMutationGate({ fieldPath: "quantity", targetEnvironment: "PRODUCTION", localFixtureTestCapabilityEnabled: false }),
    ).toBe("MUTATION_ALLOWED");
  });

  it("allows mutation for a denylisted field only on LOCAL_FIXTURE with the test capability enabled", () => {
    expect(
      evaluateSensitiveFieldMutationGate({ fieldPath: "price", targetEnvironment: "LOCAL_FIXTURE", localFixtureTestCapabilityEnabled: true }),
    ).toBe("MUTATION_ALLOWED");
  });

  it("blocks a denylisted field on LOCAL_FIXTURE without the test capability flag", () => {
    expect(
      evaluateSensitiveFieldMutationGate({ fieldPath: "price", targetEnvironment: "LOCAL_FIXTURE", localFixtureTestCapabilityEnabled: false }),
    ).toBe("VALIDATION_PROBE_ONLY");
  });

  it.each(["DEVELOPMENT", "STAGING", "PRODUCTION"] as const)("blocks a denylisted field on %s even with the test capability flag set", (targetEnvironment) => {
    expect(evaluateSensitiveFieldMutationGate({ fieldPath: "price", targetEnvironment, localFixtureTestCapabilityEnabled: true })).toBe(
      "VALIDATION_PROBE_ONLY",
    );
  });
});

describe("analyzePriceIntegrity (Section 13.15) — server-recalculation verification", () => {
  it("raises a finding when the server echoes the client-supplied price verbatim", () => {
    expect(analyzePriceIntegrity(1, 1)).toEqual({ control: "CLIENT_CONTROLLED", finding: true });
  });

  it("raises no finding when the server recalculates the price independently", () => {
    expect(analyzePriceIntegrity(1, 4999)).toEqual({ control: "SERVER_CONTROLLED", finding: false });
  });
});

describe("testPriceIntegrity (Section 13.15)", () => {
  it("produces the expected finding when a price field is mutated via the LOCAL_FIXTURE Test Capability against a LOCAL_FIXTURE target", async () => {
    const performMutationAndReadResult = vi.fn().mockResolvedValue(1);
    const result = await testPriceIntegrity({
      fieldPath: "price",
      targetEnvironment: "LOCAL_FIXTURE",
      localFixtureTestCapabilityEnabled: true,
      clientSuppliedValue: 1,
      performMutationAndReadResult,
    });
    expect(performMutationAndReadResult).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "TESTED", result: { control: "CLIENT_CONTROLLED", finding: true } });
  });

  it.each(["DEVELOPMENT", "STAGING", "PRODUCTION"] as const)(
    "never attempts a risky boundary mutation of a denylisted field against a %s target",
    async (targetEnvironment) => {
      const performMutationAndReadResult = vi.fn();
      const result = await testPriceIntegrity({
        fieldPath: "price",
        targetEnvironment,
        localFixtureTestCapabilityEnabled: true,
        clientSuppliedValue: 1,
        performMutationAndReadResult,
      });
      expect(performMutationAndReadResult).not.toHaveBeenCalled();
      expect(result).toEqual({ status: "VALIDATION_PROBE_ONLY" });
    },
  );
});

describe("buildQuantityBoundaryProbes / evaluateQuantityBoundaryFinding (Section 13.15)", () => {
  it("builds the four boundary probes: 0, negative, max, max+1", () => {
    expect(buildQuantityBoundaryProbes(10)).toEqual([
      { boundary: "ZERO", value: 0 },
      { boundary: "NEGATIVE", value: -1 },
      { boundary: "MAX", value: 10 },
      { boundary: "MAX_PLUS_ONE", value: 11 },
    ]);
  });

  it("raises no finding when only MAX is accepted", () => {
    const outcomes = buildQuantityBoundaryProbes(10).map((probe) => ({ ...probe, accepted: probe.boundary === "MAX" }));
    expect(evaluateQuantityBoundaryFinding(outcomes)).toBe(false);
  });

  it("raises a finding when an out-of-range boundary (e.g. MAX_PLUS_ONE) is accepted", () => {
    const outcomes = buildQuantityBoundaryProbes(10).map((probe) => ({ ...probe, accepted: probe.boundary === "MAX" || probe.boundary === "MAX_PLUS_ONE" }));
    expect(evaluateQuantityBoundaryFinding(outcomes)).toBe(true);
  });
});

describe("testQuantityBoundaries (Section 13.15)", () => {
  it("runs all four boundary probes for a non-denylisted quantity field", async () => {
    const performBoundaryAttempt = vi.fn().mockImplementation(async (value: number) => ({ accepted: value > 0 && value <= 10 }));
    const result = await testQuantityBoundaries({
      fieldPath: "quantity",
      targetEnvironment: "PRODUCTION",
      localFixtureTestCapabilityEnabled: false,
      max: 10,
      performBoundaryAttempt,
    });
    expect(performBoundaryAttempt).toHaveBeenCalledTimes(4);
    expect(result.status).toBe("TESTED");
    if (result.status !== "TESTED") throw new Error("unreachable");
    expect(result.finding).toBe(false);
  });

  it("never attempts a boundary mutation of a denylisted field against a non-fixture target", async () => {
    const performBoundaryAttempt = vi.fn();
    const result = await testQuantityBoundaries({
      fieldPath: "credit",
      targetEnvironment: "PRODUCTION",
      localFixtureTestCapabilityEnabled: false,
      max: 10,
      performBoundaryAttempt,
    });
    expect(performBoundaryAttempt).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "VALIDATION_PROBE_ONLY" });
  });
});
