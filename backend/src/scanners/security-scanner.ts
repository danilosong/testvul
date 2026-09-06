import type { Db } from "../db/connection";
import type { ResourceKey } from "../mutation/resource-key";
import type { EligibilityState } from "../eligibility/eligibility-classifier";
import type { BrowserTestability } from "../eligibility/browser-testability";
import type { DiscoveredOperation, OperationConfidence } from "../operation-discovery/discovered-operation";
import type { SecurityHttpClient } from "../http/security-http-client";

export interface Target {
  id: number;
  hostname: string;
  allowedDomains: readonly string[];
  allowPrivateNetworks: boolean;
}

export interface Candidate {
  id: number;
  scanner: string;
  resourceKey: ResourceKey;
  resourceUrl: string;
  fieldPath?: string;
  /** Absent for a candidate whose test never mutates anything (PASSIVE_ONLY). */
  writeMethod?: string;
  eligibilityState: EligibilityState;
  browserTestability: BrowserTestability;
}

export interface ScanContext {
  db: Db;
  scanRunId: number;
  httpClient: SecurityHttpClient;
  /** Every operation discovered for this target so far — the same set `candidate-eligibility` classified against. */
  operations: readonly DiscoveredOperation[];
  minConfidence: OperationConfidence;
  /** The resolved Authentication Profile headers (e.g. `Authorization`) for whichever identity this candidate is being tested as. A full orchestrator (Section 14) resolves this from `auth-profiles`; absent for an unauthenticated/Anonymous test. */
  authHeaders?: Record<string, string>;
}

export type ScannerVerdict = "REMOVED" | "ESCAPED" | "HTML_ALLOWED" | "RAW_HTML" | "UNSAFE_ATTRIBUTE_SURVIVED" | "POTENTIALLY_EXECUTABLE" | "EXECUTION_CONFIRMED";

export interface ScannerResult {
  candidateId: number;
  verdict: string;
  evidenceIds: number[];
}

/**
 * The internal plugin contract every scanner (XSS, GTM, IDOR, and any
 * future scanner) implements — kept pluggable so a new scanner never
 * touches orchestration, backup/restore, or evidence code (design.md,
 * top-level goals).
 */
export interface SecurityScanner {
  readonly name: string;
  detect(context: ScanContext, target: Target): Promise<Candidate[]> | Candidate[];
  test(context: ScanContext, candidate: Candidate): Promise<ScannerResult>;
  verify(context: ScanContext, candidate: Candidate, result: ScannerResult): Promise<ScannerResult> | ScannerResult;
}
