import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { recordDiscoveredEndpoint } from "./discovered-endpoints-repository";
import { listDiscoveredFieldsForEndpoint, recordDiscoveredField } from "./discovered-fields-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-discovered-fields-repo-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("discovered-fields-repository (Section 15.4)", () => {
  it("persists a field tied to its endpoint and reads it back", () => {
    const { db, scanRunId } = freshScanRun();
    const endpointId = recordDiscoveredEndpoint(db, scanRunId, { url: "https://example.com/api/projects/1", method: "GET" }, "STATIC");
    recordDiscoveredField(db, scanRunId, endpointId, "notes", "HTML", "<p>...</p>");
    recordDiscoveredField(db, scanRunId, endpointId, "owner", "IDENTIFIER");

    const fields = listDiscoveredFieldsForEndpoint(db, endpointId);
    expect(fields).toHaveLength(2);
    expect(fields.map((f) => f.fieldPath).sort()).toEqual(["notes", "owner"]);
  });

  it("scopes strictly by endpoint — one endpoint's fields never leak into another's list", () => {
    const { db, scanRunId } = freshScanRun();
    const endpointA = recordDiscoveredEndpoint(db, scanRunId, { url: "https://example.com/api/a", method: "GET" }, "STATIC");
    const endpointB = recordDiscoveredEndpoint(db, scanRunId, { url: "https://example.com/api/b", method: "GET" }, "STATIC");
    recordDiscoveredField(db, scanRunId, endpointA, "x", "GENERIC_STRING");
    recordDiscoveredField(db, scanRunId, endpointB, "y", "GENERIC_STRING");

    expect(listDiscoveredFieldsForEndpoint(db, endpointA)).toHaveLength(1);
    expect(listDiscoveredFieldsForEndpoint(db, endpointB)).toHaveLength(1);
  });
});
