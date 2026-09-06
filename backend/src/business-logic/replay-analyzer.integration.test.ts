import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { testReplay } from "./replay-analyzer";
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

async function claimReward(): Promise<{ balance: number }> {
  const response = await httpClient.request(`${origin()}/api/rewards/claim`, {
    method: "POST",
    headers: { Authorization: "Bearer userA-token" },
  });
  expect(response.status).toBe(200);
  return JSON.parse(response.body) as { balance: number };
}

async function claimProtectedReward(idempotencyKey: string): Promise<{ balance: number }> {
  const response = await httpClient.request(`${origin()}/api/rewards/claim-protected`, {
    method: "POST",
    headers: { Authorization: "Bearer userB-token", "Idempotency-Key": idempotencyKey },
  });
  expect(response.status).toBe(200);
  return JSON.parse(response.body) as { balance: number };
}

describe("Section 13.13 — Replay and Idempotency Analysis against the real fixture reward-claim endpoint (1.6)", () => {
  it("detects missing idempotency protection on the vulnerable reward-claim endpoint", async () => {
    const result = await testReplay({
      operation: "POST /api/rewards/claim",
      targetEnvironment: "LOCAL_FIXTURE",
      isFinancialOrSensitive: true,
      expectedIdempotent: true,
      performOperation: claimReward,
    });

    expect(result.status).toBe("TESTED");
    if (result.status !== "TESTED") throw new Error("unreachable");
    expect(result.comparison.consistent).toBe(false);
    expect(result.comparison.finding).toBe(true);
  });

  it("confirms the protected reward-claim endpoint is correctly idempotent for a given key", async () => {
    const idempotencyKey = "integration-test-key-1";
    const result = await testReplay({
      operation: "POST /api/rewards/claim-protected",
      targetEnvironment: "LOCAL_FIXTURE",
      isFinancialOrSensitive: true,
      expectedIdempotent: true,
      performOperation: () => claimProtectedReward(idempotencyKey),
    });

    expect(result.status).toBe("TESTED");
    if (result.status !== "TESTED") throw new Error("unreachable");
    expect(result.comparison).toEqual({ consistent: true, finding: false });
  });

  it("never actually replays a FINANCIAL-classified candidate against a non-fixture target", async () => {
    let invocationCount = 0;
    const result = await testReplay({
      operation: "POST /api/rewards/claim",
      targetEnvironment: "PRODUCTION",
      isFinancialOrSensitive: true,
      expectedIdempotent: true,
      performOperation: async () => {
        invocationCount++;
        return claimReward();
      },
    });

    expect(invocationCount).toBe(0);
    expect(result).toEqual({ status: "SKIPPED_NOT_LOCAL_FIXTURE" });
  });
});
