import { describe, expect, it } from "vitest";
import { BaseSecurityScanner, ScannerConstructionError } from "./base-security-scanner";
import { NoWriteTemplateError } from "../operation-discovery/no-guess-enforcement";
import { SecurityHttpClient } from "../http/security-http-client";
import { ScopeValidator } from "../scope";
import type { Candidate, ScanContext, ScannerResult, Target } from "./security-scanner";

class FakeScanner extends BaseSecurityScanner {
  readonly name = "FAKE";
  ran = false;

  detect(): Candidate[] {
    return [];
  }

  verify(_context: ScanContext, _candidate: Candidate, result: ScannerResult): ScannerResult {
    return result;
  }

  protected async runMutation(_context: ScanContext, candidate: Candidate): Promise<ScannerResult> {
    this.ran = true;
    return { candidateId: candidate.id, verdict: "RAW_HTML", evidenceIds: [] };
  }
}

function fakeContext(overrides: Partial<ScanContext> = {}): ScanContext {
  return {
    db: {} as ScanContext["db"],
    scanRunId: 1,
    httpClient: new SecurityHttpClient({ scopeValidator: new ScopeValidator(["example.com"]) }),
    operations: [],
    minConfidence: "MEDIUM",
    ...overrides,
  };
}

const CANDIDATE: Candidate = {
  id: 1,
  scanner: "FAKE",
  resourceKey: { targetId: 1, origin: "https://example.com", objectType: "cert", resourceId: "1" },
  resourceUrl: "https://example.com/api/certs/1",
  fieldPath: "certificateText",
  writeMethod: "PATCH",
  eligibilityState: "TESTABLE",
  browserTestability: "REQUIRES_BROWSER_RUNTIME",
};

describe("BaseSecurityScanner construction", () => {
  it("cannot be constructed without an injected SecurityHttpClient", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new FakeScanner(undefined as any)).toThrow(ScannerConstructionError);
  });

  it("can be constructed with a real SecurityHttpClient", () => {
    const scanner = new FakeScanner(new SecurityHttpClient({ scopeValidator: new ScopeValidator(["example.com"]) }));
    expect(scanner.name).toBe("FAKE");
  });
});

describe("BaseSecurityScanner#test", () => {
  it("refuses to run without an eligible DiscoveredOperation", async () => {
    const scanner = new FakeScanner(new SecurityHttpClient({ scopeValidator: new ScopeValidator(["example.com"]) }));
    const context = fakeContext({ operations: [] }); // no eligible PATCH operation for the candidate's URL

    await expect(scanner.test(context, CANDIDATE)).rejects.toThrow(NoWriteTemplateError);
    expect(scanner.ran).toBe(false);
  });

  it("runs the scanner-specific mutation once an eligible operation exists", async () => {
    const scanner = new FakeScanner(new SecurityHttpClient({ scopeValidator: new ScopeValidator(["example.com"]) }));
    const context = fakeContext({
      operations: [{ method: "PATCH", url: CANDIDATE.resourceUrl, source: "OPENAPI", confidence: "HIGH" }],
    });

    const result = await scanner.test(context, CANDIDATE);
    expect(scanner.ran).toBe(true);
    expect(result.verdict).toBe("RAW_HTML");
  });

  it("refuses a candidate with no writeMethod (a passive-only candidate) rather than guessing a mutation", async () => {
    const scanner = new FakeScanner(new SecurityHttpClient({ scopeValidator: new ScopeValidator(["example.com"]) }));
    const context = fakeContext();
    const passiveCandidate: Candidate = { ...CANDIDATE, writeMethod: undefined, eligibilityState: "PASSIVE_ONLY" };

    await expect(scanner.test(context, passiveCandidate)).rejects.toThrow();
    expect(scanner.ran).toBe(false);
  });
});
