import type { Db } from "../db/connection";
import type { ResourceKey } from "../mutation/resource-key";
import type { JournalEntry, JournalState } from "../mutation/mutation-journal";
import { recordJournalState } from "../mutation/mutation-journal-repository";
import { recordAuditEvent } from "../mutation/audit-events-repository";
import { getLatestResourceBackup } from "../backup/resource-backups-repository";
import { hashContent } from "../backup/backup-engine";
import type { RestoreRequester } from "./restore-engine";

const INTERRUPTED_STATES: readonly JournalState[] = ["MUTATION_APPLIED", "RESTORE_PENDING"];

interface JournalRow {
  id: number;
  target_id: number;
  origin: string;
  tenant_id: string | null;
  object_type: string;
  resource_id: string;
  initiator: JournalEntry["initiator"];
  field_path: string | null;
  state: JournalState;
  requires_manual_intervention: number;
}

function rowToEntry(row: JournalRow): JournalEntry {
  const resourceKey: ResourceKey = {
    targetId: row.target_id,
    origin: row.origin,
    objectType: row.object_type,
    resourceId: row.resource_id,
  };
  if (row.tenant_id !== null) resourceKey.tenantId = row.tenant_id;
  const entry: JournalEntry = {
    id: row.id,
    resourceKey,
    initiator: row.initiator,
    state: row.state,
    requiresManualIntervention: row.requires_manual_intervention === 1,
  };
  if (row.field_path !== null) entry.fieldPath = row.field_path;
  return entry;
}

/**
 * Finds every resource whose *most recent* journal entry left it in
 * MUTATION_APPLIED or RESTORE_PENDING — an interrupted mutation from a
 * prior process instance. Resources whose latest entry has since moved on
 * to a terminal state are not included.
 */
export function findInterruptedResources(db: Db): JournalEntry[] {
  const placeholders = INTERRUPTED_STATES.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT mj.* FROM mutation_journal mj
       WHERE mj.id = (
         SELECT mj2.id FROM mutation_journal mj2
         WHERE mj2.target_id = mj.target_id AND mj2.origin = mj.origin AND mj2.tenant_id IS mj.tenant_id
           AND mj2.object_type = mj.object_type AND mj2.resource_id = mj.resource_id
         ORDER BY mj2.id DESC LIMIT 1
       )
       AND mj.state IN (${placeholders})`,
    )
    .all(...INTERRUPTED_STATES) as unknown as JournalRow[];
  return rows.map(rowToEntry);
}

export type RecoveryOutcome = "RECOVERED" | "REQUIRES_MANUAL_INTERVENTION";

export interface RecoveryResult {
  resourceKey: ResourceKey;
  outcome: RecoveryOutcome;
}

/**
 * Attempts safe recovery of one interrupted resource. The in-memory
 * context a normal restore relies on (the expected post-mutation
 * fingerprint) was lost with the crashed process, so this only ever
 * declares success when the resource's current content already hashes
 * back to the pre-mutation backup — anything else cannot be verified
 * safely, and is flagged for manual intervention rather than guessed at
 * with a forced overwrite.
 */
export async function recoverInterruptedResource(
  db: Db,
  scanRunId: number,
  entry: JournalEntry,
  resourceUrl: string,
  requester: RestoreRequester,
): Promise<RecoveryResult> {
  const backup = getLatestResourceBackup(db, entry.resourceKey);
  if (!backup) {
    recordJournalState(db, scanRunId, entry.resourceKey, entry.initiator, "RESTORE_CONFLICT", {
      requiresManualIntervention: true,
    });
    recordAuditEvent(db, scanRunId, "RECOVERY_NO_BACKUP_FOUND", { resourceKey: entry.resourceKey });
    return { resourceKey: entry.resourceKey, outcome: "REQUIRES_MANUAL_INTERVENTION" };
  }

  const current = await requester.request(resourceUrl);
  const currentHash = hashContent(current.body);

  if (currentHash === backup.contentHash) {
    recordJournalState(db, scanRunId, entry.resourceKey, entry.initiator, "RESTORE_OK");
    recordAuditEvent(db, scanRunId, "RECOVERY_COMPLETED", { resourceKey: entry.resourceKey });
    return { resourceKey: entry.resourceKey, outcome: "RECOVERED" };
  }

  recordJournalState(db, scanRunId, entry.resourceKey, entry.initiator, "RESTORE_CONFLICT", {
    requiresManualIntervention: true,
  });
  recordAuditEvent(db, scanRunId, "RECOVERY_REQUIRES_MANUAL_INTERVENTION", { resourceKey: entry.resourceKey });
  return { resourceKey: entry.resourceKey, outcome: "REQUIRES_MANUAL_INTERVENTION" };
}

/**
 * The startup Recovery Manager: finds every resource left in an
 * interrupted state by a prior process instance and attempts safe
 * recovery for each. `resolveResourceUrl` is how the caller maps a
 * ResourceKey back to a fetchable URL (a future full orchestration layer
 * resolves this via discovered operations; tests and callers may supply
 * it directly).
 */
export async function runRecoveryManager(
  db: Db,
  scanRunId: number,
  resolveResourceUrl: (resourceKey: ResourceKey) => string,
  requester: RestoreRequester,
): Promise<RecoveryResult[]> {
  const interrupted = findInterruptedResources(db);
  const results: RecoveryResult[] = [];
  for (const entry of interrupted) {
    const url = resolveResourceUrl(entry.resourceKey);
    results.push(await recoverInterruptedResource(db, scanRunId, entry, url, requester));
  }
  return results;
}
