import { describe, expect, it } from "vitest";
import type { Candidate } from "../scanners/security-scanner";
import type { DiscoveredOperation } from "../operation-discovery/discovered-operation";
import type { BusinessInvariant } from "./invariant-engine";
import { buildBusinessTestPlan } from "./business-test-plan";

const SAMPLE_CANDIDATE: Candidate = {
  id: 42,
  scanner: "BUSINESS_LOGIC",
  resourceKey: { targetId: 1, origin: "https://example.com", objectType: "Ticket", resourceId: "7" },
  resourceUrl: "https://example.com/api/vuln-contest/tickets/7",
  fieldPath: "number",
  writeMethod: "PATCH",
  eligibilityState: "TESTABLE",
  browserTestability: "FULLY_TESTABLE",
};

const SAMPLE_OPERATION: DiscoveredOperation = {
  method: "PATCH",
  url: "https://example.com/api/vuln-contest/tickets/7",
  source: "OPENAPI",
  confidence: "HIGH",
};

const SAMPLE_INVARIANT: BusinessInvariant = {
  id: 5,
  targetId: 1,
  name: "Ticket.number is immutable after PAID",
  objectType: "Ticket",
  condition: { or: [{ field: "status", operator: "NEQ", value: "PAID" }, { field: "numberChanged", operator: "EQ", value: false }] },
  expected: true,
  severity: "HIGH",
};

describe("buildBusinessTestPlan (Section 13.18)", () => {
  it("correctly references all required fields for a sample business candidate", () => {
    const plan = buildBusinessTestPlan(SAMPLE_CANDIDATE, SAMPLE_OPERATION, SAMPLE_INVARIANT, "SAFE_REVERSIBLE_MUTATION");

    expect(plan.candidate).toBe(SAMPLE_CANDIDATE);
    expect(plan.operation).toBe(SAMPLE_OPERATION);
    expect(plan.invariant).toBe(SAMPLE_INVARIANT);
    expect(plan.safetyClassification).toBe("SAFE_REVERSIBLE_MUTATION");

    expect(plan.preconditions).toContain("Ticket");
    expect(plan.preconditions).toContain(SAMPLE_OPERATION.method);
    expect(plan.preconditions).toContain(SAMPLE_OPERATION.url);
    expect(plan.preconditions).toContain(String(SAMPLE_CANDIDATE.id));

    expect(plan.expectedBehavior).toContain(SAMPLE_INVARIANT.name);
    expect(plan.expectedBehavior).toContain(String(SAMPLE_INVARIANT.expected));

    expect(plan.safeValidation).toMatch(/backup/i);
    expect(plan.cleanup).toMatch(/restore/i);
  });

  it("never claims a mutating cleanup for a PASSIVE-classified plan", () => {
    const plan = buildBusinessTestPlan(SAMPLE_CANDIDATE, SAMPLE_OPERATION, SAMPLE_INVARIANT, "PASSIVE");
    expect(plan.safeValidation).toMatch(/read-only/i);
    expect(plan.cleanup).toMatch(/none needed/i);
  });

  it("never claims automatic real-target execution for a FINANCIAL-classified plan", () => {
    const plan = buildBusinessTestPlan(SAMPLE_CANDIDATE, SAMPLE_OPERATION, SAMPLE_INVARIANT, "FINANCIAL");
    expect(plan.safeValidation).toMatch(/LOCAL_FIXTURE/);
    expect(plan.cleanup).toMatch(/LOCAL_FIXTURE/);
  });

  it("never claims a DESTRUCTIVE-classified plan is ever executed", () => {
    const plan = buildBusinessTestPlan(SAMPLE_CANDIDATE, SAMPLE_OPERATION, SAMPLE_INVARIANT, "DESTRUCTIVE");
    expect(plan.safeValidation).toMatch(/never executed/i);
    expect(plan.cleanup).toMatch(/never executed/i);
  });
});
