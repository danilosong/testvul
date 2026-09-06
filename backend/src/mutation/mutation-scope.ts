import type { Db } from "../db/connection";
import type { ResourceKey } from "./resource-key";

export type MutationScopeClassification = "TEST_RESOURCE" | "NON_TEST_RESOURCE" | "UNKNOWN_RESOURCE";

interface MutationScopeRow {
  origin: string | null;
  object_type: string | null;
  resource_id: string | null;
  tenant_id: string | null;
}

function rowMatches(row: MutationScopeRow, key: ResourceKey): boolean {
  if (row.origin !== null && row.origin !== key.origin) return false;
  if (row.object_type !== null && row.object_type !== key.objectType) return false;
  if (row.resource_id !== null && row.resource_id !== key.resourceId) return false;
  if (row.tenant_id !== null && row.tenant_id !== (key.tenantId ?? null)) return false;
  return true;
}

/**
 * Classifies a resource against the operator-configured Mutation Scope
 * (`mutation_scope_resources`) for its target: TEST_RESOURCE when it
 * matches a declared entry (a NULL column on a scope row acts as a
 * wildcard for that dimension), NON_TEST_RESOURCE when the target has a
 * Mutation Scope configured but this resource isn't part of it, or
 * UNKNOWN_RESOURCE when the target has no Mutation Scope configured at
 * all. Reads are unaffected by this classification — it only governs
 * mutation eligibility (design.md Decision 40).
 */
export function classifyMutationScope(db: Db, resourceKey: ResourceKey): MutationScopeClassification {
  const rows = db
    .prepare("SELECT origin, object_type, resource_id, tenant_id FROM mutation_scope_resources WHERE target_id = ?")
    .all(resourceKey.targetId) as unknown as MutationScopeRow[];

  if (rows.length === 0) return "UNKNOWN_RESOURCE";
  return rows.some((row) => rowMatches(row, resourceKey)) ? "TEST_RESOURCE" : "NON_TEST_RESOURCE";
}

export interface MutationScopeEntryInput {
  targetId: number;
  origin?: string;
  objectType?: string;
  resourceId?: string;
  tenantId?: string;
  description?: string;
}

/** Declares one Mutation Scope entry. A future Section 16 UI/API owns full CRUD over this table; this is the minimal write path this section needs. */
export function addMutationScopeEntry(db: Db, entry: MutationScopeEntryInput): number {
  const result = db
    .prepare(
      "INSERT INTO mutation_scope_resources (target_id, origin, object_type, resource_id, tenant_id, description) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      entry.targetId,
      entry.origin ?? null,
      entry.objectType ?? null,
      entry.resourceId ?? null,
      entry.tenantId ?? null,
      entry.description ?? null,
    );
  return Number(result.lastInsertRowid);
}

/** Every Mutation Scope entry configured for a target — Section 14.8's Immutable Scan Run Configuration Snapshot copies exactly this list into `scan_run_configs.mutation_scope_snapshot_json` at scan start. */
export function listMutationScopeEntriesForTarget(db: Db, targetId: number): MutationScopeEntryInput[] {
  const rows = db
    .prepare("SELECT origin, object_type as objectType, resource_id as resourceId, tenant_id as tenantId, description FROM mutation_scope_resources WHERE target_id = ?")
    .all(targetId) as unknown as { origin: string | null; objectType: string | null; resourceId: string | null; tenantId: string | null; description: string | null }[];
  return rows.map((row) => {
    const entry: MutationScopeEntryInput = { targetId };
    if (row.origin !== null) entry.origin = row.origin;
    if (row.objectType !== null) entry.objectType = row.objectType;
    if (row.resourceId !== null) entry.resourceId = row.resourceId;
    if (row.tenantId !== null) entry.tenantId = row.tenantId;
    if (row.description !== null) entry.description = row.description;
    return entry;
  });
}

export class MutationScopeViolationError extends Error {
  constructor(
    public readonly resourceKey: ResourceKey,
    public readonly classification: "NON_TEST_RESOURCE" | "UNKNOWN_RESOURCE",
  ) {
    super(
      `Mutation scope violation: resource ${resourceKey.objectType}:${resourceKey.resourceId} classified ${classification} — ` +
        "refusing to mutate without a distinct, explicit advanced override",
    );
    this.name = "MutationScopeViolationError";
  }
}

/**
 * The Mutation Scope Enforcement guard every mutation-initiating subsystem
 * must call: refuses NON_TEST_RESOURCE/UNKNOWN_RESOURCE by default,
 * regardless of which subsystem (API, browser, business-logic) initiates
 * the mutation, unless `advancedOverrideConfirmed` — a distinct, explicit
 * confirmation the caller obtained separately from ordinary mutation
 * authorization — is true.
 */
export function assertMutationScopeAllowed(
  db: Db,
  resourceKey: ResourceKey,
  advancedOverrideConfirmed: boolean,
): MutationScopeClassification {
  const classification = classifyMutationScope(db, resourceKey);
  if (classification !== "TEST_RESOURCE" && !advancedOverrideConfirmed) {
    throw new MutationScopeViolationError(resourceKey, classification);
  }
  return classification;
}
