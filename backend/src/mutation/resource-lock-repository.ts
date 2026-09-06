import type { Db } from "../db/connection";
import type { ResourceKey } from "./resource-key";
import { LOCK_BLOCKING_JOURNAL_STATES, type ResourceLock } from "./resource-lock";
import { getLatestJournalEntry } from "./mutation-journal-repository";

interface ResourceLockRow {
  id: number;
  holder: string;
  acquired_at: string;
  lease_expires_at: string;
}

function getExistingLockRow(db: Db, resourceKey: ResourceKey): ResourceLockRow | undefined {
  return db
    .prepare(
      "SELECT id, holder, acquired_at, lease_expires_at FROM resource_locks WHERE target_id = ? AND origin = ? AND tenant_id IS ? AND object_type = ? AND resource_id = ?",
    )
    .get(resourceKey.targetId, resourceKey.origin, resourceKey.tenantId ?? null, resourceKey.objectType, resourceKey.resourceId) as
    | ResourceLockRow
    | undefined;
}

/**
 * A non-mutating peek at whether the exclusive lock/lease on a resource
 * could currently be acquired — used by the Reversibility-Proven check
 * (Section 9.11), which must assess feasibility without itself acquiring
 * anything (acquisition happens later, in the actual mutation cycle).
 */
export function isLockAvailable(db: Db, resourceKey: ResourceKey): boolean {
  const latestJournalEntry = getLatestJournalEntry(db, resourceKey);
  if (latestJournalEntry && LOCK_BLOCKING_JOURNAL_STATES.has(latestJournalEntry.state)) {
    return false;
  }
  const existing = getExistingLockRow(db, resourceKey);
  if (!existing) return true;
  return new Date(existing.lease_expires_at) <= new Date();
}

/**
 * Attempts to acquire the exclusive lock/lease on a resource. Returns the
 * granted lock, or `null` if it's currently held by someone else (an
 * unexpired lease) or the resource's mutation-journal state is unresolved
 * — in the latter case, an expired lease does not matter: only the
 * Recovery Manager or a manual intervention can clear that condition.
 */
export function tryAcquireLock(db: Db, resourceKey: ResourceKey, holder: string, leaseMs: number): ResourceLock | null {
  const latestJournalEntry = getLatestJournalEntry(db, resourceKey);
  if (latestJournalEntry && LOCK_BLOCKING_JOURNAL_STATES.has(latestJournalEntry.state)) {
    return null;
  }

  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
  const existing = getExistingLockRow(db, resourceKey);

  if (existing) {
    if (new Date(existing.lease_expires_at) > now) {
      return null; // still held by someone else
    }
    db.prepare("UPDATE resource_locks SET holder = ?, acquired_at = ?, lease_expires_at = ? WHERE id = ?").run(
      holder,
      now.toISOString(),
      leaseExpiresAt,
      existing.id,
    );
    return { id: existing.id, resourceKey, holder, acquiredAt: now.toISOString(), leaseExpiresAt };
  }

  const result = db
    .prepare(
      `INSERT INTO resource_locks (target_id, origin, tenant_id, object_type, resource_id, holder, acquired_at, lease_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      resourceKey.targetId,
      resourceKey.origin,
      resourceKey.tenantId ?? null,
      resourceKey.objectType,
      resourceKey.resourceId,
      holder,
      now.toISOString(),
      leaseExpiresAt,
    );
  return { id: Number(result.lastInsertRowid), resourceKey, holder, acquiredAt: now.toISOString(), leaseExpiresAt };
}

export function releaseLock(db: Db, lockId: number): void {
  db.prepare("DELETE FROM resource_locks WHERE id = ?").run(lockId);
}
