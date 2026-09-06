import { afterEach, describe, expect, it } from "vitest";
import { BrowserManager, ProxyUnreachableError, assertProxyReachable } from "./browser-manager";
import { startControlledEgressProxy } from "./controlled-egress-proxy";
import { ScopeValidator } from "../scope";

let manager: BrowserManager | undefined;

afterEach(async () => {
  await manager?.stop();
  manager = undefined;
});

describe("assertProxyReachable", () => {
  it("resolves when the proxy is actually accepting connections", async () => {
    const proxy = await startControlledEgressProxy({ scopeValidator: new ScopeValidator(["example.com"]) });
    await expect(assertProxyReachable(proxy.port)).resolves.toBeUndefined();
    await proxy.close();
  });

  it("rejects with ProxyUnreachableError once the proxy has stopped", async () => {
    const proxy = await startControlledEgressProxy({ scopeValidator: new ScopeValidator(["example.com"]) });
    const port = proxy.port;
    await proxy.close();
    await expect(assertProxyReachable(port)).rejects.toThrow(ProxyUnreachableError);
  });
});

describe("BrowserManager — startup self-check", () => {
  it("the browser cannot successfully connect to any destination once the proxy is stopped: createContext() refuses rather than launching a context with no egress", async () => {
    const proxy = await startControlledEgressProxy({ scopeValidator: new ScopeValidator(["example.com"]) });
    manager = new BrowserManager();
    await manager.start({ scopeValidator: new ScopeValidator(["example.com"]) }, proxy);

    // A context created while the proxy was still up works fine.
    const context = await manager.createContext();
    await context.close();

    // Now the proxy stops — the one and only egress path this browser has.
    await proxy.close();

    await expect(manager.createContext()).rejects.toThrow(ProxyUnreachableError);
  }, 30_000);
});
