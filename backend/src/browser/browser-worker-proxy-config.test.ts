import * as net from "node:net";
import { describe, expect, it } from "vitest";
import { startControlledEgressProxy } from "./controlled-egress-proxy";
import { buildBrowserWorkerProxyConfig } from "./browser-worker-proxy-config";
import { ScopeValidator } from "../scope";

describe("buildBrowserWorkerProxyConfig", () => {
  it("never includes a bypass list — no host is ever exempted from the proxy", async () => {
    const proxy = await startControlledEgressProxy({ scopeValidator: new ScopeValidator(["example.com"]) });
    const config = buildBrowserWorkerProxyConfig(proxy.port);
    expect(config.bypass).toBe("");
    await proxy.close();
  });

  it("a STRICT-configured Browser Worker cannot open any direct connection when the proxy is stopped — the config encodes no other destination to fall back to", async () => {
    const proxy = await startControlledEgressProxy({ scopeValidator: new ScopeValidator(["example.com"]) });
    const config = buildBrowserWorkerProxyConfig(proxy.port);
    await proxy.close();

    const url = new URL(config.server);
    await expect(
      new Promise<void>((resolve, reject) => {
        const socket = net.connect(Number(url.port), url.hostname, () => resolve());
        socket.on("error", reject);
      }),
    ).rejects.toThrow();
  });
});
