export type BrowserEgressLevel = "BROWSER_EGRESS_STRICT" | "BROWSER_EGRESS_BEST_EFFORT";

/**
 * Resolves the deployment's actual Browser Egress level (design.md
 * Decision 34) — never inferred or auto-detected from OS/container
 * introspection, matching the same operator/deployment-declared pattern
 * as `ALLOW_PRIVATE_NETWORKS`/`LOCAL_FIXTURE_TEST_CAPABILITY`.
 * `BROWSER_EGRESS_ISOLATED=true` SHALL be set only by a deployment that
 * has actually configured a container/network-namespace whose sole
 * permitted egress route is the Controlled Egress Proxy — see
 * `deploy/browser-egress-strict/docker-compose.yml` for a reference
 * configuration. Every other deployment (including local development, which lacks that
 * container/namespace tooling) resolves to BEST_EFFORT and is reported as
 * such — never silently upgraded to STRICT.
 */
export function resolveBrowserEgressLevel(env: NodeJS.ProcessEnv = process.env): BrowserEgressLevel {
  return env.BROWSER_EGRESS_ISOLATED === "true" ? "BROWSER_EGRESS_STRICT" : "BROWSER_EGRESS_BEST_EFFORT";
}
