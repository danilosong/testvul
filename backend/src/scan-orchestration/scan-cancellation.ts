import type { Db } from "../db/connection";
import { finalizeScanRun, type ScanRunFinalState } from "./scan-run-state-machine";

/**
 * Safe Scan Cancellation (Section 14.7, design.md Decision 17):
 * cancellation only ever sets a flag the orchestrator checks before
 * starting each *new* test — it never touches an already-running mutation
 * cycle. A resource already in MUTATION_APPLIED/RESTORE_PENDING always
 * gets to complete its own backup→mutate→verify→restore cycle (Section
 * 9) and release its lock before the scan finalizes. Whether that
 * finalization lands on CANCELLED or RESTORE_REQUIRED is decided by
 * Section 14.6's own state-machine precedence — RESTORE_REQUIRED always
 * wins when an in-flight restore didn't complete cleanly.
 */
export function requestScanCancellation(db: Db, scanRunId: number, requestedBy: string): void {
  db.prepare("UPDATE scan_runs SET cancellation_requested_at = datetime('now'), cancellation_requested_by = ? WHERE id = ?").run(requestedBy, scanRunId);
}

export function isCancellationRequested(db: Db, scanRunId: number): boolean {
  const row = db.prepare("SELECT cancellation_requested_at as v FROM scan_runs WHERE id = ?").get(scanRunId) as { v: string | null } | undefined;
  if (!row) throw new Error(`No scan run found with id ${scanRunId}`);
  return row.v !== null;
}

export interface SecurityTestQueueCancellationResult {
  /** Tests actually dispatched — every one of these is always fully awaited to completion, cancellation or not. */
  startedCount: number;
  /** Tests never even started because cancellation was already requested by the time the queue reached them. */
  skippedDueToCancellation: number;
}

export interface RunSecurityTestQueueWithCancellationParams {
  db: Db;
  scanRunId: number;
  /** Each function performs one test's full mutation cycle (backup→mutate→verify→restore) when invoked. */
  tests: readonly (() => Promise<unknown>)[];
}

/**
 * Dispatches each test in order, checking cancellation immediately before
 * every dispatch — once cancellation is seen, no further test is ever
 * started. Every test already dispatched (in flight, possibly
 * concurrently with others) is always awaited to completion before this
 * function returns: cancellation never aborts, races, or interferes with
 * an already-running mutation cycle.
 */
export async function runSecurityTestQueueWithCancellation(params: RunSecurityTestQueueWithCancellationParams): Promise<SecurityTestQueueCancellationResult> {
  const inFlight: Promise<unknown>[] = [];
  let startedCount = 0;
  let skippedDueToCancellation = 0;
  let first = true;

  for (const test of params.tests) {
    // A real yield to the event loop between dispatches (never a tight
    // synchronous loop) — the same point a rate limiter would throttle at
    // in real use, and what makes cancellation requested concurrently
    // from elsewhere actually able to be seen before the next dispatch.
    if (!first) await new Promise<void>((resolve) => setImmediate(resolve));
    first = false;

    if (isCancellationRequested(params.db, params.scanRunId)) {
      skippedDueToCancellation++;
      continue;
    }
    startedCount++;
    inFlight.push(test());
  }

  await Promise.all(inFlight);

  return { startedCount, skippedDueToCancellation };
}

export interface FinalizeCancellableScanInputs {
  unrecoverableErrorOccurred: boolean;
  anyQueueTruncated: boolean;
}

/**
 * Runs the Security Test queue with cancellation support, waits for every
 * in-flight test to finish, and only then finalizes the scan run —
 * reporting CANCELLED once cancellation was requested and every restore
 * completed cleanly, or RESTORE_REQUIRED (Section 14.6's own precedence,
 * unconditionally) when one did not.
 */
export async function runCancellableSecurityTestsAndFinalize(
  db: Db,
  scanRunId: number,
  tests: readonly (() => Promise<unknown>)[],
  inputs: FinalizeCancellableScanInputs,
): Promise<{ queueResult: SecurityTestQueueCancellationResult; finalState: ScanRunFinalState }> {
  const queueResult = await runSecurityTestQueueWithCancellation({ db, scanRunId, tests });
  const finalState = finalizeScanRun(db, scanRunId, {
    cancellationRequestedAndCleanlyCompleted: isCancellationRequested(db, scanRunId),
    ...inputs,
  });
  return { queueResult, finalState };
}
