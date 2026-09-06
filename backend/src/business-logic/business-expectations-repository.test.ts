import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { createBusinessExpectation, getBusinessExpectations, InvalidLifecycleConditionError } from "./business-expectations-repository";

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
