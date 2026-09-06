import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverRuntimeSurface, toDiscoveredResources } from "./browser-runtime-discovery";
import { buildAttackSurface, type DiscoveredResource } from "../discovery/attack-surface";
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

describe("Browser-discovered resources merge into the same Unified Attack Surface as static discovery (Section 12.8)", () => {
  it("GET /api/me and GET /api/my-projects (runtime-only) appear in the same attack-surface data as statically-discovered endpoints", async () => {
    // Static discovery's own output — a resource `buildAttackSurface`
    // already knows how to consume, unrelated to anything the browser saw.
    const staticResources: DiscoveredResource[] = [
      { url: `${origin()}/`, method: "GET", isPage: true },
      { url: `${origin()}/api/openapi.json`, method: "GET" },
    ];

    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    const runtimeResult = await discoverRuntimeSurface(context, `${origin()}/app/projects`);
    await context.close();

    const runtimeResources = toDiscoveredResources(runtimeResult);

    // The one and only place either resource list is interpreted — no
    // separate "browser inventory" data structure exists.
    const summary = buildAttackSurface([...staticResources, ...runtimeResources]);

    const allUrls = collectUrls(summary.tree);
    expect(allUrls.some((url) => url.endsWith("/api/me"))).toBe(true);
    expect(allUrls.some((url) => url.endsWith("/api/my-projects"))).toBe(true);
    expect(allUrls.some((url) => url.endsWith("/api/openapi.json"))).toBe(true);
    expect(summary.counts.apiEndpoints).toBeGreaterThanOrEqual(3);
  }, 20_000);
});

function collectUrls(nodes: ReturnType<typeof buildAttackSurface>["tree"]): string[] {
  const urls: string[] = [];
  for (const node of nodes) {
    if (node.url) urls.push(node.url);
    urls.push(...collectUrls(node.children));
  }
  return urls;
}
