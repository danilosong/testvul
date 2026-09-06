import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { testSequenceBypass, type WorkflowStep } from "./sequence-analyzer";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let httpClient: SecurityHttpClient;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  httpClient = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
}, 60_000);

afterAll(async () => {
  await servers.stop();
});

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

async function reserveVulnContestTicket(campaignId: string, ticketNumber: number): Promise<{ id: string }> {
  const response = await httpClient.request(`${origin()}/api/vuln-contest/campaigns/${campaignId}/reservations`, {
    method: "POST",
    headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
    body: JSON.stringify({ ticketNumber }),
  });
  expect(response.status).toBe(201);
  return JSON.parse(response.body) as { id: string };
}

async function payWithoutPurchase(ticketId: string): Promise<{ succeeded: boolean }> {
  // The unauthenticated, unsigned vuln-contest webhook: no purchase record
  // is ever consulted, so the required "purchase" step can be skipped
  // entirely and a ticket still ends up PAID.
  const response = await httpClient.request(`${origin()}/api/vuln-contest/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticketId }),
  });
  return { succeeded: response.status === 200 && (JSON.parse(response.body) as { status: string }).status === "PAID" };
}

async function ticketStatus(ticketId: string): Promise<string> {
  const response = await httpClient.request(`${origin()}/api/contest/tickets/${ticketId}`, {
    headers: { Authorization: "Bearer userA-token" },
  });
  expect(response.status).toBe(200);
  return (JSON.parse(response.body) as { status: string }).status;
}

const payViaWebhookStep: WorkflowStep = {
  objectType: "Ticket",
  operation: "PAY_VIA_WEBHOOK",
  requiredBefore: "PURCHASE",
};

describe("Section 13.7 — Workflow/Sequence Bypass testing against the fixture's real purchase/payment sequence", () => {
  it("actually creates a real PAID ticket by skipping the required purchase step, but only because this run targets a LOCAL_FIXTURE-classified target", async () => {
    const ticket = await reserveVulnContestTicket("2", 77001); // never purchased — reservation only

    const outcome = await testSequenceBypass({
      step: payViaWebhookStep,
      targetEnvironment: "LOCAL_FIXTURE",
      hasRealImpact: true,
      attemptStepSkippingPrerequisite: () => payWithoutPurchase(ticket.id),
    });

    expect(outcome).toEqual({ status: "TESTED", bypassPossible: true });
    expect(await ticketStatus(ticket.id)).toBe("PAID");
  });

  it.each(["DEVELOPMENT", "STAGING", "PRODUCTION"] as const)(
    "never actually creates a real financial transaction (a PAID ticket) against a target classified %s",
    async (targetEnvironment) => {
      const ticket = await reserveVulnContestTicket("2", 77100 + targetEnvironment.length);

      const outcome = await testSequenceBypass({
        step: payViaWebhookStep,
        targetEnvironment,
        hasRealImpact: true,
        attemptStepSkippingPrerequisite: () => payWithoutPurchase(ticket.id), // would only run for a LOCAL_FIXTURE target
      });

      expect(outcome).toEqual({ status: "SKIPPED_NOT_LOCAL_FIXTURE" });
      expect(await ticketStatus(ticket.id)).toBe("RESERVED");
    },
  );
});
