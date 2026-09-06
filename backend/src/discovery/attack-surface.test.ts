import { describe, expect, it } from "vitest";
import { buildAttackSurface, type DiscoveredResource } from "./attack-surface";

describe("buildAttackSurface", () => {
  it("counts pages, API endpoints, forms, JSON endpoints, auth endpoints, and config endpoints", () => {
    const resources: DiscoveredResource[] = [
      { url: "http://example.com/", method: "GET", isPage: true },
      { url: "http://example.com/about", method: "GET", isPage: true },
      { url: "http://example.com/api/settings", method: "GET" },
      { url: "http://example.com/api/login", method: "POST" },
      { url: "http://example.com/contact", method: "POST", isForm: true },
      { url: "http://example.com/data.json", method: "GET" },
    ];

    const summary = buildAttackSurface(resources);

    expect(summary.counts).toEqual({
      pages: 2,
      apiEndpoints: 2,
      forms: 1,
      jsonEndpoints: 1,
      authEndpoints: 1,
      configEndpoints: 1,
    });
  });

  it("builds a tree rooted at each discovered hostname", () => {
    const resources: DiscoveredResource[] = [
      { url: "http://example.com/a/b", method: "GET" },
      { url: "http://example.com/a/c", method: "GET" },
      { url: "http://other.com/x", method: "GET" },
    ];
    const summary = buildAttackSurface(resources);
    const hostnames = summary.tree.map((n) => n.name).sort();
    expect(hostnames).toEqual(["example.com", "other.com"]);

    const exampleRoot = summary.tree.find((n) => n.name === "example.com")!;
    const aNode = exampleRoot.children.find((n) => n.name === "a")!;
    expect(aNode.children.map((n) => n.name).sort()).toEqual(["b", "c"]);
  });

  it("returns zeroed counts and an empty tree for no resources", () => {
    const summary = buildAttackSurface([]);
    expect(summary.counts).toEqual({ pages: 0, apiEndpoints: 0, forms: 0, jsonEndpoints: 0, authEndpoints: 0, configEndpoints: 0 });
    expect(summary.tree).toEqual([]);
  });
});
