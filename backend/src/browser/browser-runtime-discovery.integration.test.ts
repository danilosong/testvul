import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverRuntimeSurface } from "./browser-runtime-discovery";
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

describe("Browser runtime discovery against the fixture app's SPA (Section 12.7)", () => {
  it("discovers routes and API calls the initial static HTML never shows", async () => {
    // Confirm the premise first: the static shell alone gives none of this away.
    const shellOnly = await fetch(`${origin()}/app/projects`).then((r) => r.text());
    expect(shellOnly).not.toContain("/api/me");
    expect(shellOnly).not.toContain("/api/my-projects");
    expect(shellOnly).not.toContain("/app/projects/1");

    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);

    const result = await discoverRuntimeSurface(context, `${origin()}/app/projects`);

    const apiUrls = result.apiCalls.map((r) => r.url);
    expect(apiUrls.some((url) => url.endsWith("/api/me"))).toBe(true);
    expect(apiUrls.some((url) => url.endsWith("/api/my-projects"))).toBe(true);
    expect(result.links.some((href) => href.endsWith("/app/projects/1"))).toBe(true);

    await context.close();
  }, 20_000);
});
