import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { probeProtocols } from "./protocol-prober";
import { FixtureTrustedSecurityHttpClient } from "../http/test-support/fixture-trusted-http-client";
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

describe("probeProtocols against the fixture app", () => {
  it("detects HTTPS as available and uses it as the primary scheme", async () => {
    // The fixture's HTTPS and HTTP listeners run on different ports in
    // tests (no port 443/80 binding needed), so probe the HTTPS port
    // directly via a host:port target — using the trusted test client so
    // the self-signed certificate doesn't itself cause a false negative.
    const client = new FixtureTrustedSecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    const result = await probeProtocols(client, `127.0.0.1:${ports.httpsPort}`);
    expect(result.httpsAvailable).toBe(true);
    expect(result.primaryScheme).toBe("https");
  });

  it("detects the HTTP endpoint's redirect to HTTPS via probeProtocols itself", async () => {
    const client = new FixtureTrustedSecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    // This host:port has no TLS listener at all, so the HTTPS leg fails —
    // the point of this test is the HTTP leg's redirect detection against
    // the fixture's real /go-https endpoint (from 1.4).
    const result = await probeProtocols(client, `127.0.0.1:${ports.httpPort}`, "/go-https");
    expect(result.httpAvailable).toBe(true);
    expect(result.httpRedirectsToHttps).toBe(true);
    expect(result.httpRedirectStatus).toBe(301);
  });
});
