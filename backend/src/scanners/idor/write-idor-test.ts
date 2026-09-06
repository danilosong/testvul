import type { Db } from "../../db/connection";
import type { ResourceKey } from "../../mutation/resource-key";
import type { JournalInitiator } from "../../mutation/mutation-journal";
import { runMutationTestCycle, type MutationCycleResult } from "../../mutation/mutation-cycle";
import type { RestoreRequester } from "../../restore/restore-engine";
import type { DiscoveredOperation, OperationConfidence } from "../../operation-discovery/discovered-operation";
import type { WithResourceLockOptions } from "../../mutation/with-resource-lock";

export interface WriteIdorTestParams {
  /** Safe Write Validation — never true by default, requires explicit operator opt-in. */
  enabled: boolean;
  db: Db;
  scanRunId: number;
  requester: RestoreRequester;
  /** The other profile's owned resource being targeted, per the Automated Authorization Matrix. */
  resourceKey: ResourceKey;
  resourceUrl: string;
  /** A single harmless, non-denylisted field — the sensitive-field denylist (Section 9.6) is still enforced regardless. */
  fieldPath: string;
  testValue: unknown;
  initiator: JournalInitiator;
  holder: string;
  operations: readonly DiscoveredOperation[];
  minConfidence?: OperationConfidence;
  writeMethod?: string;
  advancedOverrideConfirmed?: boolean;
  lockOptions?: WithResourceLockOptions;
}

export type WriteIdorOutcome = "NOT_RUN" | "COMPLETED";

export interface WriteIdorTestResult {
  outcome: WriteIdorOutcome;
  cycleResult?: MutationCycleResult;
}

/**
 * The opt-in Safe Write IDOR test (design.md — `scanners-xss-gtm-idor`'s
 * Safe Write IDOR Test requirement): disabled unless the operator has
 * explicitly enabled Safe Write Validation. When enabled, it reuses
 * Section 9's shared backup→mutate→verify→restore service
 * (`runMutationTestCycle`) unchanged — the same sensitive-field denylist,
 * Mutation Scope Enforcement, Reversibility-Must-Be-Proven, resource
 * lock, and Recovery Journal every other mutating test goes through, so a
 * denylisted field (e.g. `password`) is refused here exactly as it would
 * be anywhere else, never a parallel/weaker check.
 */
export async function runWriteIdorTest(params: WriteIdorTestParams): Promise<WriteIdorTestResult> {
  if (!params.enabled) {
    return { outcome: "NOT_RUN" };
  }

  const cycleResult = await runMutationTestCycle({
    db: params.db,
    scanRunId: params.scanRunId,
    requester: params.requester,
    resourceKey: params.resourceKey,
    resourceUrl: params.resourceUrl,
    fieldPath: params.fieldPath,
    testValue: params.testValue,
    initiator: params.initiator,
    holder: params.holder,
    operations: params.operations,
    ...(params.minConfidence !== undefined ? { minConfidence: params.minConfidence } : {}),
    ...(params.writeMethod !== undefined ? { writeMethod: params.writeMethod } : {}),
    ...(params.advancedOverrideConfirmed !== undefined ? { advancedOverrideConfirmed: params.advancedOverrideConfirmed } : {}),
    ...(params.lockOptions !== undefined ? { lockOptions: params.lockOptions } : {}),
  });

  return { outcome: "COMPLETED", cycleResult };
}
