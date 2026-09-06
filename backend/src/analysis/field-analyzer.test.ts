import { describe, expect, it } from "vitest";
import { analyzeFields } from "./field-analyzer";

describe("analyzeFields", () => {
  it("produces a dotted field path for a nested object, per the spec scenario", () => {
    const result = analyzeFields({ analytics: { gtm: "GTM-NPN9598R" } });
    expect(result).toEqual([{ path: "analytics.gtm", value: "GTM-NPN9598R" }]);
  });

  it("handles multiple levels of nesting", () => {
    const result = analyzeFields({ a: { b: { c: "deep" } } });
    expect(result).toEqual([{ path: "a.b.c", value: "deep" }]);
  });

  it("indexes into an array of primitives", () => {
    const result = analyzeFields({ tags: ["x", "y"] });
    expect(result).toEqual([
      { path: "tags.0", value: "x" },
      { path: "tags.1", value: "y" },
    ]);
  });

  it("walks an array of objects", () => {
    const result = analyzeFields({ items: [{ id: 1 }, { id: 2 }] });
    expect(result).toEqual([
      { path: "items.0.id", value: 1 },
      { path: "items.1.id", value: 2 },
    ]);
  });

  it("handles a mixed structure of objects and arrays", () => {
    const result = analyzeFields({
      project: {
        name: "Alpha",
        members: [{ role: "owner", user: { email: "a@example.com" } }],
      },
    });
    expect(result).toEqual(
      expect.arrayContaining([
        { path: "project.name", value: "Alpha" },
        { path: "project.members.0.role", value: "owner" },
        { path: "project.members.0.user.email", value: "a@example.com" },
      ]),
    );
  });

  it("treats null as a leaf value rather than an object to recurse into", () => {
    const result = analyzeFields({ deletedAt: null });
    expect(result).toEqual([{ path: "deletedAt", value: null }]);
  });

  it("returns a single root-level field for a bare scalar", () => {
    expect(analyzeFields(42)).toEqual([{ path: "", value: 42 }]);
  });

  it("returns an empty list for an empty object or array", () => {
    expect(analyzeFields({})).toEqual([]);
    expect(analyzeFields([])).toEqual([]);
  });
});
