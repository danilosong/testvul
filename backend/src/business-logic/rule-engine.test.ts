import { describe, expect, it } from "vitest";
import { evaluateCondition, isValidCondition, type Condition } from "./rule-engine";

const STATE = { status: "PAID", quantity: 5, tags: ["vip", "early-bird"], winningNumber: undefined };

describe("evaluateCondition — a valid declarative condition evaluates correctly against sample object state", () => {
  it.each<[Condition, boolean]>([
    [{ field: "status", operator: "EQ", value: "PAID" }, true],
    [{ field: "status", operator: "EQ", value: "CANCELLED" }, false],
    [{ field: "status", operator: "NEQ", value: "CANCELLED" }, true],
    [{ field: "status", operator: "IN", value: ["PAID", "RESERVED"] }, true],
    [{ field: "status", operator: "NOT_IN", value: ["CANCELLED"] }, true],
    [{ field: "quantity", operator: "GT", value: 3 }, true],
    [{ field: "quantity", operator: "GTE", value: 5 }, true],
    [{ field: "quantity", operator: "LT", value: 3 }, false],
    [{ field: "quantity", operator: "LTE", value: 5 }, true],
    [{ field: "status", operator: "EXISTS" }, true],
    [{ field: "winningNumber", operator: "EXISTS" }, false],
  ])("evaluates %j as %s", (condition, expected) => {
    expect(evaluateCondition(condition, STATE)).toBe(expected);
  });

  it("evaluates an {and} composition as the conjunction of its branches", () => {
    const condition: Condition = {
      and: [
        { field: "status", operator: "EQ", value: "PAID" },
        { field: "quantity", operator: "GT", value: 3 },
      ],
    };
    expect(evaluateCondition(condition, STATE)).toBe(true);
  });

  it("evaluates an {or} composition as the disjunction of its branches", () => {
    const condition: Condition = { or: [{ field: "status", operator: "EQ", value: "CANCELLED" }, { field: "quantity", operator: "GT", value: 3 }] };
    expect(evaluateCondition(condition, STATE)).toBe(true);
  });

  it("evaluates a {not} composition as the negation of its branch", () => {
    const condition: Condition = { not: { field: "status", operator: "EQ", value: "CANCELLED" } };
    expect(evaluateCondition(condition, STATE)).toBe(true);
  });

  it("evaluates a nested composition correctly", () => {
    const condition: Condition = {
      and: [{ field: "status", operator: "EQ", value: "PAID" }, { not: { field: "quantity", operator: "GT", value: 10 } }],
    };
    expect(evaluateCondition(condition, STATE)).toBe(true);
  });

  it("resolves a dotted field path against nested state", () => {
    const condition: Condition = { field: "campaign.closed", operator: "EQ", value: true };
    expect(evaluateCondition(condition, { campaign: { closed: true } })).toBe(true);
  });
});

describe("isValidCondition — schema validation rejects anything that isn't valid DSL data", () => {
  it("accepts a well-formed leaf condition", () => {
    expect(isValidCondition({ field: "status", operator: "EQ", value: "PAID" })).toBe(true);
  });

  it("accepts a well-formed and/or/not composition", () => {
    expect(isValidCondition({ and: [{ field: "status", operator: "EQ", value: "PAID" }] })).toBe(true);
    expect(isValidCondition({ or: [{ field: "status", operator: "EQ", value: "PAID" }] })).toBe(true);
    expect(isValidCondition({ not: { field: "status", operator: "EQ", value: "PAID" } })).toBe(true);
  });

  it.each([
    "process.exit()",
    "require('fs')",
    "constructor.constructor('return process')()",
    "1 == 1",
    "() => true",
  ])("rejects the raw JS expression string %j", (maliciousString) => {
    expect(isValidCondition(maliciousString)).toBe(false);
  });

  it("rejects a condition with an unrecognized operator", () => {
    expect(isValidCondition({ field: "status", operator: "EVAL", value: "PAID" })).toBe(false);
  });

  it("rejects null, arrays, and primitives", () => {
    expect(isValidCondition(null)).toBe(false);
    expect(isValidCondition(42)).toBe(false);
    expect(isValidCondition([{ field: "status", operator: "EQ", value: "PAID" }])).toBe(false);
  });
});
