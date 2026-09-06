import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { saveHostCandidates } from "./discovered-hosts-repository";
import type { HostCandidate } from "./host-candidate-discovery";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-discovered-hosts-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

function insertScanRun(db: Db): number {
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return 1;
}

describe("saveHostCandidates", () => {
  it("persists each candidate with its scope decision and discovery source", () => {
    const db = freshDb();
    const scanRunId = insertScanRun(db);
    const candidates: HostCandidate[] = [
      { hostname: "example.com", source: "REDIRECT", inScope: true, queued: true },
      { hostname: "evil.com", source: "TLS_SAN", inScope: false, queued: false },
    ];

    saveHostCandidates(db, scanRunId, candidates);

    const rows = db.prepare("SELECT hostname, in_scope, discovery_source FROM discovered_hosts ORDER BY hostname").all() as {
      hostname: string;
      in_scope: number;
      discovery_source: string;
    }[];
    expect(rows).toEqual([
      { hostname: "evil.com", in_scope: 0, discovery_source: "TLS_SAN" },
      { hostname: "example.com", in_scope: 1, discovery_source: "REDIRECT" },
    ]);
  });
});
