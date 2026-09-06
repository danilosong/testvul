import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { evaluateInvariant, type BusinessInvariant } from "./invariant-engine";
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

const TICKET_NUMBER_IMMUTABLE_AFTER_PAID: BusinessInvariant = {
  id: 1,
  targetId: 1,
  name: "Ticket.number is immutable after PAID",
  objectType: "Ticket",
  condition: { or: [{ field: "status", operator: "NEQ", value: "PAID" }, { field: "numberChanged", operator: "EQ", value: false }] },
  expected: true,
  severity: "HIGH",
};

describe("Section 13.17 — the Business Invariant Engine against the real fixture app (1.6)", () => {
  it("flags a violation: the vulnerable ticket route allows a PAID ticket's number to be changed", async () => {
    const reserveResponse = await httpClient.request(`${origin()}/api/vuln-contest/campaigns/2/reservations`, {
      method: "POST",
      headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
      body: JSON.stringify({ ticketNumber: 500 }),
    });
    const ticket = JSON.parse(reserveResponse.body) as { id: string; number: number };

    const payResponse = await httpClient.request(`${origin()}/api/vuln-contest/payments/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: ticket.id }),
    });
    expect((JSON.parse(payResponse.body) as { status: string }).status).toBe("PAID");

    const patchResponse = await httpClient.request(`${origin()}/api/vuln-contest/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
      body: JSON.stringify({ number: 99999 }),
    });
    const patchedTicket = JSON.parse(patchResponse.body) as { status: string; number: number };
    expect(patchedTicket.number).not.toBe(ticket.number);

    const result = evaluateInvariant(TICKET_NUMBER_IMMUTABLE_AFTER_PAID, {
      status: patchedTicket.status,
      numberChanged: patchedTicket.number !== ticket.number,
    });
    expect(result.violation).toBe(true);
  });

  it("raises no violation against the protected ticket route, which correctly refuses the same mutation with 409", async () => {
    const reserveResponse = await httpClient.request(`${origin()}/api/contest/campaigns/1/reservations`, {
      method: "POST",
      headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
    });
    const reservation = JSON.parse(reserveResponse.body) as { id: string };

    const purchaseResponse = await httpClient.request(`${origin()}/api/contest/reservations/${reservation.id}/purchase`, {
      method: "POST",
      headers: { Authorization: "Bearer userA-token" },
    });
    const purchase = JSON.parse(purchaseResponse.body) as { ticket: { id: string; number: number }; purchase: { id: string } };

    // Mark the ticket PAID through the real, signature-protected webhook.
    const rawBody = JSON.stringify({ purchaseId: purchase.purchase.id });
    const signature = createHmac("sha256", "fixture-webhook-secret").update(rawBody).digest("hex");
    await httpClient.request(`${origin()}/api/contest/payments/webhook`, {
      method: "POST",
      headers: { "X-Webhook-Signature": signature, "Content-Type": "application/json" },
      body: rawBody,
    });

    const patchResponse = await httpClient.request(`${origin()}/api/contest/tickets/${purchase.ticket.id}`, {
      method: "PATCH",
      headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
      body: JSON.stringify({ number: 99999 }),
    });
    expect(patchResponse.status).toBe(409);

    const result = evaluateInvariant(TICKET_NUMBER_IMMUTABLE_AFTER_PAID, { status: "PAID", numberChanged: false });
    expect(result.violation).toBe(false);
  });
});
