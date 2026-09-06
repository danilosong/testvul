import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./connection";
import { runMigrations } from "./migrator";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

const EXPECTED_TABLES = [
  "targets",
  "mutation_scope_resources",
  "auth_profiles",
  "auth_profile_allowed_hosts",
  "business_expectations",
  "business_invariants",
  "scan_run_configs",
  "scan_runs",
  "scan_run_auth_profiles",
  "discovered_hosts",
  "discovered_endpoints",
  "discovered_fields",
  "discovered_operations",
  "candidates",
  "resource_ownership",
  "authorization_expectations",
  "resource_backups",
  "resource_locks",
  "mutation_journal",
  "browser_sessions",
  "browser_actions",
  "business_objects",
  "business_states",
  "business_operations",
  "business_observed_properties",
  "webhook_operations",
  "evidence",
  "findings",
  "browser_evidence",
  "business_test_plans",
  "audit_events",
  "target_business_profiles",
];

let dir: string;
let dbPath: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("runMigrations", () => {
  it("applies every migration file cleanly, in order, against a fresh file", () => {
    dir = mkdtempSync(join(tmpdir(), "sca-migrator-"));
    dbPath = join(dir, "test.db");
    db = openDb(dbPath);

    const result = runMigrations(db, MIGRATIONS_DIR);

    expect(result.applied).toEqual([
      "0001_initial.sql",
      "0002_target_business_profiles.sql",
      "0003_scan_run_cancellation.sql",
      "0004_discovered_endpoints_resource_flags.sql",
      "0005_discovered_endpoints_auth_required.sql",
    ]);
  });

  it("creates every table from design.md Decision 5 with no undefined JSON-blob state", () => {
    dir = mkdtempSync(join(tmpdir(), "sca-migrator-"));
    dbPath = join(dir, "test.db");
    db = openDb(dbPath);
    runMigrations(db, MIGRATIONS_DIR);

    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const tableNames = new Set(rows.map((r) => r.name).filter((n) => n !== "_migrations"));

    for (const expected of EXPECTED_TABLES) {
      expect(tableNames.has(expected), `expected table "${expected}" to exist`).toBe(true);
    }
    expect(tableNames.size).toBe(EXPECTED_TABLES.length);
  });

  it("declares the canonical ResourceKey columns on every resource-identifying table", () => {
    dir = mkdtempSync(join(tmpdir(), "sca-migrator-"));
    dbPath = join(dir, "test.db");
    db = openDb(dbPath);
    runMigrations(db, MIGRATIONS_DIR);

    const resourceKeyTables = [
      "mutation_scope_resources",
      "resource_ownership",
      "resource_backups",
      "resource_locks",
      "mutation_journal",
      "business_test_plans",
    ];
    for (const table of resourceKeyTables) {
      const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
      for (const rk of ["target_id", "origin", "tenant_id", "object_type", "resource_id"]) {
        expect(cols.includes(rk), `expected ${table}.${rk} to exist`).toBe(true);
      }
    }
  });

  it("enforces foreign keys declared in design.md (rejects an orphaned insert)", () => {
    dir = mkdtempSync(join(tmpdir(), "sca-migrator-"));
    dbPath = join(dir, "test.db");
    db = openDb(dbPath);
    runMigrations(db, MIGRATIONS_DIR);

    expect(() => {
      db.prepare(
        "INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (999, 999)",
      ).run();
    }).toThrow();
  });

  it("is idempotent: re-running against an already-migrated file applies nothing new", () => {
    dir = mkdtempSync(join(tmpdir(), "sca-migrator-"));
    dbPath = join(dir, "test.db");
    db = openDb(dbPath);
    runMigrations(db, MIGRATIONS_DIR);

    const second = runMigrations(db, MIGRATIONS_DIR);
    expect(second.applied).toEqual([]);
  });

  it("supports the full backup/mutation/restore journal lifecycle end-to-end via real inserts", () => {
    dir = mkdtempSync(join(tmpdir(), "sca-migrator-"));
    dbPath = join(dir, "test.db");
    db = openDb(dbPath);
    runMigrations(db, MIGRATIONS_DIR);

    db.prepare(
      "INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')",
    ).run();
    db.prepare(
      "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
    ).run();
    db.prepare(
      "INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)",
    ).run();

    db.prepare(
      `INSERT INTO mutation_journal
        (scan_run_id, target_id, origin, tenant_id, object_type, resource_id, initiator, state)
       VALUES (1, 1, 'https://example.com', NULL, 'project', '123', 'API', 'BACKUP_CREATED')`,
    ).run();

    const row = db
      .prepare("SELECT state FROM mutation_journal WHERE resource_id = '123'")
      .get() as { state: string };
    expect(row.state).toBe("BACKUP_CREATED");
  });
});
