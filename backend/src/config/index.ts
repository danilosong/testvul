export interface AppConfig {
  allowPrivateNetworks: boolean;
  /** design.md Decision 52 — set only by the test/build harness (vitest config), never present in a shipped/production build. */
  localFixtureTestCapability: boolean;
}

/**
 * `allowPrivateNetworks` defaults to false in every configuration except
 * the dedicated integration-test project (vitest.integration.config.ts),
 * which is the only place `ALLOW_PRIVATE_NETWORKS=true` is ever set — so
 * the production/default private-network block is never weakened by
 * loading this module. `localFixtureTestCapability` follows the identical
 * pattern for `LOCAL_FIXTURE_TEST_CAPABILITY=true`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    allowPrivateNetworks: env.ALLOW_PRIVATE_NETWORKS === "true",
    localFixtureTestCapability: env.LOCAL_FIXTURE_TEST_CAPABILITY === "true",
  };
}
