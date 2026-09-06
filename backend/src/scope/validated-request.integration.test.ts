import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "./scope-validator";
import { issueValidatedRequest } from "./validated-request";
// The fixture app is a plain CommonJS package outside backend/src; this
// import is only ever exercised by the dedicated integration test project
// (vitest.integration.config.mts), never by the production build.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
});

afterAll(async () => {
  await servers.stop();
});

describe("issueValidatedRequest against the fixture app", () => {
  it("follows an in-scope redirect end to end, running the full validation chain on both hops", async () => {
    const scopeValidator = new ScopeValidator(["127.0.0.1"]);
    const result = await issueValidatedRequest(`http://127.0.0.1:${ports.httpPort}/redirect/in-scope`, {
      scopeValidator,
      allowPrivateNetworks: true,
    });

    expect(result.blocked).toBeUndefined();
    expect(result.status).toBe(200);
    expect(result.hops).toHaveLength(2);
    expect(result.hops[0]).toMatchObject({ status: 302 });
    expect(result.hops[1]).toMatchObject({ status: 200 });
  });

  it("blocks an out-of-scope redirect target and never connects to it", async () => {
    const scopeValidator = new ScopeValidator(["127.0.0.1"]);
    const result = await issueValidatedRequest(`http://127.0.0.1:${ports.httpPort}/redirect/out-of-scope`, {
      scopeValidator,
      allowPrivateNetworks: true,
    });

    expect(result.blocked).toBe("OUT_OF_SCOPE");
    expect(result.hops).toHaveLength(2);
    expect(result.hops[0]).toMatchObject({ status: 302 });
    expect(result.hops[1]).toMatchObject({ blocked: "OUT_OF_SCOPE" });
  });

  it("strips the Authorization header when a redirect crosses to a different origin", async () => {
    const scopeValidator = new ScopeValidator(["127.0.0.1"]);
    const result = await issueValidatedRequest(`http://127.0.0.1:${ports.httpPort}/redirect/cross-origin-auth`, {
      scopeValidator,
      allowPrivateNetworks: true,
      headers: { Authorization: "Bearer secret-token" },
    });

    expect(result.status).toBe(200);
    const echoed = JSON.parse(result.body ?? "{}");
    expect(echoed.headers.authorization).toBeUndefined();
  });

  it("retains the Authorization header on a direct (non-redirected) request", async () => {
    const scopeValidator = new ScopeValidator(["127.0.0.1"]);
    const result = await issueValidatedRequest(`http://127.0.0.1:${ports.crossOriginPort}/echo-headers`, {
      scopeValidator,
      allowPrivateNetworks: true,
      headers: { Authorization: "Bearer secret-token" },
    });

    const echoed = JSON.parse(result.body ?? "{}");
    expect(echoed.headers.authorization).toBe("Bearer secret-token");
  });

  it("blocks the request outright when the resolved address is a private/loopback IP and the override is off", async () => {
    const scopeValidator = new ScopeValidator(["127.0.0.1"]);
    const result = await issueValidatedRequest(`http://127.0.0.1:${ports.httpPort}/`, {
      scopeValidator,
      allowPrivateNetworks: false,
    });

    expect(result.blocked).toBe("PRIVATE_IP");
  });
});
