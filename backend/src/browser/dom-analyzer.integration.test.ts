import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectDomForCanary } from "./dom-analyzer";
import { generateXssCanary } from "../scanners/xss/xss-canary";
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

describe("DOM-Based Stored XSS Verification against the fixture app's hydration-only profile page (Section 12.24)", () => {
  it("correctly classifies MARKER_RENDERED_AS_HTML once the canary is inserted and the page hydrates", async () => {
    const canary = generateXssCanary();
    await fetch(`${origin()}/api/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: "session=userA-token" },
      body: JSON.stringify({ bio: canary.payload }),
    });

    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    const page = await context.newPage();
    // The initial static HTML has an empty #bio div — content only
    // appears after the page's own JS fetches and hydrates it.
    await page.goto(`${origin()}/app/profile`, { waitUntil: "networkidle" });

    const result = await inspectDomForCanary({ page, containerSelector: "#bio", uuid: canary.uuid });
    expect(result).toBe("MARKER_RENDERED_AS_HTML");

    await context.close();

    // Restore the original bio so this test doesn't leak state to others.
    await fetch(`${origin()}/api/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: "session=userA-token" },
      body: JSON.stringify({ bio: "Hi, I'm User A" }),
    });
  }, 20_000);

  it("correctly classifies MARKER_ABSENT when the canary was never inserted", async () => {
    const canary = generateXssCanary(); // never actually written anywhere
    await fetch(`${origin()}/api/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: "session=userA-token" },
      body: JSON.stringify({ bio: "Just a normal bio" }),
    });

    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    const page = await context.newPage();
    await page.goto(`${origin()}/app/profile`, { waitUntil: "networkidle" });

    const result = await inspectDomForCanary({ page, containerSelector: "#bio", uuid: canary.uuid });
    expect(result).toBe("MARKER_ABSENT");

    await context.close();
    await fetch(`${origin()}/api/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: "session=userA-token" },
      body: JSON.stringify({ bio: "Hi, I'm User A" }),
    });
  }, 20_000);
});
