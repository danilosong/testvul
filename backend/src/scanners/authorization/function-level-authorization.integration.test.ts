import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFunctionLevelAuthorization } from "./function-level-authorization";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../../fixtures/vulnerable-app/server");

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

const RESTRICTED_CONTENT_PATTERN = /"rankings":\[/;

describe("Browser-assisted function-level authorization testing against the fixture app's admin page (Section 12.22)", () => {
  it("confirms a finding only when real admin content is actually delivered", async () => {
    const context = await browser.newContext();
    // Authenticated as a non-admin user — the interesting case: can a
    // low-privilege session reach genuine admin content via direct navigation?
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    const page = await context.newPage();

    // Simulates a genuinely broken deployment where the backend's
    // function-level check is missing — the real content the admin
    // summary API is supposed to gate behind a role check.
    await page.route("**/api/admin/summary", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rankings: ["Alpha", "Beta"] }) });
    });

    const result = await checkFunctionLevelAuthorization({
      page,
      url: `${origin()}/app/admin`,
      restrictedContentPattern: RESTRICTED_CONTENT_PATTERN,
    });

    expect(result).toBe("POTENTIAL_BROKEN_FLA");
    await context.close();
  }, 20_000);

  it("a 200-with-no-real-admin-content page produces no finding — the fixture's admin page correctly returns 200 but renders only an access-denied message for a non-admin", async () => {
    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    const page = await context.newPage();

    // No mocking here — the real, correctly-protected fixture behavior:
    // /app/admin itself is always 200 (a static shell), but
    // /api/admin/summary genuinely returns 403 for a non-admin, so the
    // page renders "Forbidden", not real content.
    const result = await checkFunctionLevelAuthorization({
      page,
      url: `${origin()}/app/admin`,
      restrictedContentPattern: RESTRICTED_CONTENT_PATTERN,
    });

    expect(result).toBe("NO_FINDING");
    await context.close();
  }, 20_000);
});
