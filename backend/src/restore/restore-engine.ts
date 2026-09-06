import { hashContent } from "../backup/backup-engine";
import { matchesExpectedState, type MutationExpectedState } from "../mutation/request-mutator";
import { detectConcurrencySignal, concurrencySignalsEqual, type ConcurrencySignal } from "./concurrency-signal";

export type RestoreOutcome = "RESTORE_OK" | "RESTORE_FAILED" | "RESTORE_CONFLICT";

export interface RestoreRequester {
  request(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>;
}

export interface RestoreParams {
  requester: RestoreRequester;
  resourceUrl: string;
  /** The flat request-body key the target's write endpoint expects for this field. */
  fieldPath: string;
  originalValue: unknown;
  originalContentHash: string;
  expectedPostMutationState: MutationExpectedState;
  /** The concurrency signal observed immediately after the mutating write
   * completed — omit entirely when the target exposes none at all. */
  concurrencySignalAfterMutation?: ConcurrencySignal;
  writeMethod?: string;
}

export interface RestoreResult {
  outcome: RestoreOutcome;
}

/**
 * Optimistic-concurrency-aware restore: verifies the resource is still in
 * the state the mutation left it in — via an ETag/version/updatedAt signal
 * when the target exposes one, or by comparing against the mutation's own
 * tracked expected post-mutation state when it doesn't — before writing
 * anything back. It never performs a full-snapshot overwrite, and it never
 * restores at all without first proving nothing else changed the resource
 * in the meantime.
 */
export async function restoreResource(params: RestoreParams): Promise<RestoreResult> {
  const method = params.writeMethod ?? "PATCH";
  const currentResponse = await params.requester.request(params.resourceUrl);

  if (params.concurrencySignalAfterMutation) {
    const currentSignal = detectConcurrencySignal(currentResponse);
    if (!currentSignal || !concurrencySignalsEqual(params.concurrencySignalAfterMutation, currentSignal)) {
      return { outcome: "RESTORE_CONFLICT" };
    }
  } else {
    // No concurrency signal available at all — fall back to comparing
    // against the scanner's own tracked expected post-mutation state
    // (Section 9.3). Never overwrite without a verifiable signal of some kind.
    let currentBody: unknown;
    try {
      currentBody = JSON.parse(currentResponse.body);
    } catch {
      return { outcome: "RESTORE_CONFLICT" };
    }
    if (!matchesExpectedState(currentBody, params.expectedPostMutationState)) {
      return { outcome: "RESTORE_CONFLICT" };
    }
  }

  const restoreHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (params.concurrencySignalAfterMutation?.type === "etag") {
    restoreHeaders["If-Match"] = params.concurrencySignalAfterMutation.value;
  }

  const restoreResponse = await params.requester.request(params.resourceUrl, {
    method,
    headers: restoreHeaders,
    body: JSON.stringify({ [params.fieldPath]: params.originalValue }),
  });
  if (restoreResponse.status === 412) {
    // The precondition failed at the moment of the actual write — a race
    // between our check above and this write — still a conflict, not a failure.
    return { outcome: "RESTORE_CONFLICT" };
  }

  const verifyResponse = await params.requester.request(params.resourceUrl);
  const verifyHash = hashContent(verifyResponse.body);
  return { outcome: verifyHash === params.originalContentHash ? "RESTORE_OK" : "RESTORE_FAILED" };
}
