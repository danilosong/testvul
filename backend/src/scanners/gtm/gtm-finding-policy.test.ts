import { describe, expect, it } from "vitest";
import { evaluateGtmPermissionFinding } from "./gtm-finding-policy";

describe("evaluateGtmPermissionFinding", () => {
  it("classifies AUTHORIZATION_POLICY_VIOLATION when AUTHORIZED contradicts a DENIED expectation", () => {
    expect(evaluateGtmPermissionFinding("AUTHORIZED", "DENIED")).toBe("AUTHORIZATION_POLICY_VIOLATION");
  });

  it("classifies NO_FINDING when AUTHORIZED matches an ALLOWED expectation", () => {
    expect(evaluateGtmPermissionFinding("AUTHORIZED", "ALLOWED")).toBe("NO_FINDING");
  });

  it("classifies INCONCLUSIVE_PERMISSION_EXPECTATION when AUTHORIZED has no configured expectation", () => {
    expect(evaluateGtmPermissionFinding("AUTHORIZED", "NO_EXPECTATION_CONFIGURED")).toBe("INCONCLUSIVE_PERMISSION_EXPECTATION");
  });

  it("never produces a finding for UNAUTHORIZED, regardless of expectation", () => {
    expect(evaluateGtmPermissionFinding("UNAUTHORIZED", "DENIED")).toBe("NO_FINDING");
    expect(evaluateGtmPermissionFinding("UNAUTHORIZED", "ALLOWED")).toBe("NO_FINDING");
    expect(evaluateGtmPermissionFinding("UNAUTHORIZED", "NO_EXPECTATION_CONFIGURED")).toBe("NO_FINDING");
  });

  it("never produces a finding for VALIDATION_REJECTED, regardless of expectation", () => {
    expect(evaluateGtmPermissionFinding("VALIDATION_REJECTED", "DENIED")).toBe("NO_FINDING");
  });

  it("never produces a finding for INCONCLUSIVE, regardless of expectation", () => {
    expect(evaluateGtmPermissionFinding("INCONCLUSIVE", "DENIED")).toBe("NO_FINDING");
  });
});
