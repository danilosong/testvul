import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { discoverRoot } from "./http-discovery";
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

describe("discoverRoot against the fixture app", () => {
  it("captures status, headers, cookies, content-type, server info, redirects, and the HTML body", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });

    const result = await discoverRoot(client, `http://127.0.0.1:${ports.httpPort}/`);

    expect(result.status).toBe(200);
    expect(result.contentType).toBe("text/html");
    expect(result.server).toBe("nginx");
    expect(result.redirectChain).toEqual([]);
    expect(result.finalUrl).toBe(`http://127.0.0.1:${ports.httpPort}/`);
    expect(result.htmlBody).toMatch(/<html/i);
    expect(result.headers["content-type"]).toBeDefined();
  });

  it("captures the followed redirect chain and the final URL reached", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });

    const result = await discoverRoot(client, `http://127.0.0.1:${ports.httpPort}/redirect/in-scope`);

    expect(result.redirectChain).toEqual([`http://127.0.0.1:${ports.httpPort}/redirect/in-scope`]);
    expect(result.finalUrl).toBe(`http://127.0.0.1:${ports.httpPort}/projects`);
    expect(result.status).toBe(200);
  });
});
