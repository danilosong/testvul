import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { discoverOpenApi } from "../api-discovery/openapi-discovery";
import { operationsFromOpenApi } from "./openapi-operations";
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

describe("operationsFromOpenApi against the fixture app's real OpenAPI document", () => {
  it("derives a HIGH-confidence OPENAPI operation for the documented PATCH", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    const schema = await discoverOpenApi(client, `http://127.0.0.1:${ports.httpPort}/`);
    expect(schema).not.toBeNull();

    const operations = operationsFromOpenApi(schema!);
    const patch = operations.find((op) => op.method === "PATCH" && op.url === "/api/projects/{id}");

    expect(patch).toMatchObject({
      source: "OPENAPI",
      confidence: "HIGH",
      contentType: "application/json",
      requestSchema: { type: "object" },
    });
  });
});
