import { describe, expect, it, vi } from "vitest";
import { evaluateConcurrencyGate, runConcurrencyTest, testConcurrency } from "./concurrency-analyzer";

describe("runConcurrencyTest (Section 13.14)", () => {
  it("defaults to concurrency 2 and detects a duplicate resource identity", async () => {
    const performConcurrentAttempt = vi.fn().mockResolvedValue({ number: 42 });
    const result = await runConcurrencyTest({ objectType: "Ticket", performConcurrentAttempt });
    expect(performConcurrentAttempt).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ objectType: "Ticket", concurrency: 2, duplicateResourceDetected: true });
  });

  it("reports no duplicate when each concurrent attempt lands on a distinct identity", async () => {
    let n = 0;
    const performConcurrentAttempt = vi.fn().mockImplementation(async () => ({ number: ++n }));
    const result = await runConcurrencyTest({ objectType: "Ticket", concurrency: 3, performConcurrentAttempt });
    expect(result).toEqual({ objectType: "Ticket", concurrency: 3, duplicateResourceDetected: false });
  });

  it("honors an explicit concurrency override", async () => {
    const performConcurrentAttempt = vi.fn().mockResolvedValue({ ok: true });
    await runConcurrencyTest({ objectType: "Ticket", concurrency: 5, performConcurrentAttempt });
    expect(performConcurrentAttempt).toHaveBeenCalledTimes(5);
  });
});

describe("evaluateConcurrencyGate (Section 13.14)", () => {
  it("always allows a LOCAL_FIXTURE target regardless of the other conditions", () => {
    expect(
      evaluateConcurrencyGate({
        targetEnvironment: "LOCAL_FIXTURE",
        scopeClassification: "UNKNOWN_RESOURCE",
        confirmedMutationAuthorization: false,
        hasKnownCleanupStrategy: false,
      }),
    ).toBe("TESTED");
  });

  it("classifies NOT_TESTED for a non-fixture target whose resource is not an explicit TEST_RESOURCE", () => {
    expect(
      evaluateConcurrencyGate({
        targetEnvironment: "PRODUCTION",
        scopeClassification: "NON_TEST_RESOURCE",
        confirmedMutationAuthorization: true,
        hasKnownCleanupStrategy: true,
      }),
    ).toBe("NOT_TESTED");
  });

  it("classifies NOT_TESTED for a non-fixture target lacking confirmed mutation authorization", () => {
    expect(
      evaluateConcurrencyGate({
        targetEnvironment: "STAGING",
        scopeClassification: "TEST_RESOURCE",
        confirmedMutationAuthorization: false,
        hasKnownCleanupStrategy: true,
      }),
    ).toBe("NOT_TESTED");
  });

  it("classifies INCONCLUSIVE for a non-fixture target with TEST_RESOURCE and authorization but no known cleanup strategy", () => {
    expect(
      evaluateConcurrencyGate({
        targetEnvironment: "STAGING",
        scopeClassification: "TEST_RESOURCE",
        confirmedMutationAuthorization: true,
        hasKnownCleanupStrategy: false,
      }),
    ).toBe("INCONCLUSIVE");
  });

  it("classifies TESTED for a non-fixture target meeting all three conditions", () => {
    expect(
      evaluateConcurrencyGate({
        targetEnvironment: "DEVELOPMENT",
        scopeClassification: "TEST_RESOURCE",
        confirmedMutationAuthorization: true,
        hasKnownCleanupStrategy: true,
      }),
    ).toBe("TESTED");
  });
});

describe("testConcurrency (Section 13.14)", () => {
  it("never invokes performConcurrentAttempt for a non-fixture, non-TEST_RESOURCE candidate — classifies NOT_TESTED", async () => {
    const performConcurrentAttempt = vi.fn();
    const result = await testConcurrency({
      objectType: "Ticket",
      targetEnvironment: "PRODUCTION",
      scopeClassification: "NON_TEST_RESOURCE",
      confirmedMutationAuthorization: false,
      hasKnownCleanupStrategy: false,
      performConcurrentAttempt,
    });
    expect(performConcurrentAttempt).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "NOT_TESTED" });
  });

  it("runs the concurrency probe once the gate passes", async () => {
    const performConcurrentAttempt = vi.fn().mockResolvedValue({ number: 1 });
    const result = await testConcurrency({
      objectType: "Ticket",
      targetEnvironment: "LOCAL_FIXTURE",
      scopeClassification: "UNKNOWN_RESOURCE",
      confirmedMutationAuthorization: false,
      hasKnownCleanupStrategy: false,
      performConcurrentAttempt,
    });
    expect(performConcurrentAttempt).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("TESTED");
  });
});
