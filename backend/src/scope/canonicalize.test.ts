import { describe, expect, it } from "vitest";
import { canonicalizeUrl, UnsupportedSchemeError } from "./canonicalize";

describe("canonicalizeUrl", () => {
  it("strips a trailing dot from the hostname", () => {
    expect(canonicalizeUrl("https://EXAMPLE.COM./path").hostname).toBe("example.com");
  });

  it("normalizes an IDN/Unicode hostname to punycode", () => {
    expect(canonicalizeUrl("https://café.example/").hostname).toBe("xn--caf-dma.example");
  });

  it("evaluates userinfo (user@host) as the real host, not the userinfo", () => {
    expect(canonicalizeUrl("https://example.com@evil.com/").hostname).toBe("evil.com");
  });

  it.each(["http:", "https:"])("accepts the %s scheme", (scheme) => {
    expect(() => canonicalizeUrl(`${scheme}//example.com/`)).not.toThrow();
  });

  it.each(["file:///etc/passwd", "ftp://example.com/", "gopher://example.com/", "data:text/html,x", "javascript:alert(1)"])(
    "rejects %s before any connection attempt",
    (input) => {
      expect(() => canonicalizeUrl(input)).toThrow(UnsupportedSchemeError);
    },
  );
});
