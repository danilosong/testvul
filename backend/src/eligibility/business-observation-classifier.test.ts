import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { classifyBusinessObservation, hasMatchingBusinessExpectation } from "./business-observation-classifier";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshTarget(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-business-obs-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  return db;
}

describe("classifyBusinessObservation", () => {
  it("classifies an unmatched observation as INCONCLUSIVE_BUSINESS_EXPECTATION rather than silently omitting it or treating it as a finding", () => {
    const db = freshTarget();
    // No business_expectations row configured for this (objectType, property) pair at all.
    const result = classifyBusinessObservation(db, { targetId: 1, objectType: "project", propertyOrAction: "isPublic" });
    expect(result).toBe("INCONCLUSIVE_BUSINESS_EXPECTATION");
  });

  it("classifies a matched observation as TESTABLE, deferring the actual comparison to business-logic-testing", () => {
    const db = freshTarget();
    db.prepare(
      `INSERT INTO business_expectations (target_id, object_type, property_or_action, expectation_type, expected_value, severity)
       VALUES (1, 'project', 'isPublic', 'VISIBILITY', 'false', 'HIGH')`,
    ).run();

    const result = classifyBusinessObservation(db, { targetId: 1, objectType: "project", propertyOrAction: "isPublic" });
    expect(result).toBe("TESTABLE");
  });

  it("hasMatchingBusinessExpectation is scoped per target — a match on a different target doesn't count", () => {
    const db = freshTarget();
    db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t2', 'other.example.com', '[]')").run();
    db.prepare(
      `INSERT INTO business_expectations (target_id, object_type, property_or_action, expectation_type, expected_value, severity)
       VALUES (2, 'project', 'isPublic', 'VISIBILITY', 'false', 'HIGH')`,
    ).run();

    expect(hasMatchingBusinessExpectation(db, { targetId: 1, objectType: "project", propertyOrAction: "isPublic" })).toBe(false);
  });
});
