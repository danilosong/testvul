import type { Db } from "../db/connection";

/**
 * Marks that a scan run had a restore incident at some point — called
 * once, by `runMutationTestCycle` itself, the moment it observes a
 * non-RESTORE_OK terminal outcome. Never cleared, even once every
 * affected resource later recovers (Section 14.6's Scan Run State
 * Machine, design.md Decision 16, depends on that irreversibility to
 * derive COMPLETED_WITH_RECOVERY rather than plain COMPLETED).
 */
export function markRestoreIncident(db: Db, scanRunId: number): void {
  db.prepare("UPDATE scan_runs SET had_restore_incident = 1 WHERE id = ?").run(scanRunId);
}
