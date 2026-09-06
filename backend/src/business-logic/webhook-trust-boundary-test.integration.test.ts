import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { testWebhookTrustBoundary } from "./webhook-trust-boundary-test";
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

async function reserveVulnContestTicket(ticketNumber: number): Promise<{ id: string; status: string }> {
  const response = await httpClient.request(`${origin()}/api/vuln-contest/campaigns/2/reservations`, {
    method: "POST",
    headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
    body: JSON.stringify({ ticketNumber }),
  });
  expect(response.status).toBe(201);
  return JSON.parse(response.body) as { id: string; status: string };
}

describe("Section 13.25 — Webhook State Transition and Trust Boundary Testing against the fixture app's payment callback endpoints (1.6), run with Environment Classification LOCAL_FIXTURE", () => {
  it("the vulnerable variant accepts an unauthenticated forged callback and it causes a real state transition — produces a BUSINESS_TRUST_BOUNDARY finding", async () => {
    const ticket = await reserveVulnContestTicket(701);
    expect(ticket.status).toBe("RESERVED");

    const result = await testWebhookTrustBoundary({
      targetEnvironment: "LOCAL_FIXTURE",
      isTestResource: true,
      performForgedCallback: async () => {
        const response = await httpClient.request(`${origin()}/api/vuln-contest/payments/webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId: ticket.id }),
        });
        const accepted = response.status === 200;
        const body = accepted ? (JSON.parse(response.body) as { status: string }) : null;
        return { accepted, stateTransitionOccurred: accepted && body?.status === "PAID" };
      },
    });

    expect(result).toEqual({ status: "TESTED", accepted: true, causedStateTransition: true, finding: true });
  });

  it("the protected variant rejects the forged (invalidly-signed) callback — no finding", async () => {
    const result = await testWebhookTrustBoundary({
      targetEnvironment: "LOCAL_FIXTURE",
      isTestResource: true,
      performForgedCallback: async () => {
        const response = await httpClient.request(`${origin()}/api/contest/payments/webhook`, {
          method: "POST",
          headers: { "X-Webhook-Signature": "0".repeat(64), "Content-Type": "application/json" },
          body: JSON.stringify({ purchaseId: "forged-purchase-id" }),
        });
        return { accepted: response.status === 200, stateTransitionOccurred: false };
      },
    });

    expect(result).toEqual({ status: "TESTED", accepted: false, causedStateTransition: false, finding: false });
  });

  it("never sends a forged callback against a target classified DEVELOPMENT/STAGING/PRODUCTION or lacking an explicit TEST_RESOURCE declaration", async () => {
    let invocationCount = 0;
    const performForgedCallback = async () => {
      invocationCount++;
      const response = await httpClient.request(`${origin()}/api/vuln-contest/payments/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: "should-never-be-sent" }),
      });
      return { accepted: response.status === 200, stateTransitionOccurred: response.status === 200 };
    };

    for (const targetEnvironment of ["DEVELOPMENT", "STAGING", "PRODUCTION"] as const) {
      const result = await testWebhookTrustBoundary({ targetEnvironment, isTestResource: true, performForgedCallback });
      expect(result).toEqual({ status: "PASSIVE" });
    }
    const inconclusiveResult = await testWebhookTrustBoundary({ targetEnvironment: "LOCAL_FIXTURE", isTestResource: false, performForgedCallback });
    expect(inconclusiveResult).toEqual({ status: "INCONCLUSIVE" });

    expect(invocationCount).toBe(0);
  });
});
