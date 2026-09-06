import type { BrowserContext, Route } from "playwright";

const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "proxy-authorization", "x-api-key"]);

export interface CredentialSharingPolicy {
  /** The origin (`scheme://host:port`) the session credential belongs to. */
  homeOrigin: string;
  /** Additional hosts explicitly configured to share the same credential — mirrors `safe-http-client`'s `credentialSharingAllowedHosts`. */
  allowedHosts?: readonly string[];
}

function shouldStripCredentials(requestUrl: string, policy: CredentialSharingPolicy): boolean {
  const url = new URL(requestUrl);
  if (url.origin === policy.homeOrigin) return false;
  const allowedHosts = new Set((policy.allowedHosts ?? []).map((host) => host.toLowerCase()));
  return !allowedHosts.has(url.hostname.toLowerCase());
}

/**
 * The Browser Network Policy layer (design.md Decision 34): applies the
 * same cross-origin credential-forwarding policy `safe-http-client`
 * enforces on redirects (Decision 11) — strip Authorization/Cookie/
 * Proxy-Authorization/API-key headers when a request crosses to an origin
 * outside the session's home origin and not explicitly configured to
 * share it — but here, on every request a browser context itself
 * constructs, intercepted via Playwright's `context.route()` *before* it
 * leaves the browser and is encrypted/sent. This is deliberately separate
 * from the Controlled Egress Proxy: the proxy governs *where* a
 * connection may go, not what is inside an HTTPS tunnel it relays — this
 * MVP introduces no TLS interception to inspect/rewrite that.
 */
export async function applyBrowserNetworkPolicy(context: BrowserContext, policy: CredentialSharingPolicy): Promise<void> {
  await context.route("**/*", async (route: Route) => {
    const request = route.request();
    if (!shouldStripCredentials(request.url(), policy)) {
      await route.continue();
      return;
    }

    const headers = await request.allHeaders();
    const stripped: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (!SENSITIVE_HEADERS.has(key.toLowerCase())) stripped[key] = value;
    }
    await route.continue({ headers: stripped });
  });
}
