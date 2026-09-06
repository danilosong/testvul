import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { insertCandidate, type CandidateInsertInput } from "./candidates-repository";
import { addMutationScopeEntry } from "../mutation/mutation-scope";
import { computeCoverage } from "./coverage-engine";
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
  dir = mkdtempSync(join(tmpdir(), "sca-coverage-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

function resourceFor(id: string): ResourceKey {
  return { targetId: 1, origin: "https://example.com", objectType: "certificate", resourceId: id };
}

function urlFor(id: string): string {
  return `https://example.com/api/certificates/${id}`;
}

function baseCandidate(id: string): Omit<CandidateInsertInput, "operations" | "hasRequiredAuth" | "undetermined"> {
  return {
    scanner: "XSS",
    resourceKey: resourceFor(id),
    resourceUrl: urlFor(id),
    writeMethod: "PATCH",
    fieldPath: "certificateText",
    minConfidence: "MEDIUM",
    isPassiveTest: false,
    inScope: true,
    requiresOwnershipData: false,
    hasOwnershipData: false,
    advancedOverrideConfirmed: false,
    environmentPolicyAllows: true,
    localFixtureDenylistOverrideActive: false,
  };
}

describe("computeCoverage", () => {
  it("reports discovered/tested/skipped-by-reason/inconclusive counts correctly for 12 Stored XSS candidates", () => {
    const { db, scanRunId } = freshScanRun();

    const fullOperationsFor = (id: string): DiscoveredOperation[] => [
      { method: "GET", url: urlFor(id), source: "OPENAPI", confidence: "HIGH" },
      { method: "PATCH", url: urlFor(id), source: "OPENAPI", confidence: "HIGH" },
    ];
    const readOnlyOperationsFor = (id: string): DiscoveredOperation[] => [
      { method: "GET", url: urlFor(id), source: "OPENAPI", confidence: "HIGH" },
    ];

    // 4 TESTABLE candidates — every precondition satisfied.
    for (let i = 0; i < 4; i++) {
      const id = `tested-${i}`;
      addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: id });
      insertCandidate(db, scanRunId, { ...baseCandidate(id), operations: fullOperationsFor(id), hasRequiredAuth: true });
    }

    // 5 SKIPPED_NO_WRITE_TEMPLATE — no discovered PATCH operation.
    for (let i = 0; i < 5; i++) {
      const id = `no-write-template-${i}`;
      insertCandidate(db, scanRunId, { ...baseCandidate(id), operations: readOnlyOperationsFor(id), hasRequiredAuth: true });
    }

    // 2 SKIPPED_NO_AUTH — no authentication profile available.
    for (let i = 0; i < 2; i++) {
      const id = `no-auth-${i}`;
      insertCandidate(db, scanRunId, { ...baseCandidate(id), operations: fullOperationsFor(id), hasRequiredAuth: false });
    }

    // 1 INCONCLUSIVE.
    insertCandidate(db, scanRunId, {
      ...baseCandidate("inconclusive-0"),
      operations: fullOperationsFor("inconclusive-0"),
      hasRequiredAuth: true,
      undetermined: true,
    });

    const coverage = computeCoverage(db, scanRunId);
    expect(coverage).toHaveLength(1);
    const xss = coverage[0]!;

    expect(xss.scanner).toBe("XSS");
    expect(xss.discovered).toBe(12);
    expect(xss.tested).toBe(4);
    expect(xss.skippedByReason.SKIPPED_NO_WRITE_TEMPLATE).toBe(5);
    expect(xss.skippedByReason.SKIPPED_NO_AUTH).toBe(2);
    expect(xss.inconclusive).toBe(1);
    expect(xss.passiveOnly).toBe(0);
  });

  it("aggregates separately per scanner", () => {
    const { db, scanRunId } = freshScanRun();
    const fullOps = (id: string): DiscoveredOperation[] => [
      { method: "GET", url: urlFor(id), source: "OPENAPI", confidence: "HIGH" },
      { method: "PATCH", url: urlFor(id), source: "OPENAPI", confidence: "HIGH" },
    ];

    addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: "xss-1" });
    insertCandidate(db, scanRunId, { ...baseCandidate("xss-1"), scanner: "XSS", operations: fullOps("xss-1"), hasRequiredAuth: true });

    addMutationScopeEntry(db, { targetId: 1, objectType: "certificate", resourceId: "gtm-1" });
    insertCandidate(db, scanRunId, { ...baseCandidate("gtm-1"), scanner: "GTM", operations: fullOps("gtm-1"), hasRequiredAuth: true });

    const coverage = computeCoverage(db, scanRunId);
    expect(coverage.map((c) => c.scanner)).toEqual(["GTM", "XSS"]);
    expect(coverage.find((c) => c.scanner === "XSS")!.tested).toBe(1);
    expect(coverage.find((c) => c.scanner === "GTM")!.tested).toBe(1);
  });

  it("returns an empty array for a scan run with no candidates", () => {
    const { db, scanRunId } = freshScanRun();
    expect(computeCoverage(db, scanRunId)).toEqual([]);
  });
});
