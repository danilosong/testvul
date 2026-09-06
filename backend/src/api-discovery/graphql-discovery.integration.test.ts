import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { identifyGraphQlEndpoint } from "./graphql-discovery";
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

describe("identifyGraphQlEndpoint against the fixture app's real /graphql endpoint", () => {
  it("identifies it as GraphQL without ever sending an introspection query", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });

    const result = await identifyGraphQlEndpoint(client, `http://127.0.0.1:${ports.httpPort}/graphql`);

    expect(result.isGraphQlEndpoint).toBe(true);
    expect(result.evidence).toContain("Must provide query string.");
  });
});
