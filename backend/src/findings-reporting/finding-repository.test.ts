import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { listFindings, recordFinding } from "./finding-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-finding-repo-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("finding-repository (Section 15.1)", () => {
  it("persists and reads back a technical finding with no business-logic taxonomy", () => {
    const { db, scanRunId } = freshScanRun();
    const id = recordFinding(db, {
      scanRunId,
      title: "Stored XSS",
      severity: "HIGH",
      evidentiaryOutcome: "PROVEN_VULNERABLE",
      targetEndpoint: "https://example.com/api/projects/1",
      fieldPath: "notes",
    });

    const findings = listFindings(db, scanRunId);
    expect(findings).toEqual([
      {
        id,
        scanRunId,
        title: "Stored XSS",
        severity: "HIGH",
        evidentiaryOutcome: "PROVEN_VULNERABLE",
        targetEndpoint: "https://example.com/api/projects/1",
        fieldPath: "notes",
      },
    ]);
  });

  it("persists and reads back a business-logic finding with its full taxonomy", () => {
    const { db, scanRunId } = freshScanRun();
    const id = recordFinding(db, {
      scanRunId,
      title: "Ticket.number changed after PAID",
      severity: "HIGH",
      evidentiaryOutcome: "PROVEN_VULNERABLE",
      category: "INVALID_STATE_TRANSITION",
      confidence: "HIGH",
      proofLevel: "CONFIRMED",
    });

    const findings = listFindings(db, scanRunId);
    expect(findings).toEqual([
      {
        id,
        scanRunId,
        title: "Ticket.number changed after PAID",
        severity: "HIGH",
        evidentiaryOutcome: "PROVEN_VULNERABLE",
        category: "INVALID_STATE_TRANSITION",
        confidence: "HIGH",
        proofLevel: "CONFIRMED",
      },
    ]);
  });
});
