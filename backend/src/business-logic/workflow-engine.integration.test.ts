import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { testStateTransition, type StateTransition } from "./workflow-engine";
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

async function cancelVulnContestTicket(ticketId: string): Promise<void> {
  const response = await httpClient.request(`${origin()}/api/vuln-contest/tickets/${ticketId}/cancel`, {
    method: "POST",
    headers: { Authorization: "Bearer userA-token" },
  });
  expect(response.status).toBe(200);
}

async function currentLowestEligibleNumber(campaignId: string): Promise<number | null> {
  const response = await httpClient.request(`${origin()}/api/vuln-contest/campaigns/${campaignId}/current-lowest-eligible-number`, {
    method: "GET",
  });
  expect(response.status).toBe(200);
  return (JSON.parse(response.body) as { currentLowestEligibleNumber: number | null }).currentLowestEligibleNumber;
}

const illegitimateTransition: StateTransition = {
  objectType: "Ticket",
  from: "CANCELLED",
  to: "AWARDED",
  operation: "STILL_COUNTED_AS_ELIGIBLE",
  profile: "contest",
  expectedAllowed: false,
};

describe("Section 13.6 — StateTransition testing against the fixture's real Contest/Ticketing state machine", () => {
  it("actually reproduces the illegitimate CANCELLED-ticket-still-eligible transition, but only because this run targets a LOCAL_FIXTURE-classified target", async () => {
    // Use campaign "2" ("Vulnerable Contest") with a ticket number no other
    // test in this file touches, so the fixture's shared in-memory state
    // can't make this assertion flaky.
    const ticket = await reserveVulnContestTicket("2", 90210);
    await cancelVulnContestTicket(ticket.id);

    const outcome = await testStateTransition({
      transition: illegitimateTransition,
      targetEnvironment: "LOCAL_FIXTURE",
      hasRealImpact: true,
      performTransition: async () => {
        const lowest = await currentLowestEligibleNumber("2");
        // The fixture's real bug: a CANCELLED ticket's number is still
        // reported as eligible, i.e. the illegitimate transition succeeded.
        return { succeeded: lowest === 90210 };
      },
    });

    expect(outcome).toEqual({ status: "TESTED", allowed: true });
  });

  it.each(["DEVELOPMENT", "STAGING", "PRODUCTION"] as const)(
    "never actually attempts the same destructive probe against a target classified %s — the fixture's ticket state is left untouched",
    async (targetEnvironment) => {
      const ticket = await reserveVulnContestTicket("2", 90211);

      const outcome = await testStateTransition({
        transition: illegitimateTransition,
        targetEnvironment,
        hasRealImpact: true,
        performTransition: async () => {
          await cancelVulnContestTicket(ticket.id); // would only run for a LOCAL_FIXTURE target
          const lowest = await currentLowestEligibleNumber("2");
          return { succeeded: lowest === 90211 };
        },
      });

      expect(outcome).toEqual({ status: "SKIPPED_NOT_LOCAL_FIXTURE" });

      // Proof the destructive probe was genuinely never sent: the ticket
      // reserved above is still RESERVED, never CANCELLED.
      const response = await httpClient.request(`${origin()}/api/contest/tickets/${ticket.id}`, {
        headers: { Authorization: "Bearer userA-token" },
      });
      expect(response.status).toBe(200);
      expect((JSON.parse(response.body) as { status: string }).status).toBe("RESERVED");
    },
  );
});
