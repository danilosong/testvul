import { describe, expect, it } from "vitest";
import { loadConfig } from "./index";

describe("loadConfig (default/unit test project)", () => {
  it("passes a trivial smoke check", () => {
    expect(1 + 1).toBe(2);
  });

  it("blocks private networks by default — the unit test project never sets ALLOW_PRIVATE_NETWORKS", () => {
    expect(loadConfig(process.env).allowPrivateNetworks).toBe(false);
  });

  it("blocks private networks even if the caller passes an unrelated env", () => {
    expect(loadConfig({}).allowPrivateNetworks).toBe(false);
  });

  it("enables the LOCAL_FIXTURE test capability under this test harness's own env", () => {
    expect(loadConfig(process.env).localFixtureTestCapability).toBe(true);
  });

  it("the LOCAL_FIXTURE test capability defaults to false for an arbitrary/production-like env", () => {
    expect(loadConfig({}).localFixtureTestCapability).toBe(false);
  });
});
