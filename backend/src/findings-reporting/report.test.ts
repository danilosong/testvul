import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { createScanRun } from "../scan-orchestration/scan-run-config-snapshot";
import { recordEvidence } from "../evidence/evidence-collector";
import { recordFinding } from "./finding-repository";
import { buildReportData, isScanFullyComplete, renderReportAsHtml, renderReportAsJson } from "./report";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");
const RAW_SECRET = "eyJhbGciOiJIUzI1NiJ9.super-secret-real-token-value";

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshTarget(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-report-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json, environment) VALUES ('Fixture App', '127.0.0.1', '[]', 'LOCAL_FIXTURE')").run();
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('userA', 'BEARER')").run();
  return db;
}

function seedEvidenceWithRawSecret(db: Db, scanRunId: number): void {
  recordEvidence(db, scanRunId, {
    endpoint: "http://127.0.0.1/api/projects/1",
    fieldPath: "notes",
    request: { method: "GET", url: "http://127.0.0.1/api/projects/1", headers: { Authorization: `Bearer ${RAW_SECRET}` } },
    response: { status: 200, headers: {}, body: JSON.stringify({ notes: "hello" }) },
    originalValue: "hello",
    testValue: "hello",
    verificationOutcome: "REMOVED",
  });
}

describe("isScanFullyComplete (Section 15.6)", () => {
  it("only COMPLETED counts as fully complete", () => {
    expect(isScanFullyComplete("COMPLETED")).toBe(true);
    expect(isScanFullyComplete("COMPLETED_WITH_RECOVERY")).toBe(false);
    expect(isScanFullyComplete("PARTIAL")).toBe(false);
    expect(isScanFullyComplete("FAILED")).toBe(false);
    expect(isScanFullyComplete("CANCELLED")).toBe(false);
    expect(isScanFullyComplete("RESTORE_REQUIRED")).toBe(false);
  });
});

describe("HTML and JSON report generation for a completed fixture scan (Section 15.6)", () => {
  it("generates both formats with no unmasked credential or unredacted PII", () => {
    const db = freshTarget();
    const { scanRunId } = createScanRun(db, { targetId: 1, selectedAuthProfileIds: [1] });
    db.prepare("UPDATE scan_runs SET state = 'COMPLETED', finished_at = datetime('now') WHERE id = ?").run(scanRunId);

    seedEvidenceWithRawSecret(db, scanRunId);
    recordFinding(db, {
      scanRunId,
      title: "Stored XSS in notes",
      severity: "HIGH",
      evidentiaryOutcome: "PROVEN_VULNERABLE",
      targetEndpoint: "http://127.0.0.1/api/projects/1",
      fieldPath: "notes",
      recommendation: "Escape or sanitize the notes field before rendering it.",
    });

    const data = buildReportData(db, scanRunId);
    expect(data.fullyComplete).toBe(true);

    const html = renderReportAsHtml(data);
    const json = renderReportAsJson(data);

    expect(html).not.toContain(RAW_SECRET);
    expect(json).not.toContain(RAW_SECRET);
    expect(html).toContain("Completed");
    expect(html).toContain("Escape or sanitize");
    expect(data.recommendations).toEqual(["Escape or sanitize the notes field before rendering it."]);
    expect(data.authProfiles).toEqual([{ id: 1, name: "userA", method: "BEARER" }]);
  });
});

describe("a PARTIAL or COMPLETED_WITH_RECOVERY scan's report visibly shows its true status (Section 15.6)", () => {
  it("a PARTIAL scan's report never appears as a clean COMPLETED run", () => {
    const db = freshTarget();
    const { scanRunId } = createScanRun(db, { targetId: 1 });
    db.prepare("UPDATE scan_runs SET state = 'PARTIAL', had_partial_truncation = 1, truncation_limit_reached = 'PAGE', finished_at = datetime('now') WHERE id = ?").run(
      scanRunId,
    );

    const data = buildReportData(db, scanRunId);
    expect(data.fullyComplete).toBe(false);

    const html = renderReportAsHtml(data);
    expect(html).toContain("Not Complete: PARTIAL");
    expect(html).not.toMatch(/status-completed"/); // never rendered with the clean-completed banner class
    expect(data.executiveSummary).toContain("did not complete cleanly");
  });

  it("a COMPLETED_WITH_RECOVERY scan's report is visibly distinct from a clean COMPLETED run", () => {
    const db = freshTarget();
    const { scanRunId } = createScanRun(db, { targetId: 1 });
    db.prepare("UPDATE scan_runs SET state = 'COMPLETED_WITH_RECOVERY', had_restore_incident = 1, finished_at = datetime('now') WHERE id = ?").run(scanRunId);

    const data = buildReportData(db, scanRunId);
    expect(data.fullyComplete).toBe(false);

    const html = renderReportAsHtml(data);
    expect(html).toContain("Completed With Recovery");
    expect(html).not.toContain(">Completed<");
    expect(html).toMatch(/status-completed-with-recovery/);
    expect(html).not.toMatch(/class="status-completed"/);
    expect(data.executiveSummary).toContain("recovered restore incident");
  });
});
