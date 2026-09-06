import type { Db } from "../db/connection";
import type { ResourceKey } from "./resource-key";
import type { JournalInitiator } from "./mutation-journal";
import { assertFieldNotDenylisted } from "./sensitive-field-denylist";
import { assertResourceNotFrozen } from "./mutation-fail-safe";
import { assertReversibilityProven } from "./reversibility";
import { assertMutationScopeAllowed } from "./mutation-scope";
import { getScanRunEnvironment } from "./scan-run-environment";
import { loadConfig } from "../config";
import { withResourceLock, type WithResourceLockOptions } from "./with-resource-lock";
import { recordJournalState } from "./mutation-journal-repository";
import { captureBackup } from "../backup/backup-engine";
import { mutateField } from "./request-mutator";
import { detectConcurrencySignal } from "../restore/concurrency-signal";
import { restoreResource, type RestoreOutcome, type RestoreRequester } from "../restore/restore-engine";
import type { DiscoveredOperation, OperationConfidence } from "../operation-discovery/discovered-operation";

export interface MutationCycleParams {
  db: Db;
  scanRunId: number;
  requester: RestoreRequester;
  resourceKey: ResourceKey;
  resourceUrl: string;
  /** The flat request-body key the target's read/write endpoints use for this field. */
  fieldPath: string;
  testValue: unknown;
  initiator: JournalInitiator;
  /** Lock holder identity, e.g. "API:XSS_SCANNER". */
  holder: string;
  /** Every operation discovered for this target so far — used to prove reversibility (Section 9.11) before executing. */
  operations: readonly DiscoveredOperation[];
  minConfidence?: OperationConfidence;
  writeMethod?: string;
  /** A distinct, explicit confirmation — separate from ordinary mutation authorization — to mutate a NON_TEST_RESOURCE/UNKNOWN_RESOURCE. Never true by default. */
  advancedOverrideConfirmed?: boolean;
  lockOptions?: WithResourceLockOptions;
}

export interface MutationCycleResult {
  outcome: RestoreOutcome;
  /** The mutating write's raw response body — what the target reflected back immediately after the test value was applied, before restore. Lets a scanner classify what actually got stored without an extra HTTP round-trip. */
  postMutationBody: string;
}

/**
 * The full backup → mutate → restore → restore-verify cycle, with every
 * state transition (BACKUP_CREATED → MUTATION_PENDING → MUTATION_APPLIED →
 * RESTORE_PENDING → a terminal RESTORE_* state) durably persisted to the
 * Recovery Journal immediately before or after its corresponding HTTP
 * call — so a crash at any point leaves an accurate, durable record of
 * exactly how far the cycle got. This is the single place every
 * mutation-initiating subsystem is meant to go through: it enforces the
 * sensitive-field denylist, the frozen-resource fail-safe, Mutation Scope
 * Enforcement, Reversibility-Must-Be-Proven, and the exclusive resource
 * lock before ever sending a mutating request.
 */
export async function runMutationTestCycle(params: MutationCycleParams): Promise<MutationCycleResult> {
  const targetEnvironment = getScanRunEnvironment(params.db, params.scanRunId);
  assertFieldNotDenylisted(params.fieldPath, {
    targetEnvironment,
    testCapabilityEnabled: loadConfig().localFixtureTestCapability,
  });
  assertResourceNotFrozen(params.db, params.resourceKey);
  assertMutationScopeAllowed(params.db, params.resourceKey, params.advancedOverrideConfirmed ?? false);

  const writeMethod = params.writeMethod ?? "PATCH";
  assertReversibilityProven({
    db: params.db,
    resourceKey: params.resourceKey,
    operations: params.operations,
    resourceUrl: params.resourceUrl,
    writeMethod,
    minConfidence: params.minConfidence ?? "MEDIUM",
  });

  return withResourceLock(
    params.db,
    params.resourceKey,
    params.holder,
    async () => {
      const beforeResponse = await params.requester.request(params.resourceUrl);
      const originalBody = JSON.parse(beforeResponse.body) as Record<string, unknown>;

      const snapshot = captureBackup(params.db, params.scanRunId, params.resourceKey, beforeResponse.body);
      recordJournalState(params.db, params.scanRunId, params.resourceKey, params.initiator, "BACKUP_CREATED", {
        fieldPath: params.fieldPath,
      });

      const { expectedPostMutationState } = mutateField(originalBody, params.fieldPath, params.testValue);
      const method = writeMethod;

      // Persisted before the mutating call — if the process crashes during
      // the call itself, the journal already shows a mutation was attempted.
      recordJournalState(params.db, params.scanRunId, params.resourceKey, params.initiator, "MUTATION_PENDING", {
        fieldPath: params.fieldPath,
      });

      const mutateResponse = await params.requester.request(params.resourceUrl, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [params.fieldPath]: params.testValue }),
      });
      const concurrencySignalAfterMutation = detectConcurrencySignal(mutateResponse);

      // Persisted immediately after the mutating call completes.
      recordJournalState(params.db, params.scanRunId, params.resourceKey, params.initiator, "MUTATION_APPLIED", {
        fieldPath: params.fieldPath,
      });

      recordJournalState(params.db, params.scanRunId, params.resourceKey, params.initiator, "RESTORE_PENDING", {
        fieldPath: params.fieldPath,
      });

      const restoreResult = await restoreResource({
        requester: params.requester,
        resourceUrl: params.resourceUrl,
        fieldPath: params.fieldPath,
        originalValue: originalBody[params.fieldPath],
        originalContentHash: snapshot.contentHash,
        expectedPostMutationState,
        writeMethod: method,
        ...(concurrencySignalAfterMutation ? { concurrencySignalAfterMutation } : {}),
      });

      // Persisted immediately after the restore call completes.
      recordJournalState(params.db, params.scanRunId, params.resourceKey, params.initiator, restoreResult.outcome, {
        fieldPath: params.fieldPath,
        requiresManualIntervention: restoreResult.outcome !== "RESTORE_OK",
      });

      return { outcome: restoreResult.outcome, postMutationBody: mutateResponse.body };
    },
    params.lockOptions,
  );
}
