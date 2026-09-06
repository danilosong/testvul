import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { classifyClientLimitSignal, observeClientLimitElementState, testBusinessLimitEnforcement } from "./business-limit-analyzer";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let httpClient: SecurityHttpClient;
let browser: Browser;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  httpClient = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser.close();
  await servers.stop();
});

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

async function setQuantity(endpoint: string, quantity: number): Promise<{ status: number }> {
  const response = await httpClient.request(`${origin()}${endpoint}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
    body: JSON.stringify({ quantity }),
  });
  return { status: response.status };
}

describe("Section 13.16 — Business Limit representation and enforcement testing against the fixture app's UI-only-limited action (1.5)", () => {
  it("confirms a Server-Side Business Limit Not Enforced finding: the UI disables past the client limit, but the backend accepts an over-limit request", async () => {
    // Legitimately reach the client-side limit (10) first, so the UI's own
    // increase button renders disabled on page load.
    await setQuantity("/api/settings", 10);

    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    const page = await context.newPage();
    await page.goto(`${origin()}/app/settings`);
    await page.waitForSelector(".increase-btn");

    const clientLimitOnlyButton = page.locator(".increase-btn").nth(0);
    const state = await observeClientLimitElementState(clientLimitOnlyButton);
    expect(classifyClientLimitSignal(state)).toBe("DISABLED");
    await context.close();

    const result = await testBusinessLimitEnforcement({
      observeClientLimitSignal: async () => classifyClientLimitSignal(state),
      attemptOverLimitRequest: async () => {
        const { status } = await setQuantity("/api/settings", 11);
        return { accepted: status === 200 };
      },
    });

    expect(result).toEqual({ clientLimitSignal: "DISABLED", backendAccepted: true, finding: true });
  }, 30_000);

  it("raises no finding for the server-enforced variant: the same UI limit is observed, but the backend correctly rejects the over-limit request", async () => {
    await setQuantity("/api/settings-enforced", 10);

    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    const page = await context.newPage();
    await page.goto(`${origin()}/app/settings`);
    await page.waitForSelector(".increase-btn");

    const serverEnforcedButton = page.locator(".increase-btn").nth(1);
    const state = await observeClientLimitElementState(serverEnforcedButton);
    expect(classifyClientLimitSignal(state)).toBe("DISABLED");
    await context.close();

    const result = await testBusinessLimitEnforcement({
      observeClientLimitSignal: async () => classifyClientLimitSignal(state),
      attemptOverLimitRequest: async () => {
        const { status } = await setQuantity("/api/settings-enforced", 11);
        return { accepted: status === 200 };
      },
    });

    expect(result).toEqual({ clientLimitSignal: "DISABLED", backendAccepted: false, finding: false });
  }, 30_000);
});
