import type { Db } from "../../db/connection";
import type { ResourceKey } from "../../mutation/resource-key";
import type { JournalInitiator } from "../../mutation/mutation-journal";
import { assertFieldNotDenylisted } from "../../mutation/sensitive-field-denylist";
import { assertResourceNotFrozen } from "../../mutation/mutation-fail-safe";
import { assertMutationScopeAllowed } from "../../mutation/mutation-scope";
import { assertReversibilityProven } from "../../mutation/reversibility";
import { getScanRunEnvironment } from "../../mutation/scan-run-environment";
import { loadConfig } from "../../config";
import { withResourceLock, type WithResourceLockOptions } from "../../mutation/with-resource-lock";
import { recordJournalState } from "../../mutation/mutation-journal-repository";
import { captureBackup } from "../../backup/backup-engine";
import { mutateField } from "../../mutation/request-mutator";
import { detectConcurrencySignal } from "../../restore/concurrency-signal";
import { restoreResource, type RestoreOutcome, type RestoreRequester } from "../../restore/restore-engine";
import type { DiscoveredOperation, OperationConfidence } from "../../operation-discovery/discovered-operation";

export const DEFAULT_CANARY_GTM_ID = "GTM-SECURITYTEST";

export type GtmPermissionOutcome = "AUTHORIZED" | "UNAUTHORIZED" | "VALIDATION_REJECTED" | "INCONCLUSIVE";

export interface GtmPermissionTestParams {
  db: Db;
  scanRunId: number;
  requester: RestoreRequester;
  resourceKey: ResourceKey;
  resourceUrl: string;
  fieldPath: string;
  writeMethod?: string;
  /** Never a real/randomly-picked live GTM container id — defaults to a dedicated test-only marker. */
  canaryGtmId?: string;
  initiator: JournalInitiator;
  holder: string;
  operations: readonly DiscoveredOperation[];
  minConfidence?: OperationConfidence;
  advancedOverrideConfirmed?: boolean;
  lockOptions?: WithResourceLockOptions;
}

export interface GtmPermissionTestResult {
  outcome: GtmPermissionOutcome;
  /** Present only when AUTHORIZED — a real mutation was applied and restore was attempted. */
  restoreOutcome?: RestoreOutcome;
}

/**
 * The GTM permission test (design.md — `scanners-xss-gtm-idor`'s GTM
 * Permission Test): attempts to change a GTM configuration field to a
 * dedicated canary id, and differentiates AUTHORIZED (the mutation
 * actually persisted) from UNAUTHORIZED (rejected as a permission
 * failure), VALIDATION_REJECTED (rejected for a format/validation
 * reason — never mistaken for UNAUTHORIZED), or INCONCLUSIVE (an
 * ambiguous outcome that can't be cleanly classified). Never loads an
 * external GTM container. Goes through the same lock/journal/backup
 * machinery as every other mutation, but — unlike the base mutation
 * cycle — a rejected write (403 or a validation error) is recognized as
 * "nothing was ever stored," so no restore attempt is needed or made.
 */
export async function runGtmPermissionTest(params: GtmPermissionTestParams): Promise<GtmPermissionTestResult> {
  const targetEnvironment = getScanRunEnvironment(params.db, params.scanRunId);
  assertFieldNotDenylisted(params.fieldPath, {
    targetEnvironment,
    testCapabilityEnabled: loadConfig().localFixtureTestCapability,
  });
  assertResourceNotFrozen(params.db, params.resourceKey);
  assertMutationScopeAllowed(params.db, params.resourceKey, params.advancedOverrideConfirmed ?? false);

  const method = params.writeMethod ?? "PATCH";
  assertReversibilityProven({
    db: params.db,
    resourceKey: params.resourceKey,
    operations: params.operations,
    resourceUrl: params.resourceUrl,
    writeMethod: method,
    minConfidence: params.minConfidence ?? "MEDIUM",
  });

  const canaryGtmId = params.canaryGtmId ?? DEFAULT_CANARY_GTM_ID;

  return withResourceLock(
    params.db,
    params.resourceKey,
    params.holder,
    async () => {
      const before = await params.requester.request(params.resourceUrl);
      const originalBody = JSON.parse(before.body) as Record<string, unknown>;
      const snapshot = captureBackup(params.db, params.scanRunId, params.resourceKey, before.body);
      recordJournalState(params.db, params.scanRunId, params.resourceKey, params.initiator, "BACKUP_CREATED", {
        fieldPath: params.fieldPath,
      });

      recordJournalState(params.db, params.scanRunId, params.resourceKey, params.initiator, "MUTATION_PENDING", {
        fieldPath: params.fieldPath,
      });
      const mutateResponse = await params.requester.request(params.resourceUrl, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [params.fieldPath]: canaryGtmId }),
      });

      // A rejected write (permission or validation) never stored anything —
      // there is nothing to restore, so the cycle ends here.
      if (mutateResponse.status === 403) {
        recordJournalState(params.db, params.scanRunId, params.resourceKey, params.initiator, "RESTORE_OK", { fieldPath: params.fieldPath });
        return { outcome: "UNAUTHORIZED" as const };
      }
      if (mutateResponse.status === 422 || mutateResponse.status === 400) {
        recordJournalState(params.db, params.scanRunId, params.resourceKey, params.initiator, "RESTORE_OK", { fieldPath: params.fieldPath });
        return { outcome: "VALIDATION_REJECTED" as const };
      }
      if (mutateResponse.status < 200 || mutateResponse.status >= 300) {
        recordJournalState(params.db, params.scanRunId, params.resourceKey, params.initiator, "RESTORE_OK", { fieldPath: params.fieldPath });
        return { outcome: "INCONCLUSIVE" as const };
      }

      recordJournalState(params.db, params.scanRunId, params.resourceKey, params.initiator, "MUTATION_APPLIED", {
        fieldPath: params.fieldPath,
      });

      // Verify persistence via a real GET — never trust the mutating
      // response's own echo of the value alone.
      const verifyGet = await params.requester.request(params.resourceUrl);
      let currentValue: unknown;
      try {
        currentValue = (JSON.parse(verifyGet.body) as Record<string, unknown>)[params.fieldPath];
      } catch {
        currentValue = undefined;
      }
      if (currentValue !== canaryGtmId) {
        recordJournalState(params.db, params.scanRunId, params.resourceKey, params.initiator, "RESTORE_OK", { fieldPath: params.fieldPath });
        return { outcome: "INCONCLUSIVE" as const };
      }

      recordJournalState(params.db, params.scanRunId, params.resourceKey, params.initiator, "RESTORE_PENDING", {
        fieldPath: params.fieldPath,
      });
      const { expectedPostMutationState } = mutateField(originalBody, params.fieldPath, canaryGtmId);
      const concurrencySignalAfterMutation = detectConcurrencySignal(mutateResponse);
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
      recordJournalState(params.db, params.scanRunId, params.resourceKey, params.initiator, restoreResult.outcome, {
        fieldPath: params.fieldPath,
        requiresManualIntervention: restoreResult.outcome !== "RESTORE_OK",
      });

      return { outcome: "AUTHORIZED" as const, restoreOutcome: restoreResult.outcome };
    },
    params.lockOptions,
  );
}
