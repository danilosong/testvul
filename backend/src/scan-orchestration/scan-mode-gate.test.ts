import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { evaluateScanModeGate, getScanMode, isMutationAuthorized, runIfScanModeAllows, type ScanMode } from "./scan-mode-gate";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string | undefined;
let db: Db | undefined;

afterEach(() => {
  if (db) {
    db.close();
    db = undefined;
  }
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

/** scanRunId 1: PASSIVE, unauthorized. scanRunId 2: SAFE_AUTOMATIC, unauthorized. scanRunId 3: SAFE_AUTOMATIC, authorized. scanRunId 4: ADVANCED, authorized. */
function freshFixtureScanRuns(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-scan-mode-gate-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();

  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();

  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 2)").run();

  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment, mutation_authorization_confirmed_by, mutation_authorization_confirmed_at) VALUES (1, '[]', 'SAFE_AUTOMATIC', 2, 'LOCAL_FIXTURE', 'operator@example.com', datetime('now'))",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 3)").run();

  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment, mutation_authorization_confirmed_by, mutation_authorization_confirmed_at) VALUES (1, '[]', 'ADVANCED', 2, 'LOCAL_FIXTURE', 'operator@example.com', datetime('now'))",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 4)").run();

  return db;
}

describe("getScanMode / isMutationAuthorized (Section 14.3)", () => {
  it("reads the scan mode and authorization flag from the immutable configuration snapshot", () => {
    const db = freshFixtureScanRuns();
    expect(getScanMode(db, 1)).toBe("PASSIVE");
    expect(isMutationAuthorized(db, 1)).toBe(false);
    expect(getScanMode(db, 3)).toBe("SAFE_AUTOMATIC");
    expect(isMutationAuthorized(db, 3)).toBe(true);
  });
});

describe("evaluateScanModeGate (Section 14.3)", () => {
  it("blocks a destructive operation unconditionally, in every mode", () => {
    for (const scanMode of ["PASSIVE", "SAFE_AUTOMATIC", "ADVANCED"] as ScanMode[]) {
      expect(evaluateScanModeGate({ scanMode, mutationAuthorizationConfirmed: true, moduleOptedIn: true, isDestructive: true })).toBe(
        "BLOCKED_DESTRUCTIVE",
      );
    }
  });

  it("blocks any mutation in PASSIVE mode, even with authorization confirmed", () => {
    expect(evaluateScanModeGate({ scanMode: "PASSIVE", mutationAuthorizationConfirmed: true, isDestructive: false })).toBe("BLOCKED_PASSIVE_MODE");
  });

  it("blocks SAFE_AUTOMATIC without a confirmed mutation authorization", () => {
    expect(evaluateScanModeGate({ scanMode: "SAFE_AUTOMATIC", mutationAuthorizationConfirmed: false, isDestructive: false })).toBe(
      "BLOCKED_NO_AUTHORIZATION",
    );
  });

  it("allows SAFE_AUTOMATIC once authorized", () => {
    expect(evaluateScanModeGate({ scanMode: "SAFE_AUTOMATIC", mutationAuthorizationConfirmed: true, isDestructive: false })).toBe("ALLOWED");
  });

  it("blocks ADVANCED mode without the module's own explicit opt-in, even when authorized", () => {
    expect(evaluateScanModeGate({ scanMode: "ADVANCED", mutationAuthorizationConfirmed: true, moduleOptedIn: false, isDestructive: false })).toBe(
      "BLOCKED_NOT_OPTED_IN",
    );
  });

  it("allows ADVANCED mode once authorized and opted in", () => {
    expect(evaluateScanModeGate({ scanMode: "ADVANCED", mutationAuthorizationConfirmed: true, moduleOptedIn: true, isDestructive: false })).toBe(
      "ALLOWED",
    );
  });
});

describe("runIfScanModeAllows (Section 14.3) — Passive mode produces zero write requests across all three test types", () => {
  it.each(["API", "BROWSER", "BUSINESS_LOGIC"] as const)("never invokes an API-shaped mutation in PASSIVE mode (%s test type)", async () => {
    const db = freshFixtureScanRuns();
    const performMutation = vi.fn();
    const result = await runIfScanModeAllows({ db, scanRunId: 1, isDestructive: false, performMutation });
    expect(performMutation).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "BLOCKED_PASSIVE_MODE" });
  });

  it("refuses to run any mutating test when the scan-run fixture's authorization flag is unset", async () => {
    const db = freshFixtureScanRuns();
    const performMutation = vi.fn();
    const result = await runIfScanModeAllows({ db, scanRunId: 2, isDestructive: false, performMutation });
    expect(performMutation).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "BLOCKED_NO_AUTHORIZATION" });
  });

  it("runs the mutation once SAFE_AUTOMATIC is authorized", async () => {
    const db = freshFixtureScanRuns();
    const performMutation = vi.fn().mockResolvedValue({ ok: true });
    const result = await runIfScanModeAllows({ db, scanRunId: 3, isDestructive: false, performMutation });
    expect(performMutation).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "EXECUTED", result: { ok: true } });
  });
});
