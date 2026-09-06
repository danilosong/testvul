import { describe, expect, it } from "vitest";
import type { Candidate } from "../scanners/security-scanner";
import type { DiscoveredOperation } from "../operation-discovery/discovered-operation";
import type { BusinessInvariant } from "../business-logic/invariant-engine";
import { buildBusinessTestPlan } from "../business-logic/business-test-plan";
import { buildBusinessFindingInput } from "./business-finding-builder";
import { buildTechnicalFindingInput, isXssFindingWorthyVerdict, NotAFindingWorthyVerdictError, severityForXssVerdict } from "./technical-finding-builder";

describe("severityForXssVerdict / isXssFindingWorthyVerdict (Section 15.1)", () => {
  it("REMOVED, ESCAPED, and HTML_ALLOWED (a working, intentional sanitizer allowlist) are never finding-worthy", () => {
    expect(isXssFindingWorthyVerdict("REMOVED")).toBe(false);
    expect(isXssFindingWorthyVerdict("ESCAPED")).toBe(false);
    expect(isXssFindingWorthyVerdict("HTML_ALLOWED")).toBe(false);
    expect(() => severityForXssVerdict("REMOVED")).toThrow(NotAFindingWorthyVerdictError);
    expect(() => severityForXssVerdict("HTML_ALLOWED")).toThrow(NotAFindingWorthyVerdictError);
  });

  it("RAW_HTML and POTENTIALLY_EXECUTABLE/EXECUTION_CONFIRMED are finding-worthy, at increasing severity", () => {
    expect(severityForXssVerdict("RAW_HTML")).toBe("HIGH");
    expect(severityForXssVerdict("POTENTIALLY_EXECUTABLE")).toBe("CRITICAL");
    expect(severityForXssVerdict("EXECUTION_CONFIRMED")).toBe("CRITICAL");
  });
});

describe("Finding data model (Section 15.1) — a generated finding of each kind carries all its required fields", () => {
  it("a technical finding carries scanRunId/title/severity/targetEndpoint, and never the business-logic taxonomy", () => {
    const finding = buildTechnicalFindingInput({
      scanRunId: 1,
      title: "Stored XSS: notes field stores raw, unescaped HTML",
      severity: severityForXssVerdict("RAW_HTML"),
      evidentiaryOutcome: "PROVEN_VULNERABLE",
      targetEndpoint: "https://example.com/api/projects/1",
      fieldPath: "notes",
    });

    expect(finding.scanRunId).toBe(1);
    expect(finding.title).toBeTruthy();
    expect(finding.severity).toBe("HIGH");
    expect(finding.evidentiaryOutcome).toBe("PROVEN_VULNERABLE");
    expect(finding.targetEndpoint).toBe("https://example.com/api/projects/1");
    expect(finding.category).toBeUndefined();
    expect(finding.confidence).toBeUndefined();
    expect(finding.proofLevel).toBeUndefined();
  });

  it("a business-logic finding carries scanRunId/title/severity plus category/confidence/proofLevel together", () => {
    const candidate: Candidate = {
      id: 1,
      scanner: "BUSINESS_LOGIC",
      resourceKey: { targetId: 1, origin: "https://example.com", objectType: "Ticket", resourceId: "7" },
      resourceUrl: "https://example.com/api/vuln-contest/tickets/7",
      fieldPath: "number",
      writeMethod: "PATCH",
      eligibilityState: "TESTABLE",
      browserTestability: "FULLY_TESTABLE",
    };
    const operation: DiscoveredOperation = { method: "PATCH", url: candidate.resourceUrl, source: "OPENAPI", confidence: "HIGH" };
    const invariant: BusinessInvariant = {
      id: 5,
      targetId: 1,
      name: "Ticket.number is immutable after PAID",
      objectType: "Ticket",
      condition: { field: "status", operator: "EQ", value: "PAID" },
      expected: false,
      severity: "HIGH",
    };
    const plan = buildBusinessTestPlan(candidate, operation, invariant, "SAFE_REVERSIBLE_MUTATION");

    const finding = buildBusinessFindingInput({
      scanRunId: 1,
      plan,
      category: "INVALID_STATE_TRANSITION",
      confidence: "HIGH",
      proofLevel: "CONFIRMED",
      severity: "HIGH",
      violationDetected: true,
    });

    expect(finding.scanRunId).toBe(1);
    expect(finding.title).toBeTruthy();
    expect(finding.severity).toBe("HIGH");
    expect(finding.evidentiaryOutcome).toBe("PROVEN_VULNERABLE");
    expect(finding.category).toBe("INVALID_STATE_TRANSITION");
    expect(finding.confidence).toBe("HIGH");
    expect(finding.proofLevel).toBe("CONFIRMED");
    expect(finding.fieldPath).toBe("number");
    expect(finding.targetEndpoint).toBe(candidate.resourceUrl);
  });
});
