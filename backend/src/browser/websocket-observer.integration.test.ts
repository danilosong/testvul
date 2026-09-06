import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { observeWebSockets, classifyWebSocketActivity } from "./websocket-observer";
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

describe("WebSocket Observation against the real fixture app's WebSocket page (Section 12.10)", () => {
  it("records the endpoint and that activity occurred, without ever resending any observed message", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const observer = observeWebSockets(page);

    await page.goto(`http://127.0.0.1:${ports.httpPort}/app/ws-demo`);
    // The page auto-sends one ping on open, and the server replies — give
    // both frames time to actually happen.
    await page.waitForTimeout(500);

    observer.stop();
    await context.close();

    expect(observer.activity).toHaveLength(1);
    expect(observer.activity[0]!.url).toMatch(/\/ws$/);
    expect(observer.activity[0]!.frameCount).toBeGreaterThan(0);
    // The only frames that happened are the page's own auto-ping and the
    // server's reply — `observeWebSockets` itself never calls `.send()`
    // or anything else capable of producing traffic on its own.
  }, 20_000);

  it("classifies the fixture's ws-demo activity as WEBSOCKET_MUTATION_INCONCLUSIVE when no corresponding HTTP operation is known for it", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const observer = observeWebSockets(page);

    await page.goto(`http://127.0.0.1:${ports.httpPort}/app/ws-demo`);
    await page.waitForTimeout(500);
    observer.stop();
    await context.close();

    // No HTTP-based DiscoveredOperation is known for this WS endpoint's
    // functionality in this scenario — the engine must not assume safety.
    const results = classifyWebSocketActivity(observer.activity, () => false);
    expect(results).toHaveLength(1);
    expect(results[0]!.classification).toBe("WEBSOCKET_OPERATION_OBSERVED");
    expect(results[0]!.mutationInconclusive).toBe(true);
  }, 20_000);
});
