import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import {
  createBusinessExpectation,
  deleteBusinessExpectation,
  getBusinessExpectations,
  InvalidLifecycleConditionError,
  listBusinessExpectationsForTarget,
  updateBusinessExpectation,
} from "./business-expectations-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshTarget(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-business-expectations-repo-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  return db;
}

const BASE_INPUT = {
  targetId: 1,
  objectType: "Campaign",
  propertyOrAction: "leadingNumberVisibility",
  expectationType: "VISIBILITY" as const,
  expectedValue: "PUBLIC",
  severity: "HIGH" as const,
};

describe("createBusinessExpectation — saving a malicious lifecycleCondition is rejected as invalid input and never executed", () => {
  it.each(["process.exit()", "require('fs')", "constructor.constructor('return process')()", "1 == 1"])(
    "rejects %j",
    (maliciousString) => {
      const db = freshTarget();
      expect(() => createBusinessExpectation(db, { ...BASE_INPUT, lifecycleCondition: maliciousString })).toThrow(
        InvalidLifecycleConditionError,
      );
      expect(getBusinessExpectations(db, 1, "Campaign", "leadingNumberVisibility")).toEqual([]);
    },
  );

  it("accepts and persists a valid lifecycleCondition", () => {
    const db = freshTarget();
    createBusinessExpectation(db, { ...BASE_INPUT, lifecycleCondition: { field: "closed", operator: "EQ", value: true } });
    const [expectation] = getBusinessExpectations(db, 1, "Campaign", "leadingNumberVisibility");
    expect(expectation?.lifecycleCondition).toEqual({ field: "closed", operator: "EQ", value: true });
  });
});

describe("listBusinessExpectationsForTarget / updateBusinessExpectation / deleteBusinessExpectation (Section 13.22)", () => {
  it("lists every configured expectation for a target across all object types", () => {
    const db = freshTarget();
    createBusinessExpectation(db, BASE_INPUT);
    createBusinessExpectation(db, { ...BASE_INPUT, objectType: "Ticket", propertyOrAction: "number.control", expectationType: "AUTHORITY", expectedValue: "SERVER_CONTROLLED" });
    expect(listBusinessExpectationsForTarget(db, 1)).toHaveLength(2);
  });

  it("updates only the fields provided, preserving the rest", () => {
    const db = freshTarget();
    const id = createBusinessExpectation(db, BASE_INPUT);
    updateBusinessExpectation(db, id, { severity: "CRITICAL" });
    const [expectation] = listBusinessExpectationsForTarget(db, 1);
    expect(expectation?.severity).toBe("CRITICAL");
    expect(expectation?.expectedValue).toBe(BASE_INPUT.expectedValue);
  });

  it("rejects an update carrying an invalid lifecycleCondition before persisting anything", () => {
    const db = freshTarget();
    const id = createBusinessExpectation(db, BASE_INPUT);
    expect(() => updateBusinessExpectation(db, id, { lifecycleCondition: "process.exit()" })).toThrow(InvalidLifecycleConditionError);
    const [expectation] = listBusinessExpectationsForTarget(db, 1);
    expect(expectation?.lifecycleCondition).toBeUndefined();
  });

  it("deletes a configured expectation", () => {
    const db = freshTarget();
    const id = createBusinessExpectation(db, BASE_INPUT);
    deleteBusinessExpectation(db, id);
    expect(listBusinessExpectationsForTarget(db, 1)).toEqual([]);
  });
});
