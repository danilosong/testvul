import { describe, expect, it } from "vitest";
import { extractOperationsFromJs } from "./js-operations";

describe("extractOperationsFromJs", () => {
  it("yields a HIGH-confidence operation via AST parsing for a fully literal axios.patch call, per the spec scenario", () => {
    const result = extractOperationsFromJs('axios.patch("/api/settings", payload);');
    expect(result.usedRegexFallback).toBe(false);
    expect(result.operations).toEqual([
      { method: "PATCH", url: "/api/settings", source: "JAVASCRIPT_STATIC_ANALYSIS", confidence: "HIGH" },
    ]);
  });

  it("yields MEDIUM confidence for a literal method with a partially-templated URL, per the spec scenario", () => {
    const result = extractOperationsFromJs('fetch("/api/projects/" + id, { method: "PATCH" });');
    expect(result.usedRegexFallback).toBe(false);
    expect(result.operations).toEqual([
      { method: "PATCH", url: "/api/projects/", source: "JAVASCRIPT_STATIC_ANALYSIS", confidence: "MEDIUM" },
    ]);
  });

  it("falls back to regex only when the source cannot be parsed into an AST at all, per the spec scenario", () => {
    // JSX is not valid plain JavaScript for acorn — a realistic "file that
    // fails to parse" while still containing a plain, literal fetch call.
    const source = 'const el = <div>broken for a JS-only parser</div>;\nfetch("/api/one");';
    const result = extractOperationsFromJs(source);
    expect(result.usedRegexFallback).toBe(true);
    expect(result.operations).toEqual([
      { method: "GET", url: "/api/one", source: "JAVASCRIPT_STATIC_ANALYSIS", confidence: "MEDIUM" },
    ]);
  });

  it("produces no operation for a dynamically-constructed, unresolvable URL (AST layer)", () => {
    const result = extractOperationsFromJs("fetch(endpointVariable);");
    expect(result.usedRegexFallback).toBe(false);
    expect(result.operations).toEqual([]);
  });

  it("produces no operation for a dynamically-constructed, unresolvable URL (regex fallback layer)", () => {
    const source = "<broken syntax />\nfetch(endpointVariable);";
    const result = extractOperationsFromJs(source);
    expect(result.usedRegexFallback).toBe(true);
    expect(result.operations).toEqual([]);
  });

  it("produces no operation when the method is set dynamically, even with a fully literal URL", () => {
    const result = extractOperationsFromJs('fetch("/api/settings", { method: computedMethod });');
    expect(result.operations).toEqual([]);
  });

  it("defaults a bare fetch() with no options to GET at HIGH confidence", () => {
    const result = extractOperationsFromJs('fetch("/api/data");');
    expect(result.operations).toEqual([
      { method: "GET", url: "/api/data", source: "JAVASCRIPT_STATIC_ANALYSIS", confidence: "HIGH" },
    ]);
  });

  it("resolves a template literal with no interpolations as a full literal", () => {
    const result = extractOperationsFromJs("axios.get(`/api/settings`);");
    expect(result.operations).toEqual([
      { method: "GET", url: "/api/settings", source: "JAVASCRIPT_STATIC_ANALYSIS", confidence: "HIGH" },
    ]);
  });

  it("finds multiple call sites in the same file", () => {
    const result = extractOperationsFromJs('fetch("/api/one"); axios.delete("/api/two");');
    expect(result.operations.map((op) => op.url).sort()).toEqual(["/api/one", "/api/two"]);
  });

  it("never executes the analyzed source", () => {
    expect(() => extractOperationsFromJs('fetch("/api/x"); throw new Error("would blow up if executed");')).not.toThrow();
  });
});
