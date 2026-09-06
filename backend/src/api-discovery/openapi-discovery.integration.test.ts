import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { discoverOpenApi } from "./openapi-discovery";
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

describe("discoverOpenApi against the fixture app's real OpenAPI document", () => {
  it("imports the GET+PATCH pair for /api/projects/{id}", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });

    const result = await discoverOpenApi(client, `http://127.0.0.1:${ports.httpPort}/`);

    expect(result).not.toBeNull();
    const methods = result!.operations.filter((op) => op.path === "/api/projects/{id}").map((op) => op.method);
    expect(methods.sort()).toEqual(["GET", "PATCH"]);
  });
});
