import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { recordBrowserEvidence } from "../browser/browser-evidence-repository";
import { recordFinding, listFindings } from "./finding-repository";
import { getFindingDetail } from "./finding-detail";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-finding-detail-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('Fixture App', '127.0.0.1', '[]')").run();
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('userA', 'BEARER')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 2, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("getFindingDetail (Section 15.5) — all fields render correctly for a sample finding of each kind", () => {
  it("a technical finding: severity/title/target/endpoint/field/authentication/observation/evidentiary outcome, no business-logic taxonomy, no browser evidence", () => {
    const { db, scanRunId } = freshScanRun();
    const findingId = recordFinding(db, {
      scanRunId,
      title: "Stored XSS: notes field stores raw, unescaped HTML",
      severity: "HIGH",
      evidentiaryOutcome: "PROVEN_VULNERABLE",
      targetEndpoint: "http://127.0.0.1/api/projects/1",
      fieldPath: "notes",
      authProfileId: 1,
      restoreStatus: "RESTORE_OK",
    });
    const [finding] = listFindings(db, scanRunId);

    const detail = getFindingDetail(db, finding!);

    expect(detail.severity).toBe("HIGH");
    expect(detail.title).toBe("Stored XSS: notes field stores raw, unescaped HTML");
    expect(detail.targetName).toBe("Fixture App");
    expect(detail.targetHostname).toBe("127.0.0.1");
    expect(detail.targetEndpoint).toBe("http://127.0.0.1/api/projects/1");
    expect(detail.fieldPath).toBe("notes");
    expect(detail.authProfileName).toBe("userA");
    expect(detail.restoreStatus).toBe("RESTORE_OK");
    expect(detail.evidentiaryOutcome).toBe("PROVEN_VULNERABLE");
    expect(detail.observation).toBe("[PROVEN_VULNERABLE] Stored XSS: notes field stores raw, unescaped HTML");
    expect(detail.category).toBeUndefined();
    expect(detail.browserEvidence).toEqual([]);
    expect(findingId).toBe(finding!.id);
  });

  it("a business-logic finding: category/confidence/proof-level, and an INFERRED hypothesis never labeled confirmed in its observation", () => {
    const { db, scanRunId } = freshScanRun();
    recordFinding(db, {
      scanRunId,
      title: "GTM value changed by a low-privilege account",
      severity: "MEDIUM",
      evidentiaryOutcome: "INCONCLUSIVE",
      category: "BUSINESS_AUTHORIZATION",
      confidence: "MEDIUM",
      proofLevel: "INFERRED",
    });
    const [finding] = listFindings(db, scanRunId);

    const detail = getFindingDetail(db, finding!);

    expect(detail.category).toBe("BUSINESS_AUTHORIZATION");
    expect(detail.confidence).toBe("MEDIUM");
    expect(detail.proofLevel).toBe("INFERRED");
    expect(detail.observation).not.toContain("CONFIRMED");
    expect(detail.observation).toBe("[INFERRED] GTM value changed by a low-privilege account");
  });

  it("a browser-assisted finding: exactly which browser page/API call/result combination proved it", () => {
    const { db, scanRunId } = freshScanRun();
    recordFinding(db, { scanRunId, title: "GTM changed via browser-observed API call", severity: "HIGH", evidentiaryOutcome: "PROVEN_VULNERABLE" });
    const [finding] = listFindings(db, scanRunId);

    recordBrowserEvidence(db, {
      scanRunId,
      findingId: finding!.id,
      kind: "DOM_SNAPSHOT",
      structuralData: {
        pageUrl: "http://127.0.0.1/app/projects/1",
        apiCall: { method: "PATCH", url: "http://127.0.0.1/api/projects/1" },
        result: "analyticsGtm reflected in the page's own gtm.js script tag",
      },
    });

    const detail = getFindingDetail(db, finding!);

    expect(detail.browserEvidence).toHaveLength(1);
    expect(detail.browserEvidence[0]?.structuralData).toEqual({
      pageUrl: "http://127.0.0.1/app/projects/1",
      apiCall: { method: "PATCH", url: "http://127.0.0.1/api/projects/1" },
      result: "analyticsGtm reflected in the page's own gtm.js script tag",
    });
  });
});
