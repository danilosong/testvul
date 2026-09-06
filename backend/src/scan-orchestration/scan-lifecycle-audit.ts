import type { Db } from "../db/connection";
import { recordAuditEvent } from "../mutation/audit-events-repository";
import { runPipeline, type PipelineStageProgress, type PipelineRunResult, type RunPipelineParams } from "./pipeline-sequencer";

/**
 * The scan lifecycle audit-trail event log (Section 14.5): SCAN_STARTED,
 * one STAGE_<name>_<status> event per pipeline-stage transition (Section
 * 14.2's own progress events, mapped 1:1), and SCAN_FINISHED — all
 * persisted through the same `recordAuditEvent`/`audit_events` shared by
 * Section 9.9's recovery-manager events, Section 14.7's cancellation
 * events, Section 12's browser-engine events, and Section 16.6's
 * mutation-authorization confirmation event. None of those needed to
 * wait on this task: `recordAuditEvent` already existed and was already
 * in independent use before this module was written.
 */
export const SCAN_STARTED_EVENT = "SCAN_STARTED";
export const SCAN_FINISHED_EVENT = "SCAN_FINISHED";

export function recordScanStarted(db: Db, scanRunId: number): void {
  recordAuditEvent(db, scanRunId, SCAN_STARTED_EVENT, {});
}

export function recordScanFinished(db: Db, scanRunId: number, outcome: string): void {
  recordAuditEvent(db, scanRunId, SCAN_FINISHED_EVENT, { outcome });
}

export function stageProgressEventType(progress: Pick<PipelineStageProgress, "stage" | "status">): string {
  return `STAGE_${progress.stage}_${progress.status}`;
}

export function recordStageProgressEvent(db: Db, scanRunId: number, progress: PipelineStageProgress): void {
  recordAuditEvent(db, scanRunId, stageProgressEventType(progress), { stage: progress.stage, status: progress.status });
}

/** An `onProgress` handler `runPipeline` can be given directly — every stage transition becomes its own audit event, in the same strict order Section 14.2 already guarantees. */
export function attachAuditTrail(db: Db, scanRunId: number): (progress: PipelineStageProgress) => void {
  return (progress) => recordStageProgressEvent(db, scanRunId, progress);
}

/**
 * Runs the fixed pipeline (Section 14.2) with its full lifecycle bracketed
 * by SCAN_STARTED/SCAN_FINISHED audit events, and every stage transition
 * recorded in between — the one place a caller needs to reach for the
 * complete, correctly-ordered event sequence a full scan run produces.
 */
export async function runPipelineWithAuditTrail(db: Db, scanRunId: number, params: Omit<RunPipelineParams, "onProgress">): Promise<PipelineRunResult> {
  recordScanStarted(db, scanRunId);
  try {
    const result = await runPipeline({ ...params, onProgress: attachAuditTrail(db, scanRunId) });
    recordScanFinished(db, scanRunId, "COMPLETED");
    return result;
  } catch (err) {
    recordScanFinished(db, scanRunId, "FAILED");
    throw err;
  }
}
