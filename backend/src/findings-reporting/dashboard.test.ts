import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { createScanRun } from "../scan-orchestration/scan-run-config-snapshot";
import { addMutationScopeEntry } from "../mutation/mutation-scope";
import { createBusinessExpectation } from "../business-logic/business-expectations-repository";
import { recordDiscoveredEndpoints } from "../discovery/discovered-endpoints-repository";
import { registerDiscoveredOperation } from "../operation-discovery/discovered-operations-repository";
import { recordBusinessObject } from "../business-logic/business-object-discovery";
import { recordObservedState } from "../business-logic/state-model";
import { recordWebhookOperation } from "../business-logic/webhook-operations-repository";
import { recordFinding } from "./finding-repository";
import { getDashboardData } from "./dashboard";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshTarget(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-dashboard-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare(
    "INSERT INTO targets (name, hostname, scope_json, default_scan_mode, environment) VALUES ('Fixture App', '127.0.0.1', '[\"127.0.0.1\"]', 'SAFE_AUTOMATIC', 'LOCAL_FIXTURE')",
  ).run();
  return db;
}

function insertCandidateRow(db: Db, scanRunId: number, scanner: string, eligibilityState: string): void {
  db.prepare("INSERT INTO candidates (scan_run_id, scanner, eligibility_state) VALUES (?, ?, ?)").run(scanRunId, scanner, eligibilityState);
}

describe("getDashboardData (Section 15.3)", () => {
  it("returns all counts correctly for a completed fixture scan", () => {
    const db = freshTarget();
    addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "1" });
    createBusinessExpectation(db, {
      targetId: 1,
      objectType: "Campaign",
      propertyOrAction: "currentLowestEligibleNumber",
      expectationType: "VISIBILITY",
      expectedValue: "PRIVATE",
      severity: "MEDIUM",
    });

    const { scanRunId } = createScanRun(db, { targetId: 1 });
    db.prepare("UPDATE scan_runs SET state = 'COMPLETED', finished_at = datetime('now') WHERE id = ?").run(scanRunId);

    recordDiscoveredEndpoints(
      db,
      scanRunId,
      [
        { url: "http://127.0.0.1/", method: "GET", contentType: "text/html", isPage: true },
        { url: "http://127.0.0.1/api/projects/1", method: "GET", contentType: "application/json" },
      ],
      "STATIC",
    );
    registerDiscoveredOperation(db, scanRunId, { method: "PATCH", url: "http://127.0.0.1/api/projects/1", source: "OPENAPI", confidence: "HIGH" });
    registerDiscoveredOperation(db, scanRunId, { method: "POST", url: "http://127.0.0.1/api/settings", source: "BROWSER_DRY_RUN", confidence: "HIGH" });

    recordBusinessObject(db, scanRunId, "Project", "URL");
    recordBusinessObject(db, scanRunId, "Ticket", "JSON_FIELD");
    recordObservedState(db, scanRunId, "Ticket", "PAID");

    insertCandidateRow(db, scanRunId, "XSS", "TESTABLE");
    insertCandidateRow(db, scanRunId, "XSS", "TESTABLE");
    db.prepare("INSERT INTO browser_actions (scan_run_id, page_url, label, classification) VALUES (?, 'http://127.0.0.1/app/settings', 'Save', 'SAFE_MUTATION')").run(
      scanRunId,
    );

    recordWebhookOperation(db, {
      scanRunId,
      endpoint: "/api/contest/payments/webhook",
      signatureMechanism: "HMAC-SHA256",
      resultingStateTransition: "Ticket: PENDING_PAYMENT -> PAID",
    });

    recordFinding(db, {
      scanRunId,
      title: "Stored XSS in notes",
      severity: "HIGH",
      evidentiaryOutcome: "PROVEN_VULNERABLE",
      targetEndpoint: "http://127.0.0.1/api/projects/1",
      fieldPath: "notes",
    });
    recordFinding(db, {
      scanRunId,
      title: "GTM changed by low-priv user",
      severity: "MEDIUM",
      evidentiaryOutcome: "PROVEN_VULNERABLE",
      category: "BUSINESS_AUTHORIZATION",
      confidence: "HIGH",
      proofLevel: "CONFIRMED",
    });

    const dashboard = getDashboardData(db, scanRunId, [
      { source: "generic", objectType: "Project" },
      { source: "contest", objectType: "Ticket" },
    ]);

    expect(dashboard.target).toEqual({ id: 1, name: "Fixture App", hostname: "127.0.0.1" });
    expect(dashboard.scanRun.state).toBe("COMPLETED");
    expect(dashboard.scanRun.hadRestoreIncident).toBe(false);
    expect(dashboard.discoveryCounts.pages).toBe(1);
    expect(dashboard.discoveryCounts.jsonEndpoints).toBe(1);
    expect(dashboard.discoveryCounts.operations).toBe(2);
    expect(dashboard.discoveryCounts.businessObjects).toBe(2);
    expect(dashboard.discoveryCounts.businessStates).toBe(1);
    expect(dashboard.findingsBySeverity).toEqual({ HIGH: 1, MEDIUM: 1 });
    expect(dashboard.technicalCoverage).toEqual([{ scanner: "XSS", discovered: 2, tested: 2, passiveOnly: 0, skippedByReason: {}, inconclusive: 0 }]);
    expect(dashboard.browserCoverage).toEqual({ actionsDiscovered: 1, actionsByClassification: { SAFE_MUTATION: 1 }, dryRunOperationsDiscovered: 1 });
    expect(dashboard.businessLogicCoverage.byProfile.map((p) => p.profileName)).toEqual(["contest", "generic"]);
    expect(dashboard.environmentClassification).toBe("LOCAL_FIXTURE");
    expect(dashboard.mutationScopeInEffect).toEqual([{ targetId: 1, objectType: "project", resourceId: "1" }]);
    expect(dashboard.configuredBusinessExpectations).toHaveLength(1);
    expect(dashboard.externalTrustBoundaries).toHaveLength(1);
    expect(dashboard.safetySkipped).toEqual([]);
  });

  it("shows the full untested/safety-skipped breakdown distinctly, alongside a 0-findings result", () => {
    const db = freshTarget();
    const { scanRunId } = createScanRun(db, { targetId: 1 });

    insertCandidateRow(db, scanRunId, "IDOR", "SKIPPED_NON_TEST_RESOURCE");
    insertCandidateRow(db, scanRunId, "IDOR", "SKIPPED_REVERSIBILITY_NOT_PROVEN");
    insertCandidateRow(db, scanRunId, "GTM", "SKIPPED_ENVIRONMENT_POLICY");
    insertCandidateRow(db, scanRunId, "GTM", "INCONCLUSIVE_TRUST_BOUNDARY");
    insertCandidateRow(db, scanRunId, "GTM", "INCONCLUSIVE_BUSINESS_EXPECTATION");

    const dashboard = getDashboardData(db, scanRunId);

    expect(dashboard.findingsBySeverity).toEqual({});
    expect(dashboard.safetySkipped).toEqual([
      { eligibilityState: "INCONCLUSIVE", count: 2 },
      { eligibilityState: "SKIPPED_ENVIRONMENT_POLICY", count: 1 },
      { eligibilityState: "SKIPPED_NON_TEST_RESOURCE", count: 1 },
      { eligibilityState: "SKIPPED_REVERSIBILITY_NOT_PROVEN", count: 1 },
    ]);
    // None of these ever counted as tested, blocked, or vulnerable.
    expect(dashboard.technicalCoverage.every((breakdown) => breakdown.tested === 0)).toBe(true);
  });
});
