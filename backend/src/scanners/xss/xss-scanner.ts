import { BaseSecurityScanner } from "../base-security-scanner";
import type { Candidate, ScanContext, ScannerResult } from "../security-scanner";
import { runMutationTestCycle, type MutationCycleResult } from "../../mutation/mutation-cycle";
import { assertWriteEligible } from "../../operation-discovery/no-guess-enforcement";
import { recordEvidence } from "../../evidence/evidence-collector";
import { listCandidatesForScanRun } from "../../eligibility/candidates-repository";
import { withAuthHeaders } from "../authenticated-requester";
import { generateXssCanary, classifyStoredXss } from "./xss-canary";
import { generateSanitizerProbe, classifySanitizerProbe } from "./sanitizer-probe";

/** Reads back the decoded field value from a JSON response body — comparing
 * against undecoded JSON text would never match the canary's literal
 * markup, since JSON escapes embedded quotes. Falls back to the raw body
 * itself if it isn't parseable JSON or the field is absent. */
function extractFieldValue(responseBody: string, fieldPath: string): string {
  try {
    const parsed = JSON.parse(responseBody) as Record<string, unknown>;
    const value = parsed[fieldPath];
    return typeof value === "string" ? value : responseBody;
  } catch {
    return responseBody;
  }
}

/**
 * The Stored XSS scanner's base safe-canary test: inserts a non-executing
 * `<strong data-security-test="UUID">SECURITY_TEST_UUID</strong>` marker
 * through the shared backup→mutate→verify→restore service
 * (`runMutationTestCycle`), classifies what the target actually stored
 * from the mutating write's own response (no extra round-trip needed),
 * and always restores the original value afterward. No JavaScript is ever
 * executed by this scanner.
 */
export class XssScanner extends BaseSecurityScanner {
  readonly name = "XSS";

  detect(context: ScanContext): Candidate[] {
    return listCandidatesForScanRun(context.db, context.scanRunId)
      .filter((row) => row.scanner === this.name)
      .map((row) => ({
        id: row.id,
        scanner: row.scanner,
        // The candidates repository doesn't persist a ResourceKey/URL directly (Section 14 owns joining
        // candidates back to their originating discovered_operations/discovered_endpoints); a full
        // orchestrator wires those in before calling test(). detect() here surfaces what's already known.
        resourceKey: { targetId: 0, origin: "", objectType: "", resourceId: "" },
        resourceUrl: "",
        ...(row.fieldPath !== undefined ? { fieldPath: row.fieldPath } : {}),
        eligibilityState: row.eligibilityState,
        browserTestability: row.browserTestability,
      }));
  }

  verify(_context: ScanContext, _candidate: Candidate, result: ScannerResult): ScannerResult {
    // Restore has already completed and been verified inside test()'s
    // shared-service call by the time verify() is reached; classification
    // was already derived directly from the target's own response. Active/
    // frontend runtime confirmation is Section 11.4/12's job.
    return result;
  }

  protected async runMutation(context: ScanContext, candidate: Candidate): Promise<ScannerResult> {
    if (!candidate.fieldPath) {
      throw new Error(`XSS candidate ${candidate.id} has no fieldPath to mutate`);
    }
    const canary = generateXssCanary();
    const cycleResult = await this.runCycle(context, candidate, candidate.fieldPath, canary.payload);
    const storedValue = extractFieldValue(cycleResult.postMutationBody, candidate.fieldPath);
    const verdict = classifyStoredXss(storedValue, canary.uuid);
    const evidenceId = this.recordVerdict(context, candidate, canary.payload, cycleResult, verdict);
    return { candidateId: candidate.id, verdict, evidenceIds: [evidenceId] };
  }

  /**
   * The Sanitizer Probe (Section 11.3): a distinct safe-canary variant from
   * the base canary above, purpose-built to reach UNSAFE_ATTRIBUTE_SURVIVED
   * / POTENTIALLY_EXECUTABLE — states the base canary structurally cannot
   * produce. Goes through the identical write-eligibility guard and shared
   * backup→mutate→verify→restore service as `test()`.
   */
  async testSanitizerProbe(context: ScanContext, candidate: Candidate): Promise<ScannerResult> {
    if (!candidate.fieldPath) {
      throw new Error(`XSS candidate ${candidate.id} has no fieldPath to mutate`);
    }
    if (!candidate.writeMethod) {
      throw new Error(`Candidate ${candidate.id} has no writeMethod — testSanitizerProbe() is only for mutating candidates`);
    }
    assertWriteEligible(context.operations, candidate.writeMethod, candidate.resourceUrl, context.minConfidence);

    const probe = generateSanitizerProbe();
    const cycleResult = await this.runCycle(context, candidate, candidate.fieldPath, probe.payload);
    const storedValue = extractFieldValue(cycleResult.postMutationBody, candidate.fieldPath);
    const verdict = classifySanitizerProbe(storedValue, probe.uuid);
    const evidenceId = this.recordVerdict(context, candidate, probe.payload, cycleResult, verdict);
    return { candidateId: candidate.id, verdict, evidenceIds: [evidenceId] };
  }

  private runCycle(
    context: ScanContext,
    candidate: Candidate,
    fieldPath: string,
    testValue: string,
  ): Promise<MutationCycleResult> {
    return runMutationTestCycle({
      db: context.db,
      scanRunId: context.scanRunId,
      requester: withAuthHeaders(context.httpClient, context.authHeaders),
      resourceKey: candidate.resourceKey,
      resourceUrl: candidate.resourceUrl,
      fieldPath,
      testValue,
      initiator: "API",
      holder: `API:${this.name}_SCANNER`,
      operations: context.operations,
      minConfidence: context.minConfidence,
      ...(candidate.writeMethod !== undefined ? { writeMethod: candidate.writeMethod } : {}),
    });
  }

  private recordVerdict(
    context: ScanContext,
    candidate: Candidate,
    testValue: string,
    cycleResult: MutationCycleResult,
    verdict: string,
  ): number {
    const fieldPath = candidate.fieldPath!;
    return recordEvidence(context.db, context.scanRunId, {
      candidateId: candidate.id,
      endpoint: candidate.resourceUrl,
      fieldPath,
      request: { method: candidate.writeMethod ?? "PATCH", url: candidate.resourceUrl, headers: {}, body: JSON.stringify({ [fieldPath]: testValue }) },
      response: { status: 200, headers: {}, body: cycleResult.postMutationBody },
      originalValue: null,
      testValue,
      verificationOutcome: verdict,
      restoreStatus: cycleResult.outcome,
    });
  }
}
