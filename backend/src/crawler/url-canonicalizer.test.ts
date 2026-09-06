import { describe, expect, it } from "vitest";
import { canonicalizeCrawlUrl } from "./url-canonicalizer";

describe("canonicalizeCrawlUrl", () => {
  it("treats query parameters in a different order as the same URL", () => {
    expect(canonicalizeCrawlUrl("http://example.com/search?b=2&a=1")).toBe(
      canonicalizeCrawlUrl("http://example.com/search?a=1&b=2"),
    );
  });

  it("strips the fragment", () => {
    expect(canonicalizeCrawlUrl("http://example.com/page#section")).toBe(canonicalizeCrawlUrl("http://example.com/page"));
  });

  it("normalizes host casing", () => {
    expect(canonicalizeCrawlUrl("http://EXAMPLE.com/page")).toBe(canonicalizeCrawlUrl("http://example.com/page"));
  });

  it("treats a trailing slash on a non-root path as equivalent to without one", () => {
    expect(canonicalizeCrawlUrl("http://example.com/products/")).toBe(canonicalizeCrawlUrl("http://example.com/products"));
  });

  it("keeps the root path as-is", () => {
    expect(canonicalizeCrawlUrl("http://example.com/")).toBe("http://example.com/");
  });

  it("keeps distinct pagination URLs distinct", () => {
    expect(canonicalizeCrawlUrl("http://example.com/products?page=1")).not.toBe(
      canonicalizeCrawlUrl("http://example.com/products?page=2"),
    );
  });
});
