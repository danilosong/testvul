import type { BoundedQueue } from "./bounded-queue";
import type { HostCandidate } from "../discovery/host-candidate-discovery";

export interface RouteHostCandidatesResult {
  queued: string[];
  recordedOutOfScope: string[];
  /** True when an in-scope candidate couldn't be queued because the Target Queue's own bound (Section 14.1) was already reached — it was still recorded, never silently dropped. */
  targetQueueTruncated: boolean;
}

/**
 * Newly-discovered-host handling (Section 14.4), wired into the Target
 * Queue: an in-scope candidate is enqueued for its own discovery/testing;
 * an out-of-scope one is only ever recorded, never queued. Works
 * identically whether the candidates came from static crawling or from
 * Section 12's real browser navigation — `consolidateHostCandidates`
 * already normalizes both into the same `HostCandidate` shape before this
 * function ever sees them.
 */
export function routeHostCandidates(targetQueue: BoundedQueue<string>, candidates: readonly HostCandidate[]): RouteHostCandidatesResult {
  const queued: string[] = [];
  const recordedOutOfScope: string[] = [];

  for (const candidate of candidates) {
    if (!candidate.inScope) {
      recordedOutOfScope.push(candidate.hostname);
      continue;
    }
    const { accepted } = targetQueue.enqueue(candidate.hostname);
    if (accepted) queued.push(candidate.hostname);
  }

  return { queued, recordedOutOfScope, targetQueueTruncated: targetQueue.isTruncated() };
}
