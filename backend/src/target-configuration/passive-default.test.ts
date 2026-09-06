import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { createNewSecurityAudit } from "./new-security-audit";
import { getTarget } from "./targets-repository";
import { createScanRun } from "../scan-orchestration/scan-run-config-snapshot";
import { runIfScanModeAllows } from "../scan-orchestration/scan-mode-gate";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-passive-default-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe("Section 16.5 — an audit created without specifying a mode defaults to Passive and performs no mutating requests of any kind", () => {
  it("defaults the target's scan mode to Passive, never Safe Automatic", () => {
    const db = freshDb();
    const targetId = createNewSecurityAudit(db, { projectName: "My Project", targetDns: "example.com" });
    const target = getTarget(db, targetId);
    expect(target?.defaultScanMode).toBe("PASSIVE");
    expect(target?.rateLimitRps).toBe(2);
    expect(target?.scope).toEqual(["example.com"]);
  });

  it("a scan run created from that target performs no mutating requests across API, browser, or business-logic test types", async () => {
    const db = freshDb();
    const targetId = createNewSecurityAudit(db, { projectName: "My Project", targetDns: "example.com" });
    const { scanRunId } = createScanRun(db, { targetId });

    const apiMutation = vi.fn();
    const browserMutation = vi.fn();
    const businessLogicMutation = vi.fn();

    const apiResult = await runIfScanModeAllows({ db, scanRunId, isDestructive: false, performMutation: apiMutation });
    const browserResult = await runIfScanModeAllows({ db, scanRunId, isDestructive: false, performMutation: browserMutation });
    const businessLogicResult = await runIfScanModeAllows({ db, scanRunId, isDestructive: false, performMutation: businessLogicMutation });

    expect(apiMutation).not.toHaveBeenCalled();
    expect(browserMutation).not.toHaveBeenCalled();
    expect(businessLogicMutation).not.toHaveBeenCalled();
    expect(apiResult).toEqual({ status: "BLOCKED_PASSIVE_MODE" });
    expect(browserResult).toEqual({ status: "BLOCKED_PASSIVE_MODE" });
    expect(businessLogicResult).toEqual({ status: "BLOCKED_PASSIVE_MODE" });
  });
});
