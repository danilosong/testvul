import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { registerObservedMutations } from "./browser-runtime-operations";
import { getDiscoveredOperations } from "../operation-discovery/discovered-operations-repository";
import { ScopeValidator } from "../scope";
import type { ObservedRequest } from "./network-observer";

const SCOPE = new ScopeValidator(["example.com"]);

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-browser-runtime-ops-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("registerObservedMutations", () => {
  it("an observed PATCH /api/project/123/settings produces the expected DiscoveredOperation", () => {
    const { db, scanRunId } = freshScanRun();
    const observations: ObservedRequest[] = [
      { method: "PATCH", url: "https://example.com/api/project/123/settings", resourceType: "fetch", headers: { "content-type": "application/json" } },
    ];

    registerObservedMutations(db, scanRunId, observations, SCOPE);

    const operations = getDiscoveredOperations(db, scanRunId);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      method: "PATCH",
      url: "https://example.com/api/project/123/settings",
      source: "BROWSER_RUNTIME",
      confidence: "HIGH",
    });
  });

  it("an observed Authorization header is masked in the persisted observation", () => {
    const { db, scanRunId } = freshScanRun();
    const observations: ObservedRequest[] = [
      {
        method: "POST",
        url: "https://example.com/api/orders",
        resourceType: "xhr",
        headers: { authorization: "Bearer super-secret-session-token", "content-type": "application/json" },
      },
    ];

    registerObservedMutations(db, scanRunId, observations, SCOPE);

    const [operation] = getDiscoveredOperations(db, scanRunId);
    const persistedHeaders = (operation!.requestSchema as { headers: Record<string, string> }).headers;
    expect(persistedHeaders.authorization).not.toBe("Bearer super-secret-session-token");
    expect(JSON.stringify(persistedHeaders)).not.toContain("super-secret-session-token");
  });

  it("skips a non-mutating (GET) observation — it is never registered as an operation", () => {
    const { db, scanRunId } = freshScanRun();
    registerObservedMutations(
      db,
      scanRunId,
      [{ method: "GET", url: "https://example.com/api/projects", resourceType: "fetch", headers: {} }],
      SCOPE,
    );
    expect(getDiscoveredOperations(db, scanRunId)).toEqual([]);
  });

  it("skips a mutating request whose resource type isn't a real navigational/XHR/fetch call (e.g. an image)", () => {
    const { db, scanRunId } = freshScanRun();
    registerObservedMutations(
      db,
      scanRunId,
      [{ method: "POST", url: "https://example.com/tracking-pixel.gif", resourceType: "image", headers: {} }],
      SCOPE,
    );
    expect(getDiscoveredOperations(db, scanRunId)).toEqual([]);
  });

  it("skips an observed mutation to a third-party (out-of-scope) domain — never treated as authorized just because the browser reached it", () => {
    const { db, scanRunId } = freshScanRun();
    registerObservedMutations(
      db,
      scanRunId,
      [{ method: "POST", url: "https://third-party-tracker.example.net/beacon", resourceType: "fetch", headers: {} }],
      SCOPE, // only "example.com" is in scope
    );
    expect(getDiscoveredOperations(db, scanRunId)).toEqual([]);
  });
});
