import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { parseCurlCommand } from "../operation-discovery/curl-parser";
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

describe("cURL import reconstructed and executed exclusively through SecurityHttpClient", () => {
  it("parses a curl command and issues the reconstructed request via SecurityHttpClient against the real fixture app", async () => {
    const curlCommand = `curl -X GET http://127.0.0.1:${ports.httpPort}/api/projects/1 -H 'Authorization: Bearer userA-token'`;
    const parsed = parseCurlCommand(curlCommand);

    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    const response = await client.request(parsed.url, { method: parsed.method, headers: parsed.headers });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).owner).toBe("userA");
  });

  it("the reconstructed request still passes through the mandatory scope gate — importing a curl command is not a bypass", async () => {
    const parsed = parseCurlCommand(`curl http://127.0.0.1:${ports.httpPort}/api/projects/1`);
    const client = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["only-this.example"]) });
    await expect(client.request(parsed.url, { method: parsed.method, headers: parsed.headers })).rejects.toThrow();
  });
});
