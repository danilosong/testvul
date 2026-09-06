import { describe, expect, it } from "vitest";
import { isInScope, partitionObservationsByScope } from "./origin-scope-guard";
import { ScopeValidator } from "../scope";
import type { ObservedRequest } from "./network-observer";

const SCOPE = new ScopeValidator(["example.com"]);

describe("isInScope", () => {
  it("is true for a URL the Scope Engine authorizes", () => {
    expect(isInScope("https://example.com/api/foo", SCOPE)).toBe(true);
  });

  it("records a third-party domain as out-of-scope rather than treating it as authorized", () => {
    expect(isInScope("https://third-party-tracker.example.net/beacon", SCOPE)).toBe(false);
  });

  it("is false for a malformed/unsupported URL rather than throwing", () => {
    expect(isInScope("not a url", SCOPE)).toBe(false);
  });
});

describe("partitionObservationsByScope", () => {
  it("separates in-scope and out-of-scope observations without dropping either silently", () => {
    const observations: ObservedRequest[] = [
      { method: "GET", url: "https://example.com/api/projects", resourceType: "fetch", headers: {} },
      { method: "GET", url: "https://third-party-tracker.example.net/beacon", resourceType: "fetch", headers: {} },
    ];

    const result = partitionObservationsByScope(observations, SCOPE);

    expect(result.inScope).toHaveLength(1);
    expect(result.inScope[0]!.url).toBe("https://example.com/api/projects");
    expect(result.outOfScope).toHaveLength(1);
    expect(result.outOfScope[0]!.url).toBe("https://third-party-tracker.example.net/beacon");
  });
});
