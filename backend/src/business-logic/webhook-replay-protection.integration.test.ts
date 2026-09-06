import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { testWebhookReplayProtection } from "./webhook-replay-protection";
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

describe("Section 13.26 — Webhook Replay Protection Analysis against the real fixture payment webhook (1.6)", () => {
  it("replays a valid callback and confirms the ticket's PAID state transition is not duplicated — correctly idempotent", async () => {
    const reserveResponse = await httpClient.request(`${origin()}/api/contest/campaigns/1/reservations`, {
      method: "POST",
      headers: { Authorization: "Bearer userA-token" },
    });
    const reservation = JSON.parse(reserveResponse.body) as { id: string };
    const purchaseResponse = await httpClient.request(`${origin()}/api/contest/reservations/${reservation.id}/purchase`, {
      method: "POST",
      headers: { Authorization: "Bearer userA-token" },
    });
    const purchase = JSON.parse(purchaseResponse.body) as { purchase: { id: string } };

    const rawBody = JSON.stringify({ purchaseId: purchase.purchase.id });
    const signature = createHmac("sha256", "fixture-webhook-secret").update(rawBody).digest("hex");

    const result = await testWebhookReplayProtection({
      targetEnvironment: "LOCAL_FIXTURE",
      isTestResource: true,
      operation: "POST /api/contest/payments/webhook",
      performCallback: async () => {
        const response = await httpClient.request(`${origin()}/api/contest/payments/webhook`, {
          method: "POST",
          headers: { "X-Webhook-Signature": signature, "Content-Type": "application/json" },
          body: rawBody,
        });
        const body = JSON.parse(response.body) as { ticket: { status: string } };
        return { status: body.ticket.status };
      },
    });

    expect(result.status).toBe("TESTED");
    if (result.status !== "TESTED" || result.replay.status !== "TESTED") throw new Error("unreachable");
    expect(result.replay.comparison).toEqual({ consistent: true, finding: false });
  });

  it("never sends a replayed callback against a production, non-TEST_RESOURCE target", async () => {
    let invocationCount = 0;
    const result = await testWebhookReplayProtection({
      targetEnvironment: "PRODUCTION",
      isTestResource: false,
      operation: "POST /api/contest/payments/webhook",
      performCallback: async () => {
        invocationCount++;
        return httpClient.request(`${origin()}/api/contest/payments/webhook`, { method: "POST" });
      },
    });

    expect(invocationCount).toBe(0);
    expect(result).toEqual({ status: "PASSIVE" });
  });
});
