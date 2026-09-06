import { describe, expect, it } from "vitest";
import { computeAllowedScope } from "./allowed-scope";

describe("computeAllowedScope (Section 16.3)", () => {
  it("defaults to exactly the Target DNS value", () => {
    expect(computeAllowedScope("api.example.com")).toEqual(["api.example.com"]);
  });

  it("the 'Include authorized subdomains' checkbox produces the wildcard form, alongside the Target DNS itself", () => {
    expect(computeAllowedScope("api.example.com", { includeSubdomains: true })).toEqual(["api.example.com", "*.api.example.com"]);
  });

  it("Advanced Scope overrides both the default and the subdomains checkbox", () => {
    expect(computeAllowedScope("api.example.com", { advancedScope: ["other-host.example.org", "*.example.net"] })).toEqual([
      "other-host.example.org",
      "*.example.net",
    ]);
    expect(computeAllowedScope("api.example.com", { includeSubdomains: true, advancedScope: ["only-this.example.com"] })).toEqual([
      "only-this.example.com",
    ]);
  });
});
