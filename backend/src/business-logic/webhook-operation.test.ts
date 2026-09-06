import { describe, expect, it } from "vitest";
import { describeStateTransition, isWebhookShapedEndpoint } from "./webhook-operation";

describe("isWebhookShapedEndpoint (Section 13.23)", () => {
  it.each(["/api/contest/payments/webhook", "/api/payments/callback", "/api/stripe-hook", "/api/paypal/ipn"])("recognizes %s as webhook-shaped", (endpoint) => {
    expect(isWebhookShapedEndpoint(endpoint)).toBe(true);
  });

  it.each(["/api/projects/1", "/api/contest/tickets/7"])("does not recognize an ordinary endpoint like %s as webhook-shaped", (endpoint) => {
    expect(isWebhookShapedEndpoint(endpoint)).toBe(false);
  });
});

describe("describeStateTransition (Section 13.23)", () => {
  it("describes an observed transition in the fixed WebhookOperation.resultingStateTransition shape", () => {
    expect(describeStateTransition("Ticket", "PENDING_PAYMENT", "PAID")).toBe("Ticket: PENDING_PAYMENT -> PAID");
  });
});
