import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { createBusinessExpectation } from "./business-expectations-repository";
import { compareObservationAgainstExpectation } from "./business-expectation-comparison";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshTarget(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-business-expectation-comparison-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  return db;
}

describe("compareObservationAgainstExpectation", () => {
  it("an observation with no matching expectation row never produces a finding — INCONCLUSIVE_BUSINESS_EXPECTATION instead", () => {
    const db = freshTarget();
    const result = compareObservationAgainstExpectation({
      db,
      targetId: 1,
      objectType: "Campaign",
      propertyOrAction: "leadingNumberVisibility",
      observedValue: "PUBLIC",
      currentObjectState: {},
    });
    expect(result).toBe("INCONCLUSIVE_BUSINESS_EXPECTATION");
  });

  it("a contradiction between the observed value and the configured expectation produces CONTRADICTION", () => {
    const db = freshTarget();
    createBusinessExpectation(db, {
      targetId: 1,
      objectType: "Campaign",
      propertyOrAction: "leadingNumberVisibility",
      expectationType: "VISIBILITY",
      expectedValue: "PRIVATE_UNTIL_CAMPAIGN_CLOSE",
      severity: "HIGH",
    });

    const result = compareObservationAgainstExpectation({
      db,
      targetId: 1,
      objectType: "Campaign",
      propertyOrAction: "leadingNumberVisibility",
      observedValue: "PUBLIC",
      currentObjectState: {},
    });
    expect(result).toBe("CONTRADICTION");
  });

  it("a matching observed value against the configured expectation produces MATCH", () => {
    const db = freshTarget();
    createBusinessExpectation(db, {
      targetId: 1,
      objectType: "Campaign",
      propertyOrAction: "leadingNumberVisibility",
      expectationType: "VISIBILITY",
      expectedValue: "PUBLIC",
      severity: "HIGH",
    });

    const result = compareObservationAgainstExpectation({
      db,
      targetId: 1,
      objectType: "Campaign",
      propertyOrAction: "leadingNumberVisibility",
      observedValue: "PUBLIC",
      currentObjectState: {},
    });
    expect(result).toBe("MATCH");
  });

  it("a lifecycle-conditioned expectation evaluates differently before and after its condition changes", () => {
    const db = freshTarget();
    createBusinessExpectation(db, {
      targetId: 1,
      objectType: "Campaign",
      propertyOrAction: "leadingNumberVisibility",
      expectationType: "VISIBILITY",
      expectedValue: "PRIVATE_UNTIL_CAMPAIGN_CLOSE",
      lifecycleCondition: { field: "closed", operator: "EQ", value: false },
      severity: "HIGH",
    });

    // Before: campaign still open — the lifecycleCondition holds, so the
    // expectation applies, and the observed PUBLIC value contradicts it.
    const beforeClose = compareObservationAgainstExpectation({
      db,
      targetId: 1,
      objectType: "Campaign",
      propertyOrAction: "leadingNumberVisibility",
      observedValue: "PUBLIC",
      currentObjectState: { closed: false },
    });
    expect(beforeClose).toBe("CONTRADICTION");

    // After: campaign closed — the lifecycleCondition no longer holds, so
    // this expectation doesn't apply at all anymore.
    const afterClose = compareObservationAgainstExpectation({
      db,
      targetId: 1,
      objectType: "Campaign",
      propertyOrAction: "leadingNumberVisibility",
      observedValue: "PUBLIC",
      currentObjectState: { closed: true },
    });
    expect(afterClose).toBe("INCONCLUSIVE_BUSINESS_EXPECTATION");
  });
});
