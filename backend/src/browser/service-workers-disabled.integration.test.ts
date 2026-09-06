import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildHardenedContextOptions } from "./network-surface-reduction";
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

async function readSwSaveCount(page: import("playwright").Page): Promise<number> {
  const text = await page.textContent("#sw-status");
  return Number((text ?? "").replace("swSaveCount=", ""));
}

afterEach(async () => {
  // contexts are closed within each test
});

describe("Service Workers disabled by default (design.md Section 12.5)", () => {
  it("with Service Workers blocked, each click produces exactly one server-side mutation — the fixture's independent duplicate-forwarding Service Worker never even registers", async () => {
    const context = await browser.newContext(buildHardenedContextOptions());
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    const page = await context.newPage();
    await page.goto(`${origin()}/app/sw-demo`);

    await page.click("#save-btn");
    await page.waitForFunction(() => document.getElementById("sw-status")?.textContent?.includes("swSaveCount="));
    await page.waitForTimeout(400);
    const afterFirstClick = await readSwSaveCount(page);

    await page.click("#save-btn");
    await page.waitForTimeout(400);
    const afterSecondClick = await readSwSaveCount(page);

    expect(afterSecondClick - afterFirstClick).toBe(1);

    await context.close();
  }, 20_000);

  it("with Service Workers allowed (the control case), the Service Worker independently forwards a duplicate mutation that does reach the backend", async () => {
    const context = await browser.newContext(); // serviceWorkers defaults to "allow"
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    const page = await context.newPage();
    await page.goto(`${origin()}/app/sw-demo`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    // The Service Worker only controls the page from the *next* navigation onward.
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    await page.click("#save-btn");
    await page.waitForFunction(() => document.getElementById("sw-status")?.textContent?.includes("swSaveCount="));
    await page.waitForTimeout(500); // let the SW's independent, fire-and-forget duplicate land

    await page.click("#save-btn");
    await page.waitForTimeout(300);
    const afterSecondClick = await readSwSaveCount(page);

    // Two clicks with an active duplicate-forwarding Service Worker means
    // at least 3 real server-side mutations landed by the second click's
    // own primary response (2 from the first click's pair, plus this
    // click's own primary) — strictly more than the 2 a blocked-SW run
    // would ever produce, regardless of which of a click's own two
    // requests happens to win the race back to the page.
    expect(afterSecondClick).toBeGreaterThan(2);

    await context.close();
  }, 20_000);
});
