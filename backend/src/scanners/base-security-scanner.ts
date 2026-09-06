import type { SecurityHttpClient } from "../http/security-http-client";
import { assertWriteEligible } from "../operation-discovery/no-guess-enforcement";
import type { Candidate, ScanContext, ScannerResult, SecurityScanner, Target } from "./security-scanner";

export class ScannerConstructionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScannerConstructionError";
  }
}

/**
 * The shared base every concrete scanner extends. Structurally enforces
 * two of Section 11.1's guarantees so no individual scanner can forget
 * them: (1) a scanner cannot be constructed without an injected
 * `SecurityHttpClient` — there is no code path to an HTTP call that
 * bypasses it; (2) `test()` always runs the no-guess write-eligibility
 * guard (Section 7.6) before a subclass's mutation logic (`runMutation`)
 * is ever reached, so a candidate with no eligible `DiscoveredOperation`
 * can never be mutated "to find out."
 */
export abstract class BaseSecurityScanner implements SecurityScanner {
  protected readonly httpClient: SecurityHttpClient;

  constructor(httpClient: SecurityHttpClient) {
    if (!httpClient) {
      throw new ScannerConstructionError("A SecurityScanner cannot be constructed without an injected SecurityHttpClient");
    }
    this.httpClient = httpClient;
  }

  abstract readonly name: string;
  abstract detect(context: ScanContext, target: Target): Promise<Candidate[]> | Candidate[];
  abstract verify(context: ScanContext, candidate: Candidate, result: ScannerResult): Promise<ScannerResult> | ScannerResult;

  async test(context: ScanContext, candidate: Candidate): Promise<ScannerResult> {
    if (!candidate.writeMethod) {
      throw new Error(`Candidate ${candidate.id} has no writeMethod — test() is only for mutating candidates`);
    }
    assertWriteEligible(context.operations, candidate.writeMethod, candidate.resourceUrl, context.minConfidence);
    return this.runMutation(context, candidate);
  }

  /** The scanner-specific mutation logic, reached only after `test()`'s write-eligibility guard has already passed. */
  protected abstract runMutation(context: ScanContext, candidate: Candidate): Promise<ScannerResult>;
}
