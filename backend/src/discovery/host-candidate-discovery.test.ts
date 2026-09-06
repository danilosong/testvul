import { describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { consolidateHostCandidates } from "./host-candidate-discovery";

describe("consolidateHostCandidates", () => {
  it("records a TLS SAN outside scope as a candidate only — never queued, never assumed authorized", () => {
    const scopeValidator = new ScopeValidator(["example.com"]);
    const result = consolidateHostCandidates(scopeValidator, { tlsSans: ["shared-cert-host.other.com"] });

    expect(result).toEqual([
      { hostname: "shared-cert-host.other.com", source: "TLS_SAN", inScope: false, queued: false },
    ]);
  });

  it("canonicalizes and scope-checks a redirect target before it could be queued", () => {
    const scopeValidator = new ScopeValidator(["example.com"]);
    const inScope = consolidateHostCandidates(scopeValidator, { redirectLocations: ["https://EXAMPLE.COM./next"] });
    expect(inScope).toEqual([{ hostname: "example.com", source: "REDIRECT", inScope: true, queued: true }]);

    const outOfScope = consolidateHostCandidates(scopeValidator, { redirectLocations: ["https://not-authorized.com/next"] });
    expect(outOfScope).toEqual([{ hostname: "not-authorized.com", source: "REDIRECT", inScope: false, queued: false }]);
  });

  it("consolidates hostnames from every source into one candidate list", () => {
    const scopeValidator = new ScopeValidator(["example.com", "*.example.com"]);
    const result = consolidateHostCandidates(scopeValidator, {
      redirectLocations: ["https://example.com/login"],
      absoluteAnchors: ["https://cdn.example.com/logo.png"],
      scriptOrApiUrls: ["https://api.example.com/v1/data"],
      cnameRecords: ["edge.provider.net"],
      tlsSans: ["evil.com"],
    });

    const byHostname = Object.fromEntries(result.map((c) => [c.hostname, c]));
    expect(byHostname["example.com"]).toMatchObject({ source: "REDIRECT", inScope: true });
    expect(byHostname["cdn.example.com"]).toMatchObject({ source: "LINK", inScope: true });
    expect(byHostname["api.example.com"]).toMatchObject({ source: "SCRIPT", inScope: true });
    expect(byHostname["edge.provider.net"]).toMatchObject({ source: "CNAME", inScope: false });
    expect(byHostname["evil.com"]).toMatchObject({ source: "TLS_SAN", inScope: false });
  });

  it("never performs subdomain brute forcing — it only ever reports hostnames it was actually given", () => {
    const scopeValidator = new ScopeValidator(["*.example.com"]);
    const result = consolidateHostCandidates(scopeValidator, { absoluteAnchors: ["https://api.example.com/"] });
    expect(result).toHaveLength(1);
    expect(result[0]!.hostname).toBe("api.example.com");
  });

  it("deduplicates a hostname seen from multiple sources, keeping its first-seen source", () => {
    const scopeValidator = new ScopeValidator(["example.com"]);
    const result = consolidateHostCandidates(scopeValidator, {
      redirectLocations: ["https://example.com/"],
      absoluteAnchors: ["https://example.com/page"],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("REDIRECT");
  });

  it("accepts a bare hostname (e.g. from CNAME/TLS SAN data) without requiring a full URL", () => {
    const scopeValidator = new ScopeValidator(["example.com"]);
    const result = consolidateHostCandidates(scopeValidator, { cnameRecords: ["example.com"] });
    expect(result).toEqual([{ hostname: "example.com", source: "CNAME", inScope: true, queued: true }]);
  });
});
