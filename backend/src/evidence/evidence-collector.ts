import type { Db } from "../db/connection";
import { sanitizeEvidence } from "./sanitize-evidence";
import { truncateIfOversized } from "./truncate-body";
import { loadEvidenceSettings, type EvidenceSettings } from "./evidence-settings";
import { saveEvidence } from "./evidence-repository";

export interface RecordEvidenceInput {
  candidateId?: number;
  authProfileId?: number;
  endpoint: string;
  fieldPath: string;
  request: { method: string; url: string; headers: Record<string, string>; body?: string };
  response: { status: number; headers: Record<string, string | string[] | undefined>; body: string };
  originalValue: unknown;
  testValue: unknown;
  verificationOutcome: string;
  restoreStatus?: string;
}

/**
 * Records a complete evidence record for one executed test — request,
 * response, endpoint, identity, timestamp (via the table's own
 * `created_at`), field, original value, test value, verification outcome,
 * and restore status — always through the central Evidence Sanitization
 * layer (Section 9.10) first. A scanner never needs its own masking or PII
 * redaction logic: whatever it hands this function is what gets sanitized
 * before persistence.
 *
 * The (post-sanitization) response body is then checked against
 * `maxEvidenceBodyBytes` (Section 9.14, independent of `safe-http-client`'s
 * transport-level response-size limits): within the limit, it's stored in
 * full; over it, only a sanitized prefix is stored, alongside the original
 * size and a content hash of the full sanitized body, with `truncated: true`.
 */
export function recordEvidence(
  db: Db,
  scanRunId: number,
  input: RecordEvidenceInput,
  settings: EvidenceSettings = loadEvidenceSettings(),
): number {
  const requestSanitized = sanitizeEvidence(input.request);
  const responseSanitized = sanitizeEvidence(input.response);

  const bodyResult = truncateIfOversized(responseSanitized.body, settings.maxEvidenceBodyBytes);
  responseSanitized.body = bodyResult.value;

  return saveEvidence(db, scanRunId, {
    ...(input.candidateId !== undefined ? { candidateId: input.candidateId } : {}),
    ...(input.authProfileId !== undefined ? { authProfileId: input.authProfileId } : {}),
    endpoint: input.endpoint,
    fieldPath: input.fieldPath,
    requestSanitized,
    responseSanitized,
    originalValueSanitized: sanitizeEvidence({ [input.fieldPath]: input.originalValue })[input.fieldPath],
    testValueSanitized: sanitizeEvidence({ [input.fieldPath]: input.testValue })[input.fieldPath],
    verificationOutcome: input.verificationOutcome,
    ...(input.restoreStatus !== undefined ? { restoreStatus: input.restoreStatus } : {}),
    truncated: bodyResult.truncated,
    ...(bodyResult.originalSize !== undefined ? { originalSize: bodyResult.originalSize } : {}),
    ...(bodyResult.contentHash !== undefined ? { contentHash: bodyResult.contentHash } : {}),
  });
}
