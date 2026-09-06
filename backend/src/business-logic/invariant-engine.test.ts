import { describe, expect, it } from "vitest";
import { evaluateInvariant, type BusinessInvariant } from "./invariant-engine";

const TICKET_NUMBER_IMMUTABLE_AFTER_PAID: BusinessInvariant = {
  id: 1,
  targetId: 1,
  name: "Ticket.number is immutable after PAID",
  objectType: "Ticket",
  condition: { or: [{ field: "status", operator: "NEQ", value: "PAID" }, { field: "numberChanged", operator: "EQ", value: false }] },
  expected: true,
  severity: "HIGH",
};

describe("evaluateInvariant (Section 13.17)", () => {
  it("flags a violation when a PAID ticket's number changed", () => {
    const result = evaluateInvariant(TICKET_NUMBER_IMMUTABLE_AFTER_PAID, { status: "PAID", numberChanged: true });
    expect(result.holds).toBe(false);
    expect(result.violation).toBe(true);
  });

  it("raises no violation when a PAID ticket's number did not change", () => {
    const result = evaluateInvariant(TICKET_NUMBER_IMMUTABLE_AFTER_PAID, { status: "PAID", numberChanged: false });
    expect(result.holds).toBe(true);
    expect(result.violation).toBe(false);
  });

  it("raises no violation for a non-PAID ticket even if its number changed", () => {
    const result = evaluateInvariant(TICKET_NUMBER_IMMUTABLE_AFTER_PAID, { status: "PENDING_PAYMENT", numberChanged: true });
    expect(result.holds).toBe(true);
    expect(result.violation).toBe(false);
  });

  it("supports an invariant whose expected outcome is false — the condition must never hold", () => {
    const neverAdminSelfDowngrade: BusinessInvariant = {
      id: 2,
      targetId: 1,
      name: "The last admin can never demote themselves",
      objectType: "User",
      condition: { and: [{ field: "wasLastAdmin", operator: "EQ", value: true }, { field: "roleChangedToNonAdmin", operator: "EQ", value: true }] },
      expected: false,
      severity: "CRITICAL",
    };
    const violated = evaluateInvariant(neverAdminSelfDowngrade, { wasLastAdmin: true, roleChangedToNonAdmin: true });
    expect(violated.violation).toBe(true);

    const notViolated = evaluateInvariant(neverAdminSelfDowngrade, { wasLastAdmin: true, roleChangedToNonAdmin: false });
    expect(notViolated.violation).toBe(false);
  });
});
