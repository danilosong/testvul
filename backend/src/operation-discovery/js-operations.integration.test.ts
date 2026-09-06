import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { extractOperationsFromJs } from "./js-operations";
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

describe("extractOperationsFromJs against the fixture app's real app.js", () => {
  it("parses the file as a valid AST and extracts both call sites at HIGH/MEDIUM confidence", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    const response = await client.request(`http://127.0.0.1:${ports.httpPort}/app.js`);

    const result = extractOperationsFromJs(response.body);

    expect(result.usedRegexFallback).toBe(false);
    expect(result.operations).toEqual(
      expect.arrayContaining([
        { method: "PATCH", url: "/api/projects/", source: "JAVASCRIPT_STATIC_ANALYSIS", confidence: "MEDIUM" },
        { method: "PATCH", url: "/api/settings", source: "JAVASCRIPT_STATIC_ANALYSIS", confidence: "HIGH" },
      ]),
    );
  });
});
