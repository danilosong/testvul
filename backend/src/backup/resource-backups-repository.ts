import type { Db } from "../db/connection";
import type { ResourceKey } from "../mutation/resource-key";
import type { ResourceSnapshot } from "./resource-backup";

export function saveResourceBackup(db: Db, scanRunId: number, snapshot: ResourceSnapshot): number {
  const { resourceKey } = snapshot;
  const result = db
    .prepare(
      `INSERT INTO resource_backups (scan_run_id, target_id, origin, tenant_id, object_type, resource_id, content, content_hash, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      scanRunId,
      resourceKey.targetId,
      resourceKey.origin,
      resourceKey.tenantId ?? null,
      resourceKey.objectType,
      resourceKey.resourceId,
      snapshot.content,
      snapshot.contentHash,
      snapshot.capturedAt,
    );
  return Number(result.lastInsertRowid);
}

interface ResourceBackupRow {
  target_id: number;
  origin: string;
  tenant_id: string | null;
  object_type: string;
  resource_id: string;
  content: string;
  content_hash: string;
  captured_at: string;
}

function rowToSnapshot(row: ResourceBackupRow): ResourceSnapshot {
  const resourceKey: ResourceKey = {
    targetId: row.target_id,
    origin: row.origin,
    objectType: row.object_type,
    resourceId: row.resource_id,
  };
  if (row.tenant_id !== null) resourceKey.tenantId = row.tenant_id;
  return { resourceKey, content: row.content, contentHash: row.content_hash, capturedAt: row.captured_at };
}

/** The most recent snapshot for a resource — what Restore (Section 9.4) compares against. */
export function getLatestResourceBackup(db: Db, resourceKey: ResourceKey): ResourceSnapshot | null {
  const row = db
    .prepare(
      `SELECT * FROM resource_backups
       WHERE target_id = ? AND origin = ? AND tenant_id IS ? AND object_type = ? AND resource_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(resourceKey.targetId, resourceKey.origin, resourceKey.tenantId ?? null, resourceKey.objectType, resourceKey.resourceId) as
    | unknown as ResourceBackupRow
    | undefined;
  return row ? rowToSnapshot(row) : null;
}
