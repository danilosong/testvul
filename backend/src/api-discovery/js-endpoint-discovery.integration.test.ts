import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { discoverJsEndpoints } from "./js-endpoint-discovery";
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

describe("discoverJsEndpoints against the fixture app's real app.js", () => {
  it("discovers the axios.patch and fetch PATCH call sites", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    const response = await client.request(`http://127.0.0.1:${ports.httpPort}/app.js`);

    const result = discoverJsEndpoints(response.body);

    expect(result).toEqual(
      expect.arrayContaining([
        { method: "PATCH", path: "/api/projects/" },
        { method: "PATCH", path: "/api/settings" },
      ]),
    );
  });
});
