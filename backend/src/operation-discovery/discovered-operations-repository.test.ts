import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { registerDiscoveredOperation, getDiscoveredOperations } from "./discovered-operations-repository";
import type { DiscoveredOperation } from "./discovered-operation";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-operations-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("registerDiscoveredOperation / getDiscoveredOperations", () => {
  it("round-trips an operation including its schemas", () => {
    const { db, scanRunId } = freshScanRun();
    const operation: DiscoveredOperation = {
      method: "PATCH",
      url: "/api/settings",
      contentType: "application/json",
      requestSchema: { type: "object", properties: { quantity: { type: "number" } } },
      source: "OPENAPI",
      confidence: "HIGH",
    };

    registerDiscoveredOperation(db, scanRunId, operation);
    const results = getDiscoveredOperations(db, scanRunId);

    expect(results).toEqual([operation]);
  });

  it("round-trips an operation with no schema/content-type", () => {
    const { db, scanRunId } = freshScanRun();
    const operation: DiscoveredOperation = { method: "PUT", url: "/api/project/1", source: "MANUAL", confidence: "HIGH" };

    registerDiscoveredOperation(db, scanRunId, operation);
    expect(getDiscoveredOperations(db, scanRunId)).toEqual([operation]);
  });

  it("only returns operations for the requested scan run", () => {
    const { db, scanRunId } = freshScanRun();
    db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
    registerDiscoveredOperation(db, scanRunId, { method: "GET", url: "/a", source: "MANUAL", confidence: "HIGH" });
    registerDiscoveredOperation(db, 2, { method: "GET", url: "/b", source: "MANUAL", confidence: "HIGH" });

    expect(getDiscoveredOperations(db, scanRunId)).toHaveLength(1);
    expect(getDiscoveredOperations(db, 2)).toHaveLength(1);
  });
});
