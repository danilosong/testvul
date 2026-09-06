import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { createBusinessExpectation } from "./business-expectations-repository";
import { validateServerControlledField } from "./server-controlled-field-validation";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number; targetId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-server-controlled-field-validation-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1, targetId: 1 };
}

const clientHonoredProbe = async () => ({ attemptedValue: 424242, resultingValue: 424242 }); // client-supplied value honored verbatim

describe("validateServerControlledField (Section 13.9)", () => {
  it("raises a SERVER_CONTROLLED_FIELD finding when the field is observed CLIENT_CONTROLLED but a SERVER-authority expectation is configured", async () => {
    const { db, scanRunId, targetId } = freshScanRun();
    createBusinessExpectation(db, {
      targetId,
      objectType: "Ticket",
      propertyOrAction: "number.control",
      expectationType: "AUTHORITY",
      expectedValue: "SERVER_CONTROLLED",
      severity: "HIGH",
    });

    const outcome = await validateServerControlledField({
      db,
      scanRunId,
      targetId,
      objectType: "Ticket",
      fieldName: "number",
      targetEnvironment: "LOCAL_FIXTURE",
      isFinancialOrDangerous: false,
      currentObjectState: {},
      attemptMutatingProbe: clientHonoredProbe,
    });

    expect(outcome).toEqual({ status: "VALIDATED", control: "CLIENT_CONTROLLED", comparison: "CONTRADICTION", finding: true });
  });

  it("produces only INCONCLUSIVE_BUSINESS_EXPECTATION for the identical observation when no AUTHORITY expectation is configured — never a finding", async () => {
    const { db, scanRunId, targetId } = freshScanRun();

    const outcome = await validateServerControlledField({
      db,
      scanRunId,
      targetId,
      objectType: "Ticket",
      fieldName: "number",
      targetEnvironment: "LOCAL_FIXTURE",
      isFinancialOrDangerous: false,
      currentObjectState: {},
      attemptMutatingProbe: clientHonoredProbe,
    });

    expect(outcome).toEqual({ status: "VALIDATED", control: "CLIENT_CONTROLLED", comparison: "INCONCLUSIVE_BUSINESS_EXPECTATION", finding: false });
  });

  it("never raises a finding when the observed control matches the configured expectation", async () => {
    const { db, scanRunId, targetId } = freshScanRun();
    createBusinessExpectation(db, {
      targetId,
      objectType: "Ticket",
      propertyOrAction: "number.control",
      expectationType: "AUTHORITY",
      expectedValue: "CLIENT_CONTROLLED",
      severity: "LOW",
    });

    const outcome = await validateServerControlledField({
      db,
      scanRunId,
      targetId,
      objectType: "Ticket",
      fieldName: "number",
      targetEnvironment: "LOCAL_FIXTURE",
      isFinancialOrDangerous: false,
      currentObjectState: {},
      attemptMutatingProbe: clientHonoredProbe,
    });

    expect(outcome).toEqual({ status: "VALIDATED", control: "CLIENT_CONTROLLED", comparison: "MATCH", finding: false });
  });

  it.each(["DEVELOPMENT", "STAGING", "PRODUCTION"] as const)(
    "never invokes attemptMutatingProbe for a financial/dangerous field against a target classified %s",
    async (targetEnvironment) => {
      const { db, scanRunId, targetId } = freshScanRun();
      let attempted = false;

      const outcome = await validateServerControlledField({
        db,
        scanRunId,
        targetId,
        objectType: "Campaign",
        fieldName: "winningNumber",
        targetEnvironment,
        isFinancialOrDangerous: true,
        currentObjectState: {},
        attemptMutatingProbe: async () => {
          attempted = true;
          return { attemptedValue: 1, resultingValue: 1 };
        },
      });

      expect(attempted).toBe(false);
      expect(outcome).toEqual({ status: "SKIPPED_NOT_LOCAL_FIXTURE" });
    },
  );
});
