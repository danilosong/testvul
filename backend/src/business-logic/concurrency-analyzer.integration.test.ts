import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { testConcurrency } from "./concurrency-analyzer";

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

async function reserveVulnContestTicket(authHeader: string): Promise<{ number: number }> {
  const response = await httpClient.request(`${origin()}/api/vuln-contest/campaigns/2/reservations`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ ticketNumber: 555 }),
  });
  expect(response.status).toBe(201);
  // Only the assigned ticket `number` is the resource identity under test —
  // each reservation also gets a distinct `id`, which must not mask a
  // colliding `number` when comparing concurrent results.
  const { number } = JSON.parse(response.body) as { number: number };
  return { number };
}

async function purchaseProtectedContestTicket(authHeader: string): Promise<{ number: number }> {
  const reservationResponse = await httpClient.request(`${origin()}/api/contest/campaigns/1/reservations`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: "{}",
  });
  expect(reservationResponse.status).toBe(201);
  const reservation = JSON.parse(reservationResponse.body) as { id: string };
  const purchaseResponse = await httpClient.request(`${origin()}/api/contest/reservations/${reservation.id}/purchase`, {
    method: "POST",
    headers: { Authorization: authHeader },
  });
  expect(purchaseResponse.status).toBe(201);
  const purchase = JSON.parse(purchaseResponse.body) as { ticket: { number: number } };
  return { number: purchase.ticket.number };
}

describe("Section 13.14 — Concurrency/Race-Condition testing against the fixture app's concurrent-reservation bug (1.6)", () => {
  it("detects two simultaneous reservations receiving the same ticket number using only the default low concurrency", async () => {
    const result = await testConcurrency({
      objectType: "Ticket",
      targetEnvironment: "LOCAL_FIXTURE",
      scopeClassification: "UNKNOWN_RESOURCE",
      confirmedMutationAuthorization: false,
      hasKnownCleanupStrategy: false,
      performConcurrentAttempt: () => reserveVulnContestTicket("Bearer userA-token"),
    });

    expect(result.status).toBe("TESTED");
    if (result.status !== "TESTED") throw new Error("unreachable");
    expect(result.result.concurrency).toBe(2);
    expect(result.result.duplicateResourceDetected).toBe(true);
  });

  it("produces no race finding when the protected flow assigns distinct ticket numbers server-side", async () => {
    const result = await testConcurrency({
      objectType: "Ticket",
      targetEnvironment: "LOCAL_FIXTURE",
      scopeClassification: "UNKNOWN_RESOURCE",
      confirmedMutationAuthorization: false,
      hasKnownCleanupStrategy: false,
      performConcurrentAttempt: () => purchaseProtectedContestTicket("Bearer userA-token"),
    });

    expect(result.status).toBe("TESTED");
    if (result.status !== "TESTED") throw new Error("unreachable");
    expect(result.result.duplicateResourceDetected).toBe(false);
  });

  it("never executes a concurrent mutation against a non-fixture, non-TEST_RESOURCE candidate — classifies NOT_TESTED", async () => {
    let invocationCount = 0;
    const result = await testConcurrency({
      objectType: "Ticket",
      targetEnvironment: "PRODUCTION",
      scopeClassification: "NON_TEST_RESOURCE",
      confirmedMutationAuthorization: true,
      hasKnownCleanupStrategy: true,
      performConcurrentAttempt: async () => {
        invocationCount++;
        return reserveVulnContestTicket("Bearer userA-token");
      },
    });

    expect(invocationCount).toBe(0);
    expect(result).toEqual({ status: "NOT_TESTED" });
  });
});
