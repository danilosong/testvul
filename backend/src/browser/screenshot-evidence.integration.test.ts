import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureScreenshotEvidence, captureEvidenceForVerification } from "./screenshot-evidence";
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

describe("Screenshot capture, disabled by default with non-destructive redaction (Section 12.26)", () => {
  it("no screenshot is captured unless explicitly enabled", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin()}/login`);

    const result = await captureScreenshotEvidence(page, { enabled: false });

    expect(result.captured).toBe(false);
    expect(result.imageBase64).toBeUndefined();

    await context.close();
  }, 20_000);

  it("covers a password field with a non-destructive overlay before capture, without changing its real value, and removes the overlay after", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin()}/login`);
    await page.fill('input[name="password"]', "real-secret-password");

    let overlayCountDuringCapture = -1;
    const result = await captureScreenshotEvidence(page, {
      enabled: true,
      onOverlayInstalled: async (p) => {
        overlayCountDuringCapture = await p.$$eval("[data-sca-redaction-overlay]", (els) => els.length);
      },
    });

    expect(result.captured).toBe(true);
    expect(result.imageBase64).toBeTruthy();
    expect(result.warning).toBe("Screenshot may contain sensitive visual information");

    // The overlay genuinely existed at capture time...
    expect(overlayCountDuringCapture).toBeGreaterThan(0);
    // ...and was removed immediately afterward.
    const overlayCountAfter = await page.$$eval("[data-sca-redaction-overlay]", (els) => els.length);
    expect(overlayCountAfter).toBe(0);

    // The real value was never touched by the redaction step.
    const passwordValue = await page.$eval('input[name="password"]', (el: any) => el.value);
    expect(passwordValue).toBe("real-secret-password");

    await context.close();
  }, 20_000);

  it("uses structural evidence instead of a screenshot when it is already sufficient to support a finding", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin()}/login`);

    const result = await captureEvidenceForVerification(page, { enabled: true, structuralEvidenceSufficient: true });

    expect(result.captured).toBe(false);
    expect(result.imageBase64).toBeUndefined();

    await context.close();
  }, 20_000);
});
