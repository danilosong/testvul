import type { Db } from "../db/connection";
import type { ResourceKey } from "./resource-key";
import { LockAcquisitionTimeoutError } from "./resource-lock";
import { tryAcquireLock, releaseLock } from "./resource-lock-repository";

export interface WithResourceLockOptions {
  /** How long this holder's lease is valid for once granted. Default 30s. */
  leaseMs?: number;
  /** How often to retry acquiring while another holder has the lock. Default 20ms. */
  pollIntervalMs?: number;
  /** How long to wait for the lock before giving up. Default 5s. */
  maxWaitMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` only once this holder has the exclusive lock on `resourceKey`,
 * waiting (rescheduling) while another test holds it, and always releasing
 * the lock afterward — success, failure, or RESTORE_FAILED/RESTORE_CONFLICT
 * all release it the same way, since it is the resource's mutation-journal
 * state (not the lock) that decides whether a *future* caller may proceed.
 */
export async function withResourceLock<T>(
  db: Db,
  resourceKey: ResourceKey,
  holder: string,
  fn: () => Promise<T>,
  options: WithResourceLockOptions = {},
): Promise<T> {
  const leaseMs = options.leaseMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 20;
  const maxWaitMs = options.maxWaitMs ?? 5_000;
  const deadline = Date.now() + maxWaitMs;

  let lock = tryAcquireLock(db, resourceKey, holder, leaseMs);
  while (!lock) {
    if (Date.now() > deadline) throw new LockAcquisitionTimeoutError(resourceKey);
    await sleep(pollIntervalMs);
    lock = tryAcquireLock(db, resourceKey, holder, leaseMs);
  }

  try {
    return await fn();
  } finally {
    releaseLock(db, lock.id);
  }
}
