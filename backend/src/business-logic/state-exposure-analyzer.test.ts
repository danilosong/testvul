import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { createBusinessExpectation } from "./business-expectations-repository";
import { listObservedProperties } from "./business-observed-properties-repository";
import { analyzeStateExposure, isCredentialShapedKey, recordStateExposureObservation } from "./state-exposure-analyzer";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

describe("isCredentialShapedKey", () => {
  it.each(["token", "accessToken", "refreshToken", "authorization", "session", "jwt", "secret", "apiKey"])(
    "recognizes %s as credential-shaped",
    (keyName) => {
      expect(isCredentialShapedKey(keyName)).toBe(true);
    },
  );

  it("does not flag an ordinary business field name", () => {
    expect(isCredentialShapedKey("currentLowestEligibleNumber")).toBe(false);
  });
});

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number; targetId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-state-exposure-analyzer-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1, targetId: 1 };
}

describe("analyzeStateExposure (Section 13.10)", () => {
  it("raises a finding when a field is observed PUBLIC while a PRIVATE expectation applies (campaign open)", () => {
    const { db, scanRunId, targetId } = freshScanRun();
    createBusinessExpectation(db, {
      targetId,
      objectType: "Campaign",
      propertyOrAction: "currentLowestEligibleNumber",
      expectationType: "VISIBILITY",
      expectedValue: "PRIVATE",
      lifecycleCondition: { field: "closed", operator: "EQ", value: false },
      severity: "MEDIUM",
    });

    const result = analyzeStateExposure({
      db,
      scanRunId,
      targetId,
      objectType: "Campaign",
      fieldName: "currentLowestEligibleNumber",
      location: "API",
      exposed: true,
      currentObjectState: { closed: false },
    });

    expect(result).toEqual({ credentialShaped: false, comparison: "CONTRADICTION", finding: true });
  });

  it("produces no finding for the same exposure when a PUBLIC expectation is configured instead", () => {
    const { db, scanRunId, targetId } = freshScanRun();
    createBusinessExpectation(db, {
      targetId,
      objectType: "Campaign",
      propertyOrAction: "currentLowestEligibleNumber",
      expectationType: "VISIBILITY",
      expectedValue: "PUBLIC",
      severity: "MEDIUM",
    });

    const result = analyzeStateExposure({
      db,
      scanRunId,
      targetId,
      objectType: "Campaign",
      fieldName: "currentLowestEligibleNumber",
      location: "API",
      exposed: true,
      currentObjectState: { closed: false },
    });

    expect(result).toEqual({ credentialShaped: false, comparison: "MATCH", finding: false });
  });

  it("produces no finding for the same exposure once the campaign is closed — the PRIVATE-while-open expectation no longer applies", () => {
    const { db, scanRunId, targetId } = freshScanRun();
    createBusinessExpectation(db, {
      targetId,
      objectType: "Campaign",
      propertyOrAction: "currentLowestEligibleNumber",
      expectationType: "VISIBILITY",
      expectedValue: "PRIVATE",
      lifecycleCondition: { field: "closed", operator: "EQ", value: false },
      severity: "MEDIUM",
    });

    const result = analyzeStateExposure({
      db,
      scanRunId,
      targetId,
      objectType: "Campaign",
      fieldName: "currentLowestEligibleNumber",
      location: "API",
      exposed: true,
      currentObjectState: { closed: true },
    });

    expect(result).toEqual({ credentialShaped: false, comparison: "INCONCLUSIVE_BUSINESS_EXPECTATION", finding: false });
  });

  it("never raises a finding for a credential-shaped key, even with a configured VISIBILITY expectation that would otherwise contradict", () => {
    const { db, scanRunId, targetId } = freshScanRun();
    createBusinessExpectation(db, {
      targetId,
      objectType: "Session",
      propertyOrAction: "accessToken",
      expectationType: "VISIBILITY",
      expectedValue: "PRIVATE",
      severity: "CRITICAL",
    });

    const result = analyzeStateExposure({
      db,
      scanRunId,
      targetId,
      objectType: "Session",
      fieldName: "accessToken",
      location: "BROWSER_STORAGE",
      exposed: true,
      rawValue: "eyJhbGciOiJIUzI1NiJ9.super-secret-value",
      currentObjectState: {},
    });

    expect(result).toEqual({ credentialShaped: true });
  });

  it("persists only key-name presence and a fingerprint for a credential-shaped key — never the raw value", () => {
    const { db, scanRunId } = freshScanRun();
    recordStateExposureObservation({
      db,
      scanRunId,
      objectType: "Session",
      fieldName: "accessToken",
      location: "BROWSER_STORAGE",
      exposed: true,
      rawValue: "eyJhbGciOiJIUzI1NiJ9.super-secret-value",
    });

    const stored = listObservedProperties(db, scanRunId, "Session", "accessToken");
    expect(stored).toHaveLength(1);
    const observed = stored[0]?.observedValue as { keyPresent: boolean; fingerprint: string };
    expect(observed.keyPresent).toBe(true);
    expect(observed.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(observed)).not.toContain("super-secret-value");
  });
});
