import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { runManualModeScan } from "./manual-mode";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
}, 60_000);

afterAll(async () => {
  await servers.stop();
});

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

describe("Section 16.7 — manual mode executes only the specified request, with no discovery stages triggered", () => {
  it("runs exactly the operator-supplied endpoint/method/headers/authentication against the real fixture app", async () => {
    const httpClient = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });

    const result = await runManualModeScan(httpClient, {
      endpoint: `${origin()}/api/projects/1`,
      method: "GET",
      headers: { Authorization: "Bearer userA-token" },
    });

    // No discovery stage ever ran — the pipeline's progress shows exactly one stage.
    expect(result.progress.map((p) => p.stage)).toEqual(["SECURITY_TESTS"]);
    expect(result.progress[0]?.status).toBe("COMPLETED");

    const response = result.results.SECURITY_TESTS as { status: number; body: string };
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ id: "1", owner: "userA" });
  });

  it("executes only the specified request even for a mutating manual-mode call", async () => {
    const httpClient = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });

    const result = await runManualModeScan(httpClient, {
      endpoint: `${origin()}/api/projects/1`,
      method: "PATCH",
      headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "manual-mode-probe" }),
    });

    expect(result.progress.map((p) => p.stage)).toEqual(["SECURITY_TESTS"]);
    const response = result.results.SECURITY_TESTS as { status: number; body: string };
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).notes).toBe("manual-mode-probe");
  });
});
