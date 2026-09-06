import { describe, expect, it } from "vitest";
import * as scopeModule from "./index";
import { ScopeValidator, ScopeViolationError, issueValidatedRequest } from "./index";

describe("scope module public surface", () => {
  it("does not export performRequest or any other raw-transport function — issueValidatedRequest is the only way in", () => {
    const exportedNames = Object.keys(scopeModule);
    expect(exportedNames).not.toContain("performRequest");
    expect((scopeModule as Record<string, unknown>)["performRequest"]).toBeUndefined();
    expect(exportedNames.sort()).toEqual(
      [
        "BlockReason",
        "HopRecord",
        "HopValidation",
        "IpValidationOptions",
        "IssueValidatedRequestOptions",
        "REDIRECT_STATUSES",
        "ScopeValidator",
        "ScopeViolationError",
        "UnsupportedSchemeError",
        "ValidatedRequestResult",
        "canonicalizeUrl",
        "isBlockedIp",
        "issueValidatedRequest",
        "stripSensitiveHeaders",
        "validateHop",
      ]
        // type-only exports (interfaces/type aliases) leave no runtime key —
        // filter the expectation down to what Object.keys can actually see.
        .filter((name) => name in scopeModule),
    );
    expect(typeof issueValidatedRequest).toBe("function");
  });

  it("assertAllowed fails closed: a URL never explicitly authorized is always rejected", () => {
    const validator = new ScopeValidator([]); // nothing authorized at all
    expect(() => validator.assertAllowed("https://example.com/")).toThrow(ScopeViolationError);
  });

  it("assertAllowed returns the canonicalized URL for an explicitly in-scope target", () => {
    const validator = new ScopeValidator(["example.com"]);
    expect(validator.assertAllowed("https://EXAMPLE.COM./path").href).toBe("https://example.com/path");
  });

  it("assertAllowed rejects an out-of-scope target", () => {
    const validator = new ScopeValidator(["example.com"]);
    expect(() => validator.assertAllowed("https://not-authorized.com/")).toThrow(ScopeViolationError);
  });
});
