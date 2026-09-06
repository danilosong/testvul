import { describe, expect, it } from "vitest";
import { isDestructiveAction, assertNotDestructiveAction, DestructiveActionError } from "./destructive-action-denylist";

describe("isDestructiveAction", () => {
  it.each([
    "Delete Account",
    "Remove Item",
    "Destroy Session",
    "Cancel Account",
    "Withdraw Funds",
    "Make Payment",
    "Confirm Purchase",
    "Pay Now",
    "Request Refund",
    "Claim Prize",
    "Notify Winner",
    "Transfer Balance",
    "Send Money",
    "Close Account",
    "Reset Database",
  ])("matches the English denylist entry in %s", (label) => {
    expect(isDestructiveAction(label)).toBe(true);
  });

  it.each(["Excluir Conta", "Cancelar Conta", "Sacar Fundos", "Prêmio", "Transferir Saldo", "Encerrar Conta"])(
    "matches the Portuguese equivalent in %s",
    (label) => {
      expect(isDestructiveAction(label)).toBe(true);
    },
  );

  it("does not match an unrelated safe label", () => {
    expect(isDestructiveAction("Save Settings")).toBe(false);
  });
});

describe("assertNotDestructiveAction", () => {
  it("throws DestructiveActionError for a denylisted label", () => {
    expect(() => assertNotDestructiveAction("Delete Account")).toThrow(DestructiveActionError);
  });

  it("does not throw for a non-denylisted label", () => {
    expect(() => assertNotDestructiveAction("Save Settings")).not.toThrow();
  });
});
