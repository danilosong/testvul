import { startControlledEgressProxy } from "./controlled-egress-proxy";
import { ScopeValidator } from "../scope";
import { loadConfig } from "../config";

/**
 * Standalone entry point for running the Controlled Egress Proxy as its
 * own process/container (see `deploy/browser-egress-strict/`). Scope is
 * read from `SCOPE_ALLOWLIST` (comma-separated hostnames/wildcards) — the
 * same allowlist the rest of a scan run is configured with; a real
 * deployment wires this from the active scan's persisted scope
 * configuration rather than a static env var, but this default keeps the
 * container runnable on its own.
 */
async function main(): Promise<void> {
  const scopeEntries = (process.env.SCOPE_ALLOWLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const host = process.env.PROXY_HOST ?? "127.0.0.1";
  const proxy = await startControlledEgressProxy({
    scopeValidator: new ScopeValidator(scopeEntries),
    allowPrivateNetworks: loadConfig().allowPrivateNetworks,
    host,
  });
  // eslint-disable-next-line no-console
  console.log(`Controlled Egress Proxy listening on ${host}:${proxy.port}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
