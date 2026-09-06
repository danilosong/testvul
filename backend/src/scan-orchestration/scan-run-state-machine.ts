import type { Db } from "../db/connection";
import { markRestoreIncident } from "../mutation/restore-incident";

export { markRestoreIncident };

/**
 * The Scan Run State Machine (Section 14.6, design.md Decision 16). The
 * precedence order below is the single place the ambiguity between "a
 * resolved incident" and "a clean run" is resolved — a resolved incident
 * never silently falls back into plain COMPLETED, and its history stays
 * queryable in `audit_events`/`mutation_journal` forever (nothing here
 * ever deletes or overwrites a past journal/audit row).
 */
export type ScanRunFinalState = "RESTORE_REQUIRED" | "COMPLETED_WITH_RECOVERY" | "CANCELLED" | "FAILED" | "PARTIAL" | "COMPLETED";

export interface ScanRunFinalizationInputs {
  /** Some resource's *current* (latest) journal state is RESTORE_FAILED/RESTORE_CONFLICT — an incident that is not yet resolved. */
  hasUnresolvedRestoreIncident: boolean;
  /** `scan_runs.had_restore_incident` — set once, by `markRestoreIncident`, and never cleared even after the resource recovers. */
  hadRestoreIncident: boolean;
  cancellationRequestedAndCleanlyCompleted: boolean;
  unrecoverableErrorOccurred: boolean;
  anyQueueTruncated: boolean;
}

export function computeScanRunState(inputs: ScanRunFinalizationInputs): ScanRunFinalState {
  if (inputs.hasUnresolvedRestoreIncident) return "RESTORE_REQUIRED";
  if (inputs.hadRestoreIncident) return "COMPLETED_WITH_RECOVERY";
  if (inputs.cancellationRequestedAndCleanlyCompleted) return "CANCELLED";
  if (inputs.unrecoverableErrorOccurred) return "FAILED";
  if (inputs.anyQueueTruncated) return "PARTIAL";
  return "COMPLETED";
}

const UNRESOLVED_RESTORE_STATES = ["RESTORE_FAILED", "RESTORE_CONFLICT"];

/** True when any resource's *most recent* `mutation_journal` entry for this scan run is still RESTORE_FAILED/RESTORE_CONFLICT — mirrors `recovery-manager.ts`'s own "latest entry per resource" query. */
export function hasUnresolvedRestoreIncident(db: Db, scanRunId: number): boolean {
  const placeholders = UNRESOLVED_RESTORE_STATES.map(() => "?").join(", ");
  const row = db
    .prepare(
      `SELECT COUNT(*) as c FROM mutation_journal mj
       WHERE mj.scan_run_id = ?
         AND mj.id = (
           SELECT mj2.id FROM mutation_journal mj2
           WHERE mj2.target_id = mj.target_id AND mj2.origin = mj.origin AND mj2.tenant_id IS mj.tenant_id
             AND mj2.object_type = mj.object_type AND mj2.resource_id = mj.resource_id
           ORDER BY mj2.id DESC LIMIT 1
         )
         AND mj.state IN (${placeholders})`,
    )
    .get(scanRunId, ...UNRESOLVED_RESTORE_STATES) as { c: number };
  return row.c > 0;
}

function readHadRestoreIncident(db: Db, scanRunId: number): boolean {
  const row = db.prepare("SELECT had_restore_incident as v FROM scan_runs WHERE id = ?").get(scanRunId) as { v: number } | undefined;
  if (!row) throw new Error(`No scan run found with id ${scanRunId}`);
  return row.v === 1;
}

export interface FinalizeScanRunInputs {
  cancellationRequestedAndCleanlyCompleted: boolean;
  unrecoverableErrorOccurred: boolean;
  anyQueueTruncated: boolean;
}

/** Computes and persists the final `scan_runs.state`, reading `hadRestoreIncident`/`hasUnresolvedRestoreIncident` from the database itself rather than trusting a caller-supplied guess. */
export function finalizeScanRun(db: Db, scanRunId: number, inputs: FinalizeScanRunInputs): ScanRunFinalState {
  const state = computeScanRunState({
    hasUnresolvedRestoreIncident: hasUnresolvedRestoreIncident(db, scanRunId),
    hadRestoreIncident: readHadRestoreIncident(db, scanRunId),
    ...inputs,
  });
  db.prepare("UPDATE scan_runs SET state = ?, finished_at = datetime('now') WHERE id = ?").run(state, scanRunId);
  return state;
}
