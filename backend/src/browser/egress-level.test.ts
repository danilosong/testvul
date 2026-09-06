import { describe, expect, it } from "vitest";
import { resolveBrowserEgressLevel } from "./egress-level";

describe("resolveBrowserEgressLevel", () => {
  it("labels a deployment without container/namespace isolation as BEST_EFFORT, never STRICT", () => {
    expect(resolveBrowserEgressLevel({})).toBe("BROWSER_EGRESS_BEST_EFFORT");
  });

  it("resolves STRICT only when the deployment explicitly declares the isolation is actually in place", () => {
    expect(resolveBrowserEgressLevel({ BROWSER_EGRESS_ISOLATED: "true" })).toBe("BROWSER_EGRESS_STRICT");
  });

  it("treats any value other than the literal string 'true' as not isolated", () => {
    expect(resolveBrowserEgressLevel({ BROWSER_EGRESS_ISOLATED: "1" })).toBe("BROWSER_EGRESS_BEST_EFFORT");
    expect(resolveBrowserEgressLevel({ BROWSER_EGRESS_ISOLATED: "yes" })).toBe("BROWSER_EGRESS_BEST_EFFORT");
  });
});
