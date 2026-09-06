import * as net from "node:net";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { startControlledEgressProxy, type ControlledEgressProxy } from "./controlled-egress-proxy";
import { buildBrowserWorkerProxyConfig } from "./browser-worker-proxy-config";
import { buildHardenedLaunchArgs, buildHardenedContextOptions } from "./network-surface-reduction";
import type { ScopeValidator } from "../scope";

export interface BrowserManagerOptions {
  scopeValidator: ScopeValidator;
  allowPrivateNetworks?: boolean;
}

export class ProxyUnreachableError extends Error {
  constructor() {
    super("Controlled Egress Proxy is not reachable — refusing to launch or navigate a browser context without it");
    this.name = "ProxyUnreachableError";
  }
}

export class BrowserManagerNotStartedError extends Error {
  constructor() {
    super("BrowserManager.start() must be called before creating a context");
    this.name = "BrowserManagerNotStartedError";
  }
}

/** The startup self-check: resolves when the Controlled Egress Proxy is actually accepting connections on `port`, rejects with `ProxyUnreachableError` otherwise. */
export function assertProxyReachable(port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", () => {
      socket.destroy();
      reject(new ProxyUnreachableError());
    });
  });
}

/**
 * Owns the Browser Security Testing Engine's Chromium process and its
 * Controlled Egress Proxy, and is the *single* code path that ever creates
 * a browser context. Every other module in this package (session-manager,
 * navigation-engine, action-discovery, etc.) MUST create contexts through
 * `createContext()` — never `browser.newContext()` directly — so
 * Section 12.1's proxy option and Sections 12.4/12.5's hardening
 * (`buildHardenedLaunchArgs`/`buildHardenedContextOptions`) can never be
 * omitted at a call site (enforced structurally by
 * `browser-manager.newcontext-boundary.test.ts`).
 */
export class BrowserManager {
  private browser: Browser | undefined;
  private proxy: ControlledEgressProxy | undefined;

  /** `existingProxy` is injectable for tests that need to stop the proxy independently of the manager afterward — production callers always omit it. */
  async start(options: BrowserManagerOptions, existingProxy?: ControlledEgressProxy): Promise<void> {
    this.proxy =
      existingProxy ??
      (await startControlledEgressProxy({
        scopeValidator: options.scopeValidator,
        ...(options.allowPrivateNetworks !== undefined ? { allowPrivateNetworks: options.allowPrivateNetworks } : {}),
      }));
    this.browser = await chromium.launch({
      headless: true,
      args: buildHardenedLaunchArgs(),
      proxy: buildBrowserWorkerProxyConfig(this.proxy.port),
    });
  }

  /**
   * The mandatory context-creation path. Runs the startup self-check
   * first — refusing to create (and therefore refusing to ever navigate)
   * a context if the Controlled Egress Proxy is not actually reachable,
   * rather than launching a context that would otherwise have no egress
   * at all, or worse, silently fall back to some other path.
   */
  async createContext(): Promise<BrowserContext> {
    if (!this.browser || !this.proxy) throw new BrowserManagerNotStartedError();
    await assertProxyReachable(this.proxy.port);
    return this.browser.newContext(buildHardenedContextOptions());
  }

  async stop(): Promise<void> {
    await this.browser?.close();
    await this.proxy?.close();
    this.browser = undefined;
    this.proxy = undefined;
  }
}
