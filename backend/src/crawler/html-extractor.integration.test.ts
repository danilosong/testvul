import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { extractFromHtml } from "./html-extractor";
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

describe("extractFromHtml against the fixture app's links/forms/scripts page", () => {
  it("extracts the expected links, form, and script from the real fixture root page", async () => {
    const client = new SecurityHttpClient({
      scopeValidator: new ScopeValidator(["127.0.0.1"]),
      allowPrivateNetworks: true,
    });
    const baseUrl = `http://127.0.0.1:${ports.httpPort}/`;
    const response = await client.request(baseUrl);

    const result = extractFromHtml(response.body, baseUrl);

    expect(result.links).toEqual(expect.arrayContaining([`${baseUrl}projects`, `${baseUrl}api/openapi.json`]));
    expect(result.forms).toEqual([
      {
        action: `${baseUrl}api/projects/1`,
        method: "POST",
        hasExplicitMethod: true,
        inputNames: ["notes"],
        enctype: "application/x-www-form-urlencoded",
      },
    ]);
    expect(result.scripts).toEqual(["https://www.googletagmanager.com/gtm.js?id=GTM-REAL0001", `${baseUrl}app.js`]);
    expect(result.jsonEndpoints).toContain(`${baseUrl}api/openapi.json`);
  });
});
