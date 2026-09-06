import type { Db } from "../db/connection";
import type { ResourceKey } from "../mutation/resource-key";
import type { ResourceOwnership, ResourceOwnershipInput } from "./resource-ownership";

interface ResourceOwnershipRow {
  id: number;
  target_id: number;
  origin: string;
  tenant_id: string | null;
  object_type: string;
  resource_id: string;
  owner_auth_profile_id: number;
}

function rowToOwnership(row: ResourceOwnershipRow): ResourceOwnership {
  const resourceKey: ResourceKey = {
    targetId: row.target_id,
    origin: row.origin,
    objectType: row.object_type,
    resourceId: row.resource_id,
  };
  if (row.tenant_id !== null) resourceKey.tenantId = row.tenant_id;
  return { id: row.id, resourceKey, ownerAuthProfileId: row.owner_auth_profile_id };
}

/**
 * Declares (or, if the same canonical ResourceKey was already declared,
 * replaces) who owns a resource. This is the only step required — the
 * mapping is immediately available to any subsequent query, feeding the
 * Automated Authorization Matrix with no further build/publish step.
 */
export function declareResourceOwnership(db: Db, input: ResourceOwnershipInput): number {
  const { resourceKey } = input;
  // Not an `ON CONFLICT` upsert: SQLite's UNIQUE constraint treats every
  // NULL `tenant_id` as distinct from every other, so it would never catch
  // the common no-tenant case. An explicit `IS` comparison handles NULL
  // correctly instead.
  const existing = db
    .prepare(
      "SELECT id FROM resource_ownership WHERE target_id = ? AND origin = ? AND tenant_id IS ? AND object_type = ? AND resource_id = ?",
    )
    .get(resourceKey.targetId, resourceKey.origin, resourceKey.tenantId ?? null, resourceKey.objectType, resourceKey.resourceId) as
    | { id: number }
    | undefined;

  if (existing) {
    db.prepare("UPDATE resource_ownership SET owner_auth_profile_id = ? WHERE id = ?").run(input.ownerAuthProfileId, existing.id);
    return existing.id;
  }

  const result = db
    .prepare(
      `INSERT INTO resource_ownership (target_id, origin, tenant_id, object_type, resource_id, owner_auth_profile_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      resourceKey.targetId,
      resourceKey.origin,
      resourceKey.tenantId ?? null,
      resourceKey.objectType,
      resourceKey.resourceId,
      input.ownerAuthProfileId,
    );
  return Number(result.lastInsertRowid);
}

export function listResourceOwnership(db: Db, targetId: number): ResourceOwnership[] {
  const rows = db.prepare("SELECT * FROM resource_ownership WHERE target_id = ? ORDER BY id").all(targetId) as unknown as ResourceOwnershipRow[];
  return rows.map(rowToOwnership);
}

/** The lookup the (future) Automated Authorization Matrix and IDOR scanner use directly. */
export function getResourceOwner(db: Db, resourceKey: ResourceKey): number | null {
  const row = db
    .prepare(
      "SELECT owner_auth_profile_id FROM resource_ownership WHERE target_id = ? AND origin = ? AND tenant_id IS ? AND object_type = ? AND resource_id = ?",
    )
    .get(resourceKey.targetId, resourceKey.origin, resourceKey.tenantId ?? null, resourceKey.objectType, resourceKey.resourceId) as
    | { owner_auth_profile_id: number }
    | undefined;
  return row ? row.owner_auth_profile_id : null;
}
