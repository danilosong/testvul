import { describe, expect, it } from "vitest";
import { ScopeValidator } from "./scope-validator";

describe("ScopeValidator", () => {
  it("allows a host in explicit scope", () => {
    const validator = new ScopeValidator(["example.com"]);
    expect(validator.isInScope("https://example.com/")).toBe(true);
  });

  it("rejects a host outside scope", () => {
    const validator = new ScopeValidator(["example.com"]);
    expect(validator.isInScope("https://payments.external-provider.com/")).toBe(false);
  });

  it("queues a subdomain within wildcard scope", () => {
    const validator = new ScopeValidator(["*.example.com"]);
    expect(validator.isInScope("https://api.example.com/")).toBe(true);
  });

  it("records a subdomain outside wildcard scope as out of scope", () => {
    const validator = new ScopeValidator(["*.example.com"]);
    expect(validator.isInScope("https://example.net/")).toBe(false);
  });

  it("does not treat a confusable suffix as matching the wildcard", () => {
    const validator = new ScopeValidator(["*.example.com"]);
    expect(validator.isInScope("https://evil-example.com/")).toBe(false);
    expect(validator.isInScope("https://example.com.evil.com/")).toBe(false);
  });

  it("accepts a URL instance as well as a string", () => {
    const validator = new ScopeValidator(["example.com"]);
    expect(validator.isInScope(new URL("https://example.com/path"))).toBe(true);
  });

  it("returns false for an unparseable URL instead of throwing", () => {
    const validator = new ScopeValidator(["example.com"]);
    expect(validator.isInScope("not a url")).toBe(false);
  });

  it("normalizes case and a trailing dot before comparison", () => {
    const validator = new ScopeValidator(["example.com"]);
    expect(validator.isInScope("https://EXAMPLE.COM./")).toBe(true);
  });

  it("normalizes an IDN hostname to punycode before comparison", () => {
    const validator = new ScopeValidator(["xn--caf-dma.example"]);
    expect(validator.isInScope("https://café.example/")).toBe(true);
  });

  it("evaluates userinfo confusion against the real host, not the userinfo", () => {
    const validator = new ScopeValidator(["example.com"]);
    expect(validator.isInScope("https://example.com@evil.com/")).toBe(false);
  });

  it("rejects a non-http(s) scheme regardless of what the host portion says", () => {
    const validator = new ScopeValidator(["example.com"]);
    expect(validator.isInScope("file:///etc/passwd")).toBe(false);
    expect(validator.isInScope("javascript:alert(document.domain)")).toBe(false);
  });
});
