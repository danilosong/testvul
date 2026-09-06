import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { recordFinding } from "../findings-reporting/finding-repository";
import { listBrowserEvidenceForFinding, recordBrowserEvidence } from "./browser-evidence-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-browser-evidence-repo-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("browser-evidence-repository (Section 15.5)", () => {
  it("persists and reads back which browser page/API call/result combination proved a finding", () => {
    const { db, scanRunId } = freshScanRun();
    const findingId = recordFinding(db, { scanRunId, title: "GTM changed via browser-observed API call", severity: "HIGH", evidentiaryOutcome: "PROVEN_VULNERABLE" });

    recordBrowserEvidence(db, {
      scanRunId,
      findingId,
      kind: "DOM_SNAPSHOT",
      structuralData: {
        pageUrl: "https://example.com/app/projects/1",
        apiCall: { method: "PATCH", url: "https://example.com/api/projects/1" },
        result: "analyticsGtm changed to GTM-SECURITYTEST and reflected in the page's own gtm.js script tag",
      },
    });

    const evidence = listBrowserEvidenceForFinding(db, findingId);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.kind).toBe("DOM_SNAPSHOT");
    expect(evidence[0]?.structuralData).toEqual({
      pageUrl: "https://example.com/app/projects/1",
      apiCall: { method: "PATCH", url: "https://example.com/api/projects/1" },
      result: "analyticsGtm changed to GTM-SECURITYTEST and reflected in the page's own gtm.js script tag",
    });
  });

  it("is empty for a purely API-driven finding with no browser evidence at all", () => {
    const { db, scanRunId } = freshScanRun();
    const findingId = recordFinding(db, { scanRunId, title: "Stored XSS", severity: "HIGH", evidentiaryOutcome: "PROVEN_VULNERABLE" });
    expect(listBrowserEvidenceForFinding(db, findingId)).toEqual([]);
  });
});
