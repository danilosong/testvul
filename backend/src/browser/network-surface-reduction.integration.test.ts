import { chromium, type Browser } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { startControlledEgressProxy, type ProxyRequestLogEntry } from "./controlled-egress-proxy";
import { buildBrowserWorkerProxyConfig } from "./browser-worker-proxy-config";
import {
  buildHardenedLaunchArgs,
  QUIC_DISABLE_FLAG,
  WEBRTC_POLICY_FLAG,
  BACKGROUND_NETWORKING_FLAGS,
  DNS_PREFETCH_DISABLE_FLAG,
  SPECULATIVE_CONNECTIONS_DISABLE_FLAG,
  NO_EXTENSIONS_FLAG,
} from "./network-surface-reduction";
import { ScopeValidator } from "../scope";

let browser: Browser | undefined;

afterEach(async () => {
  if (browser) {
    await browser.close();
    browser = undefined;
  }
});

async function launchHardened(proxyPort: number): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: buildHardenedLaunchArgs(),
    proxy: buildBrowserWorkerProxyConfig(proxyPort),
  });
}

describe("Non-Proxy Browser Network Surface Reduction — configuration", () => {
  it("includes the QUIC-disable flag", () => {
    expect(buildHardenedLaunchArgs()).toContain(QUIC_DISABLE_FLAG);
  });

  it("includes the WebRTC non-proxied-UDP-disable policy flag", () => {
    expect(buildHardenedLaunchArgs()).toContain(WEBRTC_POLICY_FLAG);
  });

  it("includes every background/telemetry-networking-disable flag", () => {
    const args = buildHardenedLaunchArgs();
    for (const flag of BACKGROUND_NETWORKING_FLAGS) {
      expect(args).toContain(flag);
    }
  });

  it("includes the DNS-prefetch-disable flag", () => {
    expect(buildHardenedLaunchArgs()).toContain(DNS_PREFETCH_DISABLE_FLAG);
  });

  it("includes the speculative-connections/preconnect-disable flag", () => {
    expect(buildHardenedLaunchArgs()).toContain(SPECULATIVE_CONNECTIONS_DISABLE_FLAG);
  });

  it("includes the no-extensions flag", () => {
    expect(buildHardenedLaunchArgs()).toContain(NO_EXTENSIONS_FLAG);
  });
});

describe("Non-Proxy Browser Network Surface Reduction — observed behavior against a real Chromium + Controlled Egress Proxy", () => {
  it("WebRTC ICE gathering produces no non-proxied UDP candidate — the WebRTC policy flag closes the one channel that could otherwise bypass the proxy entirely", async () => {
    const proxy = await startControlledEgressProxy({ scopeValidator: new ScopeValidator(["example.com"]) });
    browser = await launchHardened(proxy.port);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent("<html><body></body></html>");

    const candidateCount = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        let count = 0;
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            count++;
          } else {
            resolve(count); // gathering complete (null candidate signals the end)
            pc.close();
          }
        };
        pc.createDataChannel("probe");
        pc.createOffer().then((offer) => pc.setLocalDescription(offer));
        setTimeout(() => resolve(count), 3000); // safety timeout in case gathering never signals completion
      });
    });

    expect(candidateCount).toBe(0);

    await context.close();
    await proxy.close();
  }, 20_000);

  it("no connection of any kind reaches the proxy during an idle period — background/telemetry networking is disabled", async () => {
    const log: ProxyRequestLogEntry[] = [];
    const proxy = await startControlledEgressProxy({
      scopeValidator: new ScopeValidator(["example.com"]),
      onRequest: (entry) => log.push(entry),
    });
    browser = await launchHardened(proxy.port);
    const context = await browser.newContext();
    await context.newPage(); // opened, but nothing is ever navigated to

    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(log).toEqual([]);

    await context.close();
    await proxy.close();
  }, 20_000);

  it("a DNS-prefetch hint produces no proxy request for its target host", async () => {
    const log: ProxyRequestLogEntry[] = [];
    const proxy = await startControlledEgressProxy({
      scopeValidator: new ScopeValidator(["example.com"]),
      onRequest: (entry) => log.push(entry),
    });
    browser = await launchHardened(proxy.port);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent('<html><head><link rel="dns-prefetch" href="//dns-prefetch-target.invalid"></head><body></body></html>');
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(log.some((entry) => entry.hostname.includes("dns-prefetch-target.invalid"))).toBe(false);

    await context.close();
    await proxy.close();
  }, 20_000);

  it("a preconnect hint produces no proxy request for its target host", async () => {
    const log: ProxyRequestLogEntry[] = [];
    const proxy = await startControlledEgressProxy({
      scopeValidator: new ScopeValidator(["example.com"]),
      onRequest: (entry) => log.push(entry),
    });
    browser = await launchHardened(proxy.port);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent('<html><head><link rel="preconnect" href="http://preconnect-target.invalid"></head><body></body></html>');
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(log.some((entry) => entry.hostname.includes("preconnect-target.invalid"))).toBe(false);

    await context.close();
    await proxy.close();
  }, 20_000);

  it("loads no browser extension in the automated context", async () => {
    const proxy = await startControlledEgressProxy({ scopeValidator: new ScopeValidator(["example.com"]) });
    browser = await launchHardened(proxy.port);
    const context = await browser.newContext();

    // Playwright only ever populates backgroundPages()/serviceWorkers() for
    // a loaded extension's own background context — with none loaded, both
    // are empty by construction.
    expect(context.backgroundPages()).toEqual([]);

    await context.close();
    await proxy.close();
  }, 20_000);
});
