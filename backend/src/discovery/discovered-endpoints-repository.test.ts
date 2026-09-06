import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { buildAttackSurface } from "./attack-surface";
import { listDiscoveredEndpointsBySource, listDiscoveredResources, recordDiscoveredEndpoints } from "./discovered-endpoints-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-discovered-endpoints-repo-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("recordDiscoveredEndpoints / listDiscoveredResources (Section 15.3)", () => {
  it("round-trips isPage/isForm/contentType so buildAttackSurface's counts match what was actually discovered", () => {
    const { db, scanRunId } = freshScanRun();
    recordDiscoveredEndpoints(
      db,
      scanRunId,
      [
        { url: "https://example.com/", method: "GET", contentType: "text/html", isPage: true },
        { url: "https://example.com/api/projects/1", method: "GET", contentType: "application/json" },
        { url: "https://example.com/api/projects/1", method: "POST", isForm: true },
      ],
      "STATIC",
    );

    const resources = listDiscoveredResources(db, scanRunId);
    const summary = buildAttackSurface(resources);
    expect(summary.counts.pages).toBe(1);
    expect(summary.counts.forms).toBe(1);
    expect(summary.counts.jsonEndpoints).toBe(1);
  });

  it("persists the discovery source (STATIC/BROWSER/OPENAPI) and classification per endpoint", () => {
    const { db, scanRunId } = freshScanRun();
    recordDiscoveredEndpoints(db, scanRunId, [{ url: "https://example.com/api/admin/users", method: "GET" }], "BROWSER");

    const row = db.prepare("SELECT classification, discovered_via FROM discovered_endpoints WHERE scan_run_id = ?").get(scanRunId) as {
      classification: string;
      discovered_via: string;
    };
    expect(row.classification).toBe("ADMIN");
    expect(row.discovered_via).toBe("BROWSER");
  });

  it("counts endpoints per discovery source", () => {
    const { db, scanRunId } = freshScanRun();
    recordDiscoveredEndpoints(db, scanRunId, [{ url: "https://example.com/a", method: "GET" }], "STATIC");
    recordDiscoveredEndpoints(db, scanRunId, [{ url: "https://example.com/b", method: "GET" }], "BROWSER");
    recordDiscoveredEndpoints(db, scanRunId, [{ url: "https://example.com/c", method: "GET" }], "BROWSER");

    const bySource = listDiscoveredEndpointsBySource(db, scanRunId);
    expect(bySource.sort((a, b) => a.source.localeCompare(b.source))).toEqual([
      { source: "BROWSER", count: 2 },
      { source: "STATIC", count: 1 },
    ]);
  });
});
