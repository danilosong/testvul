import type { ResourceKey } from "./resource-key";

export interface ResourceLock {
  id: number;
  resourceKey: ResourceKey;
  holder: string;
  acquiredAt: string;
  leaseExpiresAt: string;
}

/** Lock acquisition is refused regardless of lease expiry while the
 * resource's most recent journal entry is any of these — only the
 * Recovery Manager (Section 9.9) or an explicit manual intervention may
 * clear the state and make the resource available again. */
export const LOCK_BLOCKING_JOURNAL_STATES = new Set([
  "MUTATION_PENDING",
  "MUTATION_APPLIED",
  "RESTORE_PENDING",
  "RESTORE_FAILED",
  "RESTORE_CONFLICT",
]);

export class LockAcquisitionTimeoutError extends Error {
  constructor(public readonly resourceKey: ResourceKey) {
    super(
      `Timed out waiting for the mutation lock on ${resourceKey.objectType}:${resourceKey.resourceId} ` +
        `(target ${resourceKey.targetId})`,
    );
    this.name = "LockAcquisitionTimeoutError";
  }
}
