import type { Db } from "../db/connection";
import type { ResourceKey } from "./resource-key";
import { isResourceFrozen } from "./mutation-journal-repository";
import { isLockAvailable } from "./resource-lock-repository";
import { hasEligibleOperation, type DiscoveredOperation, type OperationConfidence } from "../operation-discovery/discovered-operation";

export type ReversibilityPrecondition =
  | "KNOWN_PRE_STATE"
  | "KNOWN_OPERATION"
  | "KNOWN_RESTORE_STRATEGY"
  | "AVAILABLE_RESOURCE_LOCK"
  | "AVAILABLE_JOURNAL_ENTRY"
  | "FEASIBLE_RESTORE_VERIFICATION";

export interface ReversibilityCheckParams {
  db: Db;
  resourceKey: ResourceKey;
  operations: readonly DiscoveredOperation[];
  resourceUrl: string;
  writeMethod: string;
  minConfidence: OperationConfidence;
}

export interface ReversibilityAssessment {
  proven: boolean;
  missing: ReversibilityPrecondition[];
}

// A restore is only ever expressed today as a partial (field-level) write —
// PATCH or PUT — never a create-only/append-only method, so those are the
// only methods a "known restore strategy" can exist for.
const RESTORABLE_METHODS = new Set(["PATCH", "PUT"]);

/**
 * The Reversibility-Must-Be-Proven check (design.md Decision 40, spec
 * requirement in `backup-restore-evidence`): before any mutation expected
 * to be reversible executes, every one of six preconditions must hold —
 * a known pre-state, a known operation, a known restore strategy, an
 * available resource lock, an available journal entry, and a feasible
 * restore-verification path. This performs no side effects itself (it
 * never acquires the lock or writes a journal entry) — it only assesses
 * whether the shared mutation entry point's later, real attempt to do so
 * is expected to succeed.
 */
export function assessReversibility(params: ReversibilityCheckParams): ReversibilityAssessment {
  const missing: ReversibilityPrecondition[] = [];

  const hasReadOperation = hasEligibleOperation(params.operations, "GET", params.resourceUrl, params.minConfidence);
  if (!hasReadOperation) {
    missing.push("KNOWN_PRE_STATE");
    missing.push("FEASIBLE_RESTORE_VERIFICATION");
  }

  if (!hasEligibleOperation(params.operations, params.writeMethod, params.resourceUrl, params.minConfidence)) {
    missing.push("KNOWN_OPERATION");
  }

  if (!RESTORABLE_METHODS.has(params.writeMethod.toUpperCase())) {
    missing.push("KNOWN_RESTORE_STRATEGY");
  }

  if (isResourceFrozen(params.db, params.resourceKey)) {
    missing.push("AVAILABLE_RESOURCE_LOCK", "AVAILABLE_JOURNAL_ENTRY");
  } else if (!isLockAvailable(params.db, params.resourceKey)) {
    missing.push("AVAILABLE_RESOURCE_LOCK");
  }

  return { proven: missing.length === 0, missing };
}

export class ReversibilityNotProvenError extends Error {
  constructor(public readonly missing: ReversibilityPrecondition[]) {
    super(`REVERSIBILITY_NOT_PROVEN — missing: ${missing.join(", ")}`);
    this.name = "ReversibilityNotProvenError";
  }
}

/** Throws `ReversibilityNotProvenError` rather than let a caller execute a mutation "to find out." */
export function assertReversibilityProven(params: ReversibilityCheckParams): void {
  const assessment = assessReversibility(params);
  if (!assessment.proven) {
    throw new ReversibilityNotProvenError(assessment.missing);
  }
}
