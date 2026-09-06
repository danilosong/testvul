import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { withAuthHeaders } from "../scanners/authenticated-requester";
import { runReadIdorTest } from "../scanners/idor/read-idor-test";
import { analyzePredictabilityExploitation, classifyIdentifierPredictability, predictNextIdentifier } from "./predictability-analyzer";
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

async function reserveVulnContestTicket(ticketNumber: number, authHeader: string): Promise<{ id: string; ownerId: string }> {
  const response = await httpClient.request(`${origin()}/api/vuln-contest/campaigns/2/reservations`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ ticketNumber }),
  });
  expect(response.status).toBe(201);
  return JSON.parse(response.body) as { id: string; ownerId: string };
}

describe("Section 13.12 — Predictability Analysis against real fixture ticket ids", () => {
  it("classifies a legitimately-observed run of userA's own ticket ids as SEQUENTIAL, and confirms no finding once the predicted id is PROTECTED", async () => {
    // userA legitimately reserves three tickets and observes their (globally
    // sequential) ids — a real, non-adversarial observation.
    const own = [
      await reserveVulnContestTicket(201, "Bearer userA-token"),
      await reserveVulnContestTicket(202, "Bearer userA-token"),
      await reserveVulnContestTicket(203, "Bearer userA-token"),
    ];
    const observedIds = own.map((t) => Number(t.id));
    const classification = classifyIdentifierPredictability(observedIds);
    expect(classification).toBe("SEQUENTIAL");

    const predictedId = predictNextIdentifier(observedIds);
    expect(predictedId).not.toBeNull();

    // userB happens to reserve the very next ticket — landing exactly on
    // the predicted id, as the shared, sequential counter guarantees here.
    const otherUsersTicket = await reserveVulnContestTicket(204, "Bearer userB-token");
    expect(Number(otherUsersTicket.id)).toBe(predictedId);

    // The PROTECTED read endpoint enforces ownership even though the id
    // itself was fully predictable — SEQUENTIAL alone must not produce a
    // finding.
    const accessResult = await runReadIdorTest({
      requester: withAuthHeaders(httpClient, { Authorization: "Bearer userA-token" }),
      resourceUrl: `${origin()}/api/contest/tickets/${String(predictedId)}`,
      resourceIdFieldPath: "id",
      expectedResourceId: String(predictedId),
      ownerFieldPath: "ownerId",
      expectedOwnerId: "userB",
    });
    expect(accessResult.outcome).toBe("PROTECTED");

    const exploitation = analyzePredictabilityExploitation(classification, accessResult.outcome);
    expect(exploitation.finding).toBe(false);
  });

  it("produces a finding once a predicted id is shown to grant real unauthorized access via the vulnerable, ownership-check-free read endpoint", async () => {
    const own = [
      await reserveVulnContestTicket(301, "Bearer userA-token"),
      await reserveVulnContestTicket(302, "Bearer userA-token"),
      await reserveVulnContestTicket(303, "Bearer userA-token"),
    ];
    const observedIds = own.map((t) => Number(t.id));
    const classification = classifyIdentifierPredictability(observedIds);
    expect(classification).toBe("SEQUENTIAL");

    const predictedId = predictNextIdentifier(observedIds);
    expect(predictedId).not.toBeNull();

    const otherUsersTicket = await reserveVulnContestTicket(304, "Bearer userB-token");
    expect(Number(otherUsersTicket.id)).toBe(predictedId);

    // The vulnerable variant has no ownership check at all — a genuinely
    // exploitable case: predictability plus a missing authorization check.
    const accessResult = await runReadIdorTest({
      requester: withAuthHeaders(httpClient, { Authorization: "Bearer userA-token" }),
      resourceUrl: `${origin()}/api/vuln-contest/tickets/${String(predictedId)}`,
      resourceIdFieldPath: "id",
      expectedResourceId: String(predictedId),
      ownerFieldPath: "ownerId",
      expectedOwnerId: "userB",
    });
    expect(accessResult.outcome).toBe("POTENTIAL_BOLA");
    expect(accessResult.status).toBe(200);

    const exploitation = analyzePredictabilityExploitation(classification, accessResult.outcome);
    expect(exploitation).toEqual({ classification: "SEQUENTIAL", finding: true });
  });
});
