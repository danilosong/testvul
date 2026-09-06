import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyBrowserNetworkPolicy } from "./browser-network-policy";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let browser: Browser;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser.close();
  await servers.stop();
});

describe("Browser Network Policy against a real Chromium browser and the fixture app", () => {
  it("does not attach a session credential to a cross-origin request to a non-shared destination, verified by inspecting what the browser actually sent", async () => {
    const context = await browser.newContext();
    await context.setExtraHTTPHeaders({ Authorization: "Bearer userA-token" });
    await applyBrowserNetworkPolicy(context, { homeOrigin: `http://127.0.0.1:${ports.httpPort}` });

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${ports.httpPort}/`);

    const echoed = await page.evaluate(
      async (url) => {
        const res = await fetch(url);
        return (await res.json()) as { headers: Record<string, string> };
      },
      `http://127.0.0.1:${ports.crossOriginPort}/echo-headers`,
    );

    expect(echoed.headers.authorization).toBeUndefined();

    await context.close();
  }, 30_000);

  it("strips Authorization and Cookie from the actual outgoing cross-origin HTTPS request", async () => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.setExtraHTTPHeaders({ Authorization: "Bearer userA-token" });
    await context.addCookies([{ name: "session", value: "userA-token", domain: "127.0.0.1", path: "/" }]);
    await applyBrowserNetworkPolicy(context, { homeOrigin: `http://127.0.0.1:${ports.httpPort}` });

    const page = await context.newPage();
    const response = await page.goto(`https://localhost:${ports.httpsPort}/echo-headers`);
    const echoed = (await response!.json()) as { headers: Record<string, string> };

    expect(echoed.headers.authorization).toBeUndefined();
    expect(echoed.headers.cookie).toBeUndefined();
    await context.close();
  }, 30_000);

  it("still attaches the session credential on a same-origin request (the policy strips cross-origin, not everything)", async () => {
    const context = await browser.newContext();
    await context.setExtraHTTPHeaders({ Authorization: "Bearer userA-token" });
    await applyBrowserNetworkPolicy(context, { homeOrigin: `http://127.0.0.1:${ports.httpPort}` });

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${ports.httpPort}/`);

    // /api/profile requires a valid Authorization header — 401 would mean
    // the credential never actually arrived at the same-origin request.
    const profileStatus = await page.evaluate(async () => {
      const res = await fetch("/api/profile");
      return res.status;
    });
    expect(profileStatus).toBe(200);

    await context.close();
  }, 30_000);

  it("shares the credential with an explicitly configured allowed host, even though it's cross-origin", async () => {
    const context = await browser.newContext();
    await context.setExtraHTTPHeaders({ Authorization: "Bearer userA-token" });
    await applyBrowserNetworkPolicy(context, {
      homeOrigin: `http://127.0.0.1:${ports.httpPort}`,
      allowedHosts: ["127.0.0.1"], // covers the cross-origin echo server too, by hostname
    });

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${ports.httpPort}/`);

    const echoed = await page.evaluate(
      async (url) => {
        const res = await fetch(url);
        return (await res.json()) as { headers: Record<string, string> };
      },
      `http://127.0.0.1:${ports.crossOriginPort}/echo-headers`,
    );

    expect(echoed.headers.authorization).toBe("Bearer userA-token");

    await context.close();
  }, 30_000);
});
