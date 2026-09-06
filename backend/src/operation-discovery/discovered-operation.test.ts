import { describe, expect, it } from "vitest";
import { hasEligibleOperation, type DiscoveredOperation } from "./discovered-operation";

const OPENAPI_PATCH: DiscoveredOperation = {
  method: "PATCH",
  url: "/api/settings",
  contentType: "application/json",
  source: "OPENAPI",
  confidence: "HIGH",
};

describe("hasEligibleOperation", () => {
  it("returns false when no matching operation exists, per the spec's own test requirement", () => {
    expect(hasEligibleOperation([], "PATCH", "/api/settings", "HIGH")).toBe(false);
  });

  it("returns true when a matching operation meets the required confidence", () => {
    expect(hasEligibleOperation([OPENAPI_PATCH], "PATCH", "/api/settings", "HIGH")).toBe(true);
  });

  it("is case-insensitive on method", () => {
    expect(hasEligibleOperation([OPENAPI_PATCH], "patch", "/api/settings", "HIGH")).toBe(true);
  });

  it("returns false for a matching method/url whose confidence is below the requirement", () => {
    const lowConfidence: DiscoveredOperation = { ...OPENAPI_PATCH, confidence: "LOW" };
    expect(hasEligibleOperation([lowConfidence], "PATCH", "/api/settings", "HIGH")).toBe(false);
  });

  it("returns true when confidence exceeds (not just meets) the requirement", () => {
    expect(hasEligibleOperation([OPENAPI_PATCH], "PATCH", "/api/settings", "MEDIUM")).toBe(true);
  });

  it("returns false for the right method but wrong URL", () => {
    expect(hasEligibleOperation([OPENAPI_PATCH], "PATCH", "/api/other", "HIGH")).toBe(false);
  });

  it("returns false for the right URL but wrong method", () => {
    expect(hasEligibleOperation([OPENAPI_PATCH], "DELETE", "/api/settings", "HIGH")).toBe(false);
  });
});
