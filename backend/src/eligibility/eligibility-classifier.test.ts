import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { classifyEligibility, isQueueable, type EligibilityCandidateInput } from "./eligibility-classifier";
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

function freshTarget(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-eligibility-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  return db;
}

const RESOURCE: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "certificate", resourceId: "1" };
const RESOURCE_URL = "https://example.com/api/certificates/1";
const FULL_OPERATIONS: DiscoveredOperation[] = [
  { method: "GET", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" },
  { method: "PATCH", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" },
];

function baseInput(db: Db): EligibilityCandidateInput {
  return {
    db,
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
  };
}

describe("classifyEligibility", () => {
  it("classifies TESTABLE when every precondition is satisfied", () => {
    const db = freshTarget();
    addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: "1" });
    expect(classifyEligibility(baseInput(db))).toBe("TESTABLE");
  });

  it("classifies PASSIVE_ONLY for an inherently read-only test, before any mutation precondition is even considered", () => {
    const db = freshTarget();
    expect(classifyEligibility({ ...baseInput(db), isPassiveTest: true, operations: [] })).toBe("PASSIVE_ONLY");
  });

  it("classifies SKIPPED_OUT_OF_SCOPE ahead of every other check", () => {
    const db = freshTarget();
    expect(classifyEligibility({ ...baseInput(db), inScope: false, isPassiveTest: true })).toBe("SKIPPED_OUT_OF_SCOPE");
  });

  it("classifies SKIPPED_SENSITIVE_RESOURCE for a denylisted field", () => {
    const db = freshTarget();
    expect(classifyEligibility({ ...baseInput(db), fieldPath: "price" })).toBe("SKIPPED_SENSITIVE_RESOURCE");
  });

  it("lifts SKIPPED_SENSITIVE_RESOURCE only when the LOCAL_FIXTURE override is explicitly active", () => {
    const db = freshTarget();
    addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: "1" });
    expect(
      classifyEligibility({ ...baseInput(db), fieldPath: "price", localFixtureDenylistOverrideActive: true }),
    ).toBe("TESTABLE");
  });

  it("classifies SKIPPED_NO_AUTH when no authentication profile is available", () => {
    const db = freshTarget();
    expect(classifyEligibility({ ...baseInput(db), hasRequiredAuth: false })).toBe("SKIPPED_NO_AUTH");
  });

  it("classifies SKIPPED_NO_OWNERSHIP_DATA for an authorization test with no configured ownership data", () => {
    const db = freshTarget();
    expect(
      classifyEligibility({ ...baseInput(db), requiresOwnershipData: true, hasOwnershipData: false }),
    ).toBe("SKIPPED_NO_OWNERSHIP_DATA");
  });

  it("classifies SKIPPED_NO_WRITE_TEMPLATE when no eligible DiscoveredOperation exists for the write", () => {
    const db = freshTarget();
    expect(
      classifyEligibility({ ...baseInput(db), operations: [{ method: "GET", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" }] }),
    ).toBe("SKIPPED_NO_WRITE_TEMPLATE");
  });

  it("classifies SKIPPED_NON_TEST_RESOURCE when Mutation Scope excludes the resource and no override is confirmed", () => {
    const db = freshTarget();
    // No Mutation Scope entry declared at all for this target.
    expect(classifyEligibility(baseInput(db))).toBe("SKIPPED_NON_TEST_RESOURCE");
  });

  it("SKIPPED_NON_TEST_RESOURCE is lifted only by the distinct advanced override", () => {
    const db = freshTarget();
    expect(classifyEligibility({ ...baseInput(db), advancedOverrideConfirmed: true })).toBe("TESTABLE");
  });

  it("classifies SKIPPED_REVERSIBILITY_NOT_PROVEN when a restore-verification path can't be established, even with a known write operation", () => {
    const db = freshTarget();
    addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: "1" });
    // The write operation is known (so this isn't SKIPPED_NO_WRITE_TEMPLATE)
    // but there's no discovered GET operation to read a pre-state/verify a restore.
    const writeOnly: DiscoveredOperation[] = [{ method: "PATCH", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" }];
    expect(classifyEligibility({ ...baseInput(db), operations: writeOnly })).toBe("SKIPPED_REVERSIBILITY_NOT_PROVEN");
  });

  it("classifies SKIPPED_ENVIRONMENT_POLICY when every other precondition holds but environment policy disallows it", () => {
    const db = freshTarget();
    addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: "1" });
    expect(classifyEligibility({ ...baseInput(db), environmentPolicyAllows: false })).toBe("SKIPPED_ENVIRONMENT_POLICY");
  });

  it("classifies INCONCLUSIVE when the caller could not cleanly determine eligibility", () => {
    const db = freshTarget();
    expect(classifyEligibility({ ...baseInput(db), undetermined: true })).toBe("INCONCLUSIVE");
  });
});

describe("isQueueable", () => {
  it("is true only for TESTABLE", () => {
    freshTarget();
    expect(isQueueable("TESTABLE")).toBe(true);
    expect(isQueueable("PASSIVE_ONLY")).toBe(false);
    expect(isQueueable("SKIPPED_NO_WRITE_TEMPLATE")).toBe(false);
    expect(isQueueable("SKIPPED_NON_TEST_RESOURCE")).toBe(false);
    expect(isQueueable("SKIPPED_REVERSIBILITY_NOT_PROVEN")).toBe(false);
    expect(isQueueable("SKIPPED_ENVIRONMENT_POLICY")).toBe(false);
    expect(isQueueable("INCONCLUSIVE")).toBe(false);
  });
});
