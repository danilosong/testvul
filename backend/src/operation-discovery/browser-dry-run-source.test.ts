import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { hasEligibleOperation, type DiscoveredOperation } from "./discovered-operation";
import { registerDiscoveredOperation, getDiscoveredOperations } from "./discovered-operations-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const DRY_RUN_OPERATION: DiscoveredOperation = {
  method: "PATCH",
  url: "/api/settings",
  contentType: "application/json",
  source: "BROWSER_DRY_RUN",
  confidence: "HIGH",
};

describe("BROWSER_DRY_RUN as a DiscoveredOperation source", () => {
  it("satisfies the eligibility query identically to any other HIGH-confidence source, per the spec scenario", () => {
    expect(hasEligibleOperation([DRY_RUN_OPERATION], "PATCH", "/api/settings", "HIGH")).toBe(true);
    expect(hasEligibleOperation([DRY_RUN_OPERATION], "PATCH", "/api/settings", "MEDIUM")).toBe(true);
  });

  it("registers via the exact same registration function used by every other source", () => {
    dir = mkdtempSync(join(tmpdir(), "sca-dry-run-op-"));
    db = openDb(join(dir, "test.db"));
    runMigrations(db, MIGRATIONS_DIR);
    db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
    db.prepare(
      "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
    ).run();
    db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();

    registerDiscoveredOperation(db, 1, DRY_RUN_OPERATION);

    const stored = getDiscoveredOperations(db, 1);
    expect(stored).toEqual([DRY_RUN_OPERATION]);
  });
});
