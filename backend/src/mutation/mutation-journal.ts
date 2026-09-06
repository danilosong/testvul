import type { ResourceKey } from "./resource-key";

export type JournalState =
  | "BACKUP_CREATED"
  | "MUTATION_PENDING"
  | "MUTATION_APPLIED"
  | "RESTORE_PENDING"
  | "RESTORE_OK"
  | "RESTORE_FAILED"
  | "RESTORE_CONFLICT";

export type JournalInitiator = "API" | "BROWSER" | "BUSINESS_LOGIC";

export interface JournalEntry {
  id: number;
  resourceKey: ResourceKey;
  initiator: JournalInitiator;
  fieldPath?: string;
  state: JournalState;
  requiresManualIntervention: boolean;
}

/** A resource is frozen the instant its most recent journal entry is a
 * terminal failure state — regardless of which subsystem or field caused
 * it. This is a minimal slice of the full Recovery Journal (Section 9.9
 * builds the durable BACKUP_CREATED→...→RESTORE_* lifecycle around every
 * mutating HTTP call); this file only needs enough to answer "is this
 * resource currently frozen." */
export const FROZEN_STATES = new Set<JournalState>(["RESTORE_FAILED", "RESTORE_CONFLICT"]);
