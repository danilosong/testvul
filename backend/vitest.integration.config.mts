import { defineConfig } from "vitest/config";

// Integration-test project: the only place ALLOW_PRIVATE_NETWORKS=true is
// set, and only for suites that talk to the localhost fixture app
// (fixtures/vulnerable-app) — never the default/unit project above.
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    env: {
      ALLOW_PRIVATE_NETWORKS: "true",
      LOCAL_FIXTURE_TEST_CAPABILITY: "true",
    },
  },
});
