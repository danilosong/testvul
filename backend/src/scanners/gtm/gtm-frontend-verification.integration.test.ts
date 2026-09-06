import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../../scope";
import { SecurityHttpClient } from "../../http/security-http-client";
import { detectGtmFrontendReference } from "./gtm-frontend-verification";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../../fixtures/vulnerable-app/server");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let httpClient: SecurityHttpClient;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  httpClient = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
});

afterAll(async () => {
  await servers.stop();
});

describe("GTM frontend consumption verification against the real fixture app", () => {
  it("extracts the correct id from the fixture's static GTM script reference", async () => {
    const response = await httpClient.request(`http://127.0.0.1:${ports.httpPort}/`);
    const result = detectGtmFrontendReference(response.body, false);
    expect(result).toEqual({ status: "STATIC_REFERENCE_FOUND", gtmId: "GTM-REAL0001" });
  });

  it("confirms FRONTEND_RUNTIME_NOT_VERIFIED (not NOT_CONSUMED) for a fixture page with no static reference and browser verification disabled", async () => {
    // projects.js constructs the GTM script URL dynamically client-side —
    // a static fetch of it never shows a literal googletagmanager.com/gtm.js?id= reference.
    const response = await httpClient.request(`http://127.0.0.1:${ports.httpPort}/app-assets/projects.js`);
    const result = detectGtmFrontendReference(response.body, false);
    expect(result).toEqual({ status: "FRONTEND_RUNTIME_NOT_VERIFIED" });
  });
});
