import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { assessReversibility, assertReversibilityProven, ReversibilityNotProvenError } from "./reversibility";
import { recordJournalState } from "./mutation-journal-repository";
import { tryAcquireLock } from "./resource-lock-repository";
import type { ResourceKey } from "./resource-key";
import type { DiscoveredOperation } from "../operation-discovery/discovered-operation";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-reversibility-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return db;
}

const RESOURCE: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "123" };
const RESOURCE_URL = "https://example.com/api/projects/123";
const FULL_OPERATIONS: DiscoveredOperation[] = [
  { method: "GET", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" },
  { method: "PATCH", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" },
];

describe("assessReversibility", () => {
  it("proves reversibility when all six preconditions hold", () => {
    const db = freshScanRun();
    const result = assessReversibility({
      db,
      resourceKey: RESOURCE,
      operations: FULL_OPERATIONS,
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      minConfidence: "MEDIUM",
    });
    expect(result).toEqual({ proven: true, missing: [] });
  });

  it("flags KNOWN_PRE_STATE and FEASIBLE_RESTORE_VERIFICATION as missing with no discovered GET operation", () => {
    const db = freshScanRun();
    const result = assessReversibility({
      db,
      resourceKey: RESOURCE,
      operations: [{ method: "PATCH", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" }],
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      minConfidence: "MEDIUM",
    });
    expect(result.proven).toBe(false);
    expect(result.missing).toContain("KNOWN_PRE_STATE");
    expect(result.missing).toContain("FEASIBLE_RESTORE_VERIFICATION");
  });

  it("flags KNOWN_OPERATION as missing with no eligible write operation", () => {
    const db = freshScanRun();
    const result = assessReversibility({
      db,
      resourceKey: RESOURCE,
      operations: [{ method: "GET", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" }],
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      minConfidence: "MEDIUM",
    });
    expect(result.missing).toEqual(["KNOWN_OPERATION"]);
  });

  it("flags KNOWN_RESTORE_STRATEGY as missing for a non-restorable write method (e.g. a create-only POST)", () => {
    const db = freshScanRun();
    const result = assessReversibility({
      db,
      resourceKey: RESOURCE,
      operations: [
        { method: "GET", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" },
        { method: "POST", url: RESOURCE_URL, source: "OPENAPI", confidence: "HIGH" },
      ],
      resourceUrl: RESOURCE_URL,
      writeMethod: "POST",
      minConfidence: "MEDIUM",
    });
    expect(result.missing).toContain("KNOWN_RESTORE_STRATEGY");
  });

  it("flags AVAILABLE_RESOURCE_LOCK as missing when another holder currently holds the lock", () => {
    const db = freshScanRun();
    tryAcquireLock(db, RESOURCE, "API:OTHER_SCANNER", 60_000);
    const result = assessReversibility({
      db,
      resourceKey: RESOURCE,
      operations: FULL_OPERATIONS,
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      minConfidence: "MEDIUM",
    });
    expect(result.missing).toEqual(["AVAILABLE_RESOURCE_LOCK"]);
  });

  it("flags both AVAILABLE_RESOURCE_LOCK and AVAILABLE_JOURNAL_ENTRY as missing when the resource is frozen", () => {
    const db = freshScanRun();
    recordJournalState(db, 1, RESOURCE, "API", "RESTORE_CONFLICT");
    const result = assessReversibility({
      db,
      resourceKey: RESOURCE,
      operations: FULL_OPERATIONS,
      resourceUrl: RESOURCE_URL,
      writeMethod: "PATCH",
      minConfidence: "MEDIUM",
    });
    expect(result.missing).toEqual(expect.arrayContaining(["AVAILABLE_RESOURCE_LOCK", "AVAILABLE_JOURNAL_ENTRY"]));
  });
});

describe("assertReversibilityProven", () => {
  it("throws ReversibilityNotProvenError when a precondition is missing", () => {
    const db = freshScanRun();
    expect(() =>
      assertReversibilityProven({
        db,
        resourceKey: RESOURCE,
        operations: [],
        resourceUrl: RESOURCE_URL,
        writeMethod: "PATCH",
        minConfidence: "MEDIUM",
      }),
    ).toThrow(ReversibilityNotProvenError);
  });

  it("does not throw when every precondition is present", () => {
    const db = freshScanRun();
    expect(() =>
      assertReversibilityProven({
        db,
        resourceKey: RESOURCE,
        operations: FULL_OPERATIONS,
        resourceUrl: RESOURCE_URL,
        writeMethod: "PATCH",
        minConfidence: "MEDIUM",
      }),
    ).not.toThrow();
  });
});
