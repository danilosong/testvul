import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { insertCandidate, getCandidateById, updateEvidentiaryOutcome } from "./candidates-repository";
import { isQueueable } from "./eligibility-classifier";
import { summarizeCandidateOutcome } from "./candidate-outcome-summary";
import { addMutationScopeEntry } from "../mutation/mutation-scope";
import type { ResourceKey } from "../mutation/resource-key";
import type { DiscoveredOperation } from "../operation-discovery/discovered-operation";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-candidates-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

const RESOURCE: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "certificate", resourceId: "1" };
const RESOURCE_URL = "https://example.com/api/certificates/1";
const FULL_OPERATIONS: DiscoveredOperation[] = [
  { method: "GET", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" },
  { method: "PATCH", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" },
];

describe("insertCandidate — eligibility computed and persisted at candidate-generation time", () => {
  it("an HTML candidate with no eligible write template is classified SKIPPED_NO_WRITE_TEMPLATE and never reaches a queued state", () => {
    const { db, scanRunId } = freshScanRun();
    addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: "1" });

    const candidate = insertCandidate(db, scanRunId, {
      scanner: "XSS",
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      fieldPath: "certificateText",
      confidence: "HIGH",
      priority: 1,
      operations: [{ method: "GET", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" }], // no PATCH template
      minConfidence: "MEDIUM",
      isPassiveTest: false,
      inScope: true,
      hasRequiredAuth: true,
      requiresOwnershipData: false,
      hasOwnershipData: false,
      advancedOverrideConfirmed: false,
      environmentPolicyAllows: true,
      localFixtureDenylistOverrideActive: false,
    });

    expect(candidate.eligibilityState).toBe("SKIPPED_NO_WRITE_TEMPLATE");
    expect(isQueueable(candidate.eligibilityState)).toBe(false);

    const persisted = getCandidateById(db, candidate.id)!;
    expect(persisted.eligibilityState).toBe("SKIPPED_NO_WRITE_TEMPLATE");
  });

  it("produces SKIPPED_NON_TEST_RESOURCE when Mutation Scope excludes the resource", () => {
    const { db, scanRunId } = freshScanRun();
    // No Mutation Scope entry declared.
    const candidate = insertCandidate(db, scanRunId, {
      scanner: "XSS",
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      fieldPath: "certificateText",
      operations: FULL_OPERATIONS,
      minConfidence: "MEDIUM",
      isPassiveTest: false,
      inScope: true,
      hasRequiredAuth: true,
      requiresOwnershipData: false,
      hasOwnershipData: false,
      advancedOverrideConfirmed: false,
      environmentPolicyAllows: true,
      localFixtureDenylistOverrideActive: false,
    });

    expect(candidate.eligibilityState).toBe("SKIPPED_NON_TEST_RESOURCE");
    expect(isQueueable(candidate.eligibilityState)).toBe(false);
  });

  it("produces SKIPPED_REVERSIBILITY_NOT_PROVEN when no restore-verification path can be established", () => {
    const { db, scanRunId } = freshScanRun();
    addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: "1" });

    const candidate = insertCandidate(db, scanRunId, {
      scanner: "XSS",
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      fieldPath: "certificateText",
      operations: [{ method: "PATCH", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" }], // no GET template
      minConfidence: "MEDIUM",
      isPassiveTest: false,
      inScope: true,
      hasRequiredAuth: true,
      requiresOwnershipData: false,
      hasOwnershipData: false,
      advancedOverrideConfirmed: false,
      environmentPolicyAllows: true,
      localFixtureDenylistOverrideActive: false,
    });

    expect(candidate.eligibilityState).toBe("SKIPPED_REVERSIBILITY_NOT_PROVEN");
    expect(isQueueable(candidate.eligibilityState)).toBe(false);
  });

  it("produces SKIPPED_ENVIRONMENT_POLICY when environment policy disallows the mutation despite every other precondition holding", () => {
    const { db, scanRunId } = freshScanRun();
    addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: "1" });

    const candidate = insertCandidate(db, scanRunId, {
      scanner: "XSS",
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      fieldPath: "certificateText",
      operations: FULL_OPERATIONS,
      minConfidence: "MEDIUM",
      isPassiveTest: false,
      inScope: true,
      hasRequiredAuth: true,
      requiresOwnershipData: false,
      hasOwnershipData: false,
      advancedOverrideConfirmed: false,
      environmentPolicyAllows: false,
      localFixtureDenylistOverrideActive: false,
    });

    expect(candidate.eligibilityState).toBe("SKIPPED_ENVIRONMENT_POLICY");
    expect(isQueueable(candidate.eligibilityState)).toBe(false);
  });

  it("persists a TESTABLE candidate when every precondition holds", () => {
    const { db, scanRunId } = freshScanRun();
    addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: "1" });

    const candidate = insertCandidate(db, scanRunId, {
      scanner: "XSS",
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      fieldPath: "certificateText",
      operations: FULL_OPERATIONS,
      minConfidence: "MEDIUM",
      isPassiveTest: false,
      inScope: true,
      hasRequiredAuth: true,
      requiresOwnershipData: false,
      hasOwnershipData: false,
      advancedOverrideConfirmed: false,
      environmentPolicyAllows: true,
      localFixtureDenylistOverrideActive: false,
    });

    expect(candidate.eligibilityState).toBe("TESTABLE");
    expect(isQueueable(candidate.eligibilityState)).toBe(true);
  });
});

