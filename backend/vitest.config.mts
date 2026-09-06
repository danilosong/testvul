import { defineConfig } from "vitest/config";

// Unit-test project: the default `npm test`. Never sets
// ALLOW_PRIVATE_NETWORKS — the production/default private-network block
// stays untouched here. LOCAL_FIXTURE_TEST_CAPABILITY=true is set here (and
// in the integration project) since it is this test-harness build itself,
// per design.md Decision 52 — never present in a shipped/production build.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
    env: {
      LOCAL_FIXTURE_TEST_CAPABILITY: "true",
    },
  },
});
