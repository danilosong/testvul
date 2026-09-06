import { describe, expect, it, vi } from "vitest";
import { classifyBusinessOperationSafety, executeBusinessOperation } from "./business-operation-safety";

describe("classifyBusinessOperationSafety (Section 13.19)", () => {
  it("classifies DESTRUCTIVE first, regardless of any other signal", () => {
    expect(
      classifyBusinessOperationSafety({ isDestructive: true, performsMutation: true, issuesRequest: true, isFinancialField: true, isSensitiveField: true }),
    ).toBe("DESTRUCTIVE");
  });

  it("classifies PASSIVE for a non-mutating operation that issues no request at all", () => {
    expect(classifyBusinessOperationSafety({ isDestructive: false, performsMutation: false, issuesRequest: false, isFinancialField: false, isSensitiveField: false })).toBe(
      "PASSIVE",
    );
  });

  it("classifies SAFE_READ for a non-mutating operation that does issue a request", () => {
    expect(classifyBusinessOperationSafety({ isDestructive: false, performsMutation: false, issuesRequest: true, isFinancialField: false, isSensitiveField: false })).toBe(
      "SAFE_READ",
    );
  });

  it("classifies FINANCIAL for a mutation touching a financial-shaped field", () => {
    expect(classifyBusinessOperationSafety({ isDestructive: false, performsMutation: true, issuesRequest: true, isFinancialField: true, isSensitiveField: false })).toBe(
      "FINANCIAL",
    );
  });

  it("classifies SENSITIVE for a mutation touching a sensitive-but-not-financial field", () => {
    expect(classifyBusinessOperationSafety({ isDestructive: false, performsMutation: true, issuesRequest: true, isFinancialField: false, isSensitiveField: true })).toBe(
      "SENSITIVE",
    );
  });

  it("classifies SAFE_REVERSIBLE_MUTATION for an ordinary mutation touching neither a financial nor a sensitive field", () => {
    expect(classifyBusinessOperationSafety({ isDestructive: false, performsMutation: true, issuesRequest: true, isFinancialField: false, isSensitiveField: false })).toBe(
      "SAFE_REVERSIBLE_MUTATION",
    );
  });
});

describe("executeBusinessOperation (Section 13.19)", () => {
  it("never executes a DESTRUCTIVE operation, in any mode", async () => {
    const performReadOnly = vi.fn();
    const performViaMutationCycle = vi.fn();
    const result = await executeBusinessOperation({
      classification: "DESTRUCTIVE",
      targetEnvironment: "LOCAL_FIXTURE",
      performReadOnly,
      performViaMutationCycle,
    });
    expect(performReadOnly).not.toHaveBeenCalled();
    expect(performViaMutationCycle).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "NEVER_EXECUTED" });
  });

  it("executes a PASSIVE/SAFE_READ operation read-only", async () => {
    const performReadOnly = vi.fn().mockResolvedValue({ observed: true });
    const result = await executeBusinessOperation({ classification: "SAFE_READ", targetEnvironment: "PRODUCTION", performReadOnly });
    expect(performReadOnly).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "EXECUTED_READ_ONLY", result: { observed: true } });
  });

  it.each(["DEVELOPMENT", "STAGING", "PRODUCTION"] as const)(
    "never executes a FINANCIAL-classified operation against a %s (non-fixture) target",
    async (targetEnvironment) => {
      const performViaMutationCycle = vi.fn();
      const result = await executeBusinessOperation({ classification: "FINANCIAL", targetEnvironment, performViaMutationCycle });
      expect(performViaMutationCycle).not.toHaveBeenCalled();
      expect(result).toEqual({ status: "SKIPPED_NOT_LOCAL_FIXTURE" });
    },
  );

  it("never executes a SENSITIVE-classified operation against a non-fixture target", async () => {
    const performViaMutationCycle = vi.fn();
    const result = await executeBusinessOperation({ classification: "SENSITIVE", targetEnvironment: "STAGING", performViaMutationCycle });
    expect(performViaMutationCycle).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "SKIPPED_NOT_LOCAL_FIXTURE" });
  });

  it("executes a FINANCIAL-classified operation via the mutation cycle on a LOCAL_FIXTURE target", async () => {
    const performViaMutationCycle = vi.fn().mockResolvedValue({ outcome: "RESTORE_OK", postMutationBody: "{}" });
    const result = await executeBusinessOperation({ classification: "FINANCIAL", targetEnvironment: "LOCAL_FIXTURE", performViaMutationCycle });
    expect(performViaMutationCycle).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "EXECUTED_VIA_MUTATION_CYCLE", result: { outcome: "RESTORE_OK", postMutationBody: "{}" } });
  });

  it("always executes a SAFE_REVERSIBLE_MUTATION operation via the mutation cycle, on any target", async () => {
    const performViaMutationCycle = vi.fn().mockResolvedValue({ outcome: "RESTORE_OK", postMutationBody: "{}" });
    const result = await executeBusinessOperation({ classification: "SAFE_REVERSIBLE_MUTATION", targetEnvironment: "PRODUCTION", performViaMutationCycle });
    expect(performViaMutationCycle).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("EXECUTED_VIA_MUTATION_CYCLE");
  });
});
