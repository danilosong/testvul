import { describe, expect, it } from "vitest";
import { isGtmField } from "./gtm-field-detection";

describe("isGtmField", () => {
  it.each(["gtm", "gtmId", "googleTagManager", "googleTagManagerId", "containerId"])(
    "matches the field name %s",
    (name) => {
      expect(isGtmField(name)).toBe(true);
    },
  );

  it("matches regardless of case", () => {
    expect(isGtmField("GTMID")).toBe(true);
    expect(isGtmField("GoogleTagManager")).toBe(true);
  });

  it("matches on the last path segment of a nested field path", () => {
    expect(isGtmField("analytics.gtmId")).toBe(true);
    expect(isGtmField("settings.tracking.containerId")).toBe(true);
  });

  it("does not match an unrelated field name", () => {
    expect(isGtmField("username")).toBe(false);
    expect(isGtmField("projectId")).toBe(false);
  });
});