describe("insertCandidate — browser_testability tagging", () => {
  it("is tagged FULLY_TESTABLE once both an eligible operation and a discovered browser-renderable page are present", () => {
    const { db, scanRunId } = freshScanRun();
    addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: "1" });

    const candidate = insertCandidate(db, scanRunId, {
      scanner: "XSS",
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      fieldPath: "certificateText",
      operations: FULL_OPERATIONS,
      minConfidence: "MEDIUM",
      isPassiveTest: false,
      inScope: true,
      hasRequiredAuth: true,
      requiresOwnershipData: false,
      hasOwnershipData: false,
      advancedOverrideConfirmed: false,
      environmentPolicyAllows: true,
      localFixtureDenylistOverrideActive: false,
      browserDiscoveryAttempted: true,
      browserRenderablePageFound: true,
    });

    expect(candidate.browserTestability).toBe("FULLY_TESTABLE");
  });

  it("is tagged DRY_RUN_UNAVAILABLE when the only path to an operation is an unsafely-capturable dry-run", () => {
    const { db, scanRunId } = freshScanRun();

    const candidate = insertCandidate(db, scanRunId, {
      scanner: "XSS",
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      fieldPath: "certificateText",
      operations: [], // no API-level operation at all — the dry-run is the only path
      minConfidence: "MEDIUM",
      isPassiveTest: false,
      inScope: true,
      hasRequiredAuth: true,
      requiresOwnershipData: false,
      hasOwnershipData: false,
      advancedOverrideConfirmed: false,
      environmentPolicyAllows: true,
      localFixtureDenylistOverrideActive: false,
      browserDiscoveryAttempted: true,
      dryRunOutcome: "UNAVAILABLE",
    });

    expect(candidate.browserTestability).toBe("DRY_RUN_UNAVAILABLE");
  });

  it("defaults to REQUIRES_BROWSER_RUNTIME/pending when browser discovery hasn't run", () => {
    const { db, scanRunId } = freshScanRun();
    addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: "1" });

    const candidate = insertCandidate(db, scanRunId, {
      scanner: "XSS",
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      fieldPath: "certificateText",
      operations: FULL_OPERATIONS,
      minConfidence: "MEDIUM",
      isPassiveTest: false,
      inScope: true,
      hasRequiredAuth: true,
      requiresOwnershipData: false,
      hasOwnershipData: false,
      advancedOverrideConfirmed: false,
      environmentPolicyAllows: true,
      localFixtureDenylistOverrideActive: false,
    });

    expect(candidate.browserTestability).toBe("REQUIRES_BROWSER_RUNTIME");
  });
});

describe("a SKIPPED_NO_AUTH candidate's API representation is structurally distinguishable from a tested-and-clean one", () => {
  it("differs in summarized outcome kind, end to end through real persistence", () => {
    const { db, scanRunId } = freshScanRun();
    addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: "1" });
    addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: "2" });

    const skippedCandidate = insertCandidate(db, scanRunId, {
      scanner: "XSS",
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      fieldPath: "certificateText",
      operations: FULL_OPERATIONS,
      minConfidence: "MEDIUM",
      isPassiveTest: false,
      inScope: true,
      hasRequiredAuth: false, // no auth profile available
      requiresOwnershipData: false,
      hasOwnershipData: false,
      advancedOverrideConfirmed: false,
      environmentPolicyAllows: true,
      localFixtureDenylistOverrideActive: false,
    });
    expect(skippedCandidate.eligibilityState).toBe("SKIPPED_NO_AUTH");

    const testedCandidate = insertCandidate(db, scanRunId, {
      scanner: "XSS",
      resourceKey: { ...RESOURCE, resourceId: "2" },
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      fieldPath: "certificateText",
      operations: FULL_OPERATIONS,
      minConfidence: "MEDIUM",
      isPassiveTest: false,
      inScope: true,
      hasRequiredAuth: true,
      requiresOwnershipData: false,
      hasOwnershipData: false,
      advancedOverrideConfirmed: false,
      environmentPolicyAllows: true,
      localFixtureDenylistOverrideActive: false,
    });
    expect(testedCandidate.eligibilityState).toBe("TESTABLE");
    // A real test ran against this candidate and found nothing — "tested and clean."
    updateEvidentiaryOutcome(db, testedCandidate.id, "PROVEN_BLOCKED");

    const skippedView = getCandidateById(db, skippedCandidate.id)!;
    const testedView = getCandidateById(db, testedCandidate.id)!;

    const skippedSummary = summarizeCandidateOutcome(skippedView);
    const testedSummary = summarizeCandidateOutcome(testedView);

    expect(skippedSummary.kind).toBe("SKIPPED");
    expect(testedSummary.kind).toBe("TESTED");
    expect(skippedSummary).not.toEqual(testedSummary);
  });
});
