import type { BrowserContext } from "playwright";
import type { Db } from "../db/connection";
import type { ScopeValidator } from "../scope";
import type { ResourceKey } from "../mutation/resource-key";
import type { RestoreRequester } from "../restore/restore-engine";
import type { DiscoveredOperation, OperationConfidence } from "../operation-discovery/discovered-operation";
import type { DiscoveredAction } from "./action-discovery";
import { hasEligibleOperation } from "../operation-discovery/discovered-operation";
import { classifyEligibility, type EligibilityState } from "../eligibility/eligibility-classifier";
import { runDryRunCapture, registerDryRunOperation } from "./dry-run-capture";
import { runMutationTestCycle, type MutationCycleResult } from "../mutation/mutation-cycle";
import { isInScope } from "./origin-scope-guard";

export interface SafeBrowserMutationParams {
  db: Db;
  scanRunId: number;
  /** A disposable context for Dry-Run Capture, if a static operation template isn't already known. */
  disposableContext: BrowserContext;
  /** The authenticated session's requester — used for the actual mutation cycle, once authorized. */
  requester: RestoreRequester;
  action: DiscoveredAction;
  pageUrl: string;
  scopeValidator: ScopeValidator;
  resourceKey: ResourceKey;
  resourceUrl: string;
  fieldPath: string;
  testValue: unknown;
  writeMethod?: string;
  minConfidence: OperationConfidence;
  /** Every operation already known from static discovery (Section 7) — checked before ever falling back to Dry-Run Capture. */
  existingOperations: readonly DiscoveredOperation[];
  scanMode: "PASSIVE" | "SAFE_AUTOMATIC" | "ADVANCED";
  /** The confirmed mutation-authorization flag (Section 16.6 exposes an API/UI to set it) — never true by default. */
  mutationAuthorized: boolean;
  /** Test-support only — forces Dry-Run Capture's DRY_RUN_UNAVAILABLE path; see `RunDryRunCaptureParams.interceptionInstallable`. */
  interceptionInstallable?: boolean;
}

export type SafeBrowserMutationOutcome =
  | { status: "NOT_A_SAFE_MUTATION_ACTION" }
  | { status: "NO_OPERATION_TEMPLATE" }
  | { status: "DRY_RUN_AMBIGUOUS" }
  | { status: "NOT_ELIGIBLE"; eligibilityState: EligibilityState }
  | { status: "NOT_AUTHORIZED" }
  | { status: "MUTATED"; cycleResult: MutationCycleResult };

/**
 * The Safe Browser Mutation discovery-before-mutation sequence (design.md
 * Decision 39), as one function whose control flow *is* the ordering —
 * there is no code path that clicks an action and only afterward asks
 * "was that safe?": Action Discovery classification (already done, passed
 * in) → an operation template via a static source (Section 7) or,
 * failing that, Browser Dry-Run Request Capture (Section 12.19) → full
 * `candidate-eligibility` classification (which itself re-derives
 * Mutation Scope and Reversibility-Proven, Sections 9.11/9.12 — never a
 * parallel/looser check) → only on a TESTABLE result, and only when the
 * scan mode is Safe Automatic or Advanced AND the operator's mutation
 * authorization is explicitly confirmed, an Authorized Browser Mutation
 * through Section 9's full lock/backup/journal/restore chain
 * (`runMutationTestCycle`) — the exact same shared service every other
 * mutating test in this codebase goes through, not a parallel
 * reimplementation for browser-driven mutations.
 */
export async function runSafeBrowserMutation(params: SafeBrowserMutationParams): Promise<SafeBrowserMutationOutcome> {
  if (params.action.classification !== "SAFE_MUTATION") {
    return { status: "NOT_A_SAFE_MUTATION_ACTION" };
  }

  const writeMethod = params.writeMethod ?? "PATCH";
  let operations = params.existingOperations;

  const hasStaticTemplate = hasEligibleOperation(operations, writeMethod, params.resourceUrl, params.minConfidence);
  if (!hasStaticTemplate) {
    const dryRun = await runDryRunCapture({
      context: params.disposableContext,
      pageUrl: params.pageUrl,
      actionSelector: params.action.selector,
      scopeValidator: params.scopeValidator,
      ...(params.interceptionInstallable !== undefined ? { interceptionInstallable: params.interceptionInstallable } : {}),
    });

    if (dryRun.status === "DRY_RUN_UNAVAILABLE") return { status: "NO_OPERATION_TEMPLATE" };
    if (dryRun.status === "DRY_RUN_AMBIGUOUS") return { status: "DRY_RUN_AMBIGUOUS" };

    registerDryRunOperation(params.db, params.scanRunId, dryRun);
    operations = [
      ...operations,
      { method: dryRun.request.method, url: dryRun.request.url, source: "BROWSER_DRY_RUN", confidence: "HIGH" },
    ];
  }

  const eligibilityState = classifyEligibility({
    db: params.db,
    resourceKey: params.resourceKey,
    resourceUrl: params.resourceUrl,
    writeMethod,
    fieldPath: params.fieldPath,
    operations,
    minConfidence: params.minConfidence,
    isPassiveTest: false,
    inScope: isInScope(params.resourceUrl, params.scopeValidator),
    hasRequiredAuth: true,
    requiresOwnershipData: false,
    hasOwnershipData: false,
    advancedOverrideConfirmed: false,
    environmentPolicyAllows: true,
    localFixtureDenylistOverrideActive: false,
  });
  if (eligibilityState !== "TESTABLE") {
    return { status: "NOT_ELIGIBLE", eligibilityState };
  }

  const modeAllows = params.scanMode === "SAFE_AUTOMATIC" || params.scanMode === "ADVANCED";
  if (!modeAllows || !params.mutationAuthorized) {
    return { status: "NOT_AUTHORIZED" };
  }

  const cycleResult = await runMutationTestCycle({
    db: params.db,
    scanRunId: params.scanRunId,
    requester: params.requester,
    resourceKey: params.resourceKey,
    resourceUrl: params.resourceUrl,
    fieldPath: params.fieldPath,
    testValue: params.testValue,
    initiator: "BROWSER",
    holder: `BROWSER:${params.action.label || params.action.selector}`,
    operations,
    minConfidence: params.minConfidence,
    writeMethod,
  });

  return { status: "MUTATED", cycleResult };
}
