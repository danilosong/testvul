import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "./security-http-client";
import { FixtureTrustedSecurityHttpClient } from "./test-support/fixture-trusted-http-client";
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

describe("TLS certificate trust", () => {
  it("rejects the local self-signed fixture certificate in the default (production) configuration", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    await expect(client.request(`https://127.0.0.1:${ports.httpsPort}/`)).rejects.toThrow();
  });

  it("accepts the same certificate only through the build-time-only test-support subclass", async () => {
    const client = new FixtureTrustedSecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    const response = await client.request(`https://127.0.0.1:${ports.httpsPort}/`);
    expect(response.status).toBe(200);
  });
});
