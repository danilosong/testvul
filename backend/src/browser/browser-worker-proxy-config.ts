export interface BrowserWorkerProxyConfig {
  server: string;
  /** Always empty — no host is ever exempted from routing through the Controlled Egress Proxy (there is no bypass list a caller could weaken). */
  bypass: string;
}

/**
 * The Playwright `proxy` launch/context option (design.md Decision 34)
 * every Browser Worker context uses, unconditionally: `server` points at
 * the Controlled Egress Proxy and `bypass` is always empty. The only
 * destination this configuration ever encodes is the proxy's own
 * address — there is no code path here that could add a direct,
 * proxy-bypassing route to any host.
 */
export function buildBrowserWorkerProxyConfig(proxyPort: number, host = "127.0.0.1"): BrowserWorkerProxyConfig {
  return { server: `http://${host}:${proxyPort}`, bypass: "" };
}
