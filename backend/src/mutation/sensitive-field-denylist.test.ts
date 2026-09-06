import { describe, expect, it } from "vitest";
import { isDenylistedField, assertFieldNotDenylisted, DenylistedFieldError } from "./sensitive-field-denylist";

describe("isDenylistedField", () => {
  it.each(["balance", "payment", "price", "password", "winner", "financialStatus", "withdrawal", "credit", "prize"])(
    "flags %s as denylisted",
    (word) => {
      expect(isDenylistedField(word)).toBe(true);
    },
  );

  it("flags a nested field whose last segment matches the denylist", () => {
    expect(isDenylistedField("account.balance")).toBe(true);
    expect(isDenylistedField("ticket.prize")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isDenylistedField("Balance")).toBe(true);
    expect(isDenylistedField("PRICE")).toBe(true);
  });

  it("does not flag an unrelated field", () => {
    expect(isDenylistedField("description")).toBe(false);
    expect(isDenylistedField("project.name")).toBe(false);
  });
});

describe("assertFieldNotDenylisted", () => {
  it("throws DenylistedFieldError for a denylisted field", () => {
    expect(() => assertFieldNotDenylisted("balance")).toThrow(DenylistedFieldError);
  });

  it("does not throw for a non-denylisted field", () => {
    expect(() => assertFieldNotDenylisted("description")).not.toThrow();
  });

  it("a denylisted-field candidate is rejected before any request is sent, per the spec's own test requirement", async () => {
    let requestSent = false;
    async function fakeMutatingScannerTest(fieldPath: string): Promise<void> {
      assertFieldNotDenylisted(fieldPath); // throws before the next line ever runs
      requestSent = true;
    }

    await expect(fakeMutatingScannerTest("balance")).rejects.toThrow(DenylistedFieldError);
    expect(requestSent).toBe(false);
  });
});
