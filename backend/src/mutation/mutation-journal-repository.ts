import type { Db } from "../db/connection";
import type { ResourceKey } from "./resource-key";
import { FROZEN_STATES, type JournalEntry, type JournalInitiator, type JournalState } from "./mutation-journal";

export function recordJournalState(
  db: Db,
  scanRunId: number,
  resourceKey: ResourceKey,
  initiator: JournalInitiator,
  state: JournalState,
  options: { fieldPath?: string; requiresManualIntervention?: boolean } = {},
): number {
  const result = db
    .prepare(
      `INSERT INTO mutation_journal
        (scan_run_id, target_id, origin, tenant_id, object_type, resource_id, initiator, field_path, state, requires_manual_intervention)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      scanRunId,
      resourceKey.targetId,
      resourceKey.origin,
      resourceKey.tenantId ?? null,
      resourceKey.objectType,
      resourceKey.resourceId,
      initiator,
      options.fieldPath ?? null,
      state,
      options.requiresManualIntervention ? 1 : 0,
    );
  return Number(result.lastInsertRowid);
}

interface JournalRow {
  id: number;
  target_id: number;
  origin: string;
  tenant_id: string | null;
  object_type: string;
  resource_id: string;
  initiator: JournalInitiator;
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

/** The most recent journal entry for a resource — `null` if it has never had one. */
export function getLatestJournalEntry(db: Db, resourceKey: ResourceKey): JournalEntry | null {
  const row = db
    .prepare(
      `SELECT * FROM mutation_journal
       WHERE target_id = ? AND origin = ? AND tenant_id IS ? AND object_type = ? AND resource_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(resourceKey.targetId, resourceKey.origin, resourceKey.tenantId ?? null, resourceKey.objectType, resourceKey.resourceId) as
    | unknown as JournalRow
    | undefined;
  return row ? rowToEntry(row) : null;
}

export function isResourceFrozen(db: Db, resourceKey: ResourceKey): boolean {
  const latest = getLatestJournalEntry(db, resourceKey);
  return latest !== null && FROZEN_STATES.has(latest.state);
}
