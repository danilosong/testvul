import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { extractFromHtml } from "../crawler/html-extractor";
import { operationsFromForms } from "./form-operations";
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

describe("operationsFromForms against the fixture app's real form", () => {
  it("yields the expected DiscoveredOperation for the fixture's root-page form", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    const baseUrl = `http://127.0.0.1:${ports.httpPort}/`;
    const response = await client.request(baseUrl);
    const { forms } = extractFromHtml(response.body, baseUrl);

    const operations = operationsFromForms(forms);

    expect(operations).toEqual([
      {
        method: "POST",
        url: `${baseUrl}api/projects/1`,
        contentType: "application/x-www-form-urlencoded",
        requestSchema: { fields: ["notes"] },
        source: "HTML_FORM",
        confidence: "HIGH",
      },
    ]);
  });
});
