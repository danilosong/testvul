import { describe, expect, it } from "vitest";
import { loadConfig } from "./index";

// Runs only under vitest.integration.config.ts, the one place
// ALLOW_PRIVATE_NETWORKS=true is set — required so suites that talk to the
// localhost fixture app (fixtures/vulnerable-app) aren't blocked by the
// private-network guard.
describe("loadConfig (integration test project)", () => {
  it("allows private networks only in this dedicated integration project", () => {
    expect(loadConfig(process.env).allowPrivateNetworks).toBe(true);
  });
});
