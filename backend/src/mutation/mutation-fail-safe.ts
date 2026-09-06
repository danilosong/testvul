import type { Db } from "../db/connection";
import type { ResourceKey } from "./resource-key";
import { isResourceFrozen } from "./mutation-journal-repository";

export class ResourceFrozenError extends Error {
  constructor(public readonly resourceKey: ResourceKey) {
    super(
      `Resource ${resourceKey.objectType}:${resourceKey.resourceId} on target ${resourceKey.targetId} is frozen ` +
        "pending manual review after a prior RESTORE_FAILED or RESTORE_CONFLICT — refusing to start a new mutation.",
    );
    this.name = "ResourceFrozenError";
  }
}

/**
 * The single shared entry point every mutation-initiating subsystem — an
 * API scanner, the browser engine, a business-logic test plan — must call
 * before starting a new backup→mutate→verify→restore cycle. Once a
 * resource's most recent outcome is RESTORE_FAILED or RESTORE_CONFLICT,
 * this throws for every caller, regardless of which subsystem or field is
 * asking, until a human resolves it.
 */
export function assertResourceNotFrozen(db: Db, resourceKey: ResourceKey): void {
  if (isResourceFrozen(db, resourceKey)) {
    throw new ResourceFrozenError(resourceKey);
  }
}
