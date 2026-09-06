import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverRuntimeSurface } from "./browser-runtime-discovery";
import { classifyGtmRuntimeVerification } from "./gtm-runtime-verification";
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

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

describe("GTM Runtime Verification against the fixture app's hydration-only GTM injection (Section 12.25)", () => {
  it("detects FRONTEND_CONSUMED via the observed post-hydration network request", async () => {
    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    // projects.js injects <script src="...gtm.js?id=${project.analyticsGtm}">
    // only after hydration — the initial static HTML has no such reference at all.
    const result = await discoverRuntimeSurface(context, `${origin()}/app/projects`);
    await context.close();

    const verification = classifyGtmRuntimeVerification(result.apiCalls, "GTM-REAL0001"); // project 1's seeded analyticsGtm value
    expect(verification).toBe("FRONTEND_CONSUMED");
  }, 20_000);

  it("classifies NOT_CONSUMED when no GTM request is observed at all", async () => {
    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    // The settings page never references GTM at all.
    const result = await discoverRuntimeSurface(context, `${origin()}/app/settings`);
    await context.close();

    const verification = classifyGtmRuntimeVerification(result.apiCalls, "GTM-REAL0001");
    expect(verification).toBe("NOT_CONSUMED");
  }, 20_000);

  it("classifies RUNTIME_INCONCLUSIVE when a GTM request is observed but doesn't match the expected id", async () => {
    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    const result = await discoverRuntimeSurface(context, `${origin()}/app/projects`);
    await context.close();

    const verification = classifyGtmRuntimeVerification(result.apiCalls, "GTM-SOMETHING-ELSE");
    expect(verification).toBe("RUNTIME_INCONCLUSIVE");
  }, 20_000);
});
