import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { addMutationScopeEntry } from "../mutation/mutation-scope";
import { createBusinessExpectation, deleteBusinessExpectation, updateBusinessExpectation } from "../business-logic/business-expectations-repository";
import { createBusinessInvariant, deleteBusinessInvariant, updateBusinessInvariant } from "../business-logic/business-invariants-repository";
import { setAuthorizationExpectation } from "../auth/authorization-expectations-repository";
import {
  createScanRun,
  getAuthorizationExpectationsSnapshot,
  getBusinessExpectationsSnapshot,
  getBusinessInvariantsSnapshot,
  getMutationScopeSnapshot,
  getScanRunConfigSnapshot,
} from "./scan-run-config-snapshot";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshTarget(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-scan-run-config-snapshot-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare(
    "INSERT INTO targets (name, hostname, scope_json, default_scan_mode, rate_limit_rps, allow_private_networks, environment) VALUES ('t', 'example.com', '[\"example.com\"]', 'PASSIVE', 2, 0, 'STAGING')",
  ).run();
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('userA', 'BEARER')").run();
  return db;
}

describe("createScanRun / getScanRunConfigSnapshot (Section 14.8)", () => {
  it("copies the target's own defaults when no override is supplied", () => {
    const db = freshTarget();
    const { scanRunId } = createScanRun(db, { targetId: 1 });
    const snapshot = getScanRunConfigSnapshot(db, scanRunId);
    expect(snapshot).toMatchObject({
      targetId: 1,
      scope: ["example.com"],
      scanMode: "PASSIVE",
      rateLimitRps: 2,
      allowPrivateNetworks: false,
      environment: "STAGING",
    });
  });

  it("applies an explicit override instead of the target's default", () => {
    const db = freshTarget();
    const { scanRunId } = createScanRun(db, { targetId: 1, scanMode: "SAFE_AUTOMATIC", mutationAuthorizationConfirmedBy: "operator@example.com" });
    const snapshot = getScanRunConfigSnapshot(db, scanRunId);
    expect(snapshot.scanMode).toBe("SAFE_AUTOMATIC");
    expect(snapshot.mutationAuthorizationConfirmedBy).toBe("operator@example.com");
  });

  it("editing the Target after a scan starts does not change that scan's recorded configuration", () => {
    const db = freshTarget();
    const { scanRunId } = createScanRun(db, { targetId: 1 });

    db.prepare("UPDATE targets SET scope_json = '[\"changed-after-scan-started.example.com\"]', default_scan_mode = 'ADVANCED', rate_limit_rps = 99 WHERE id = 1").run();

    const snapshot = getScanRunConfigSnapshot(db, scanRunId);
    expect(snapshot.scope).toEqual(["example.com"]);
    expect(snapshot.scanMode).toBe("PASSIVE");
    expect(snapshot.rateLimitRps).toBe(2);
  });

  it("persists the selected auth profiles into scan_run_auth_profiles", () => {
    const db = freshTarget();
    const { scanRunId } = createScanRun(db, { targetId: 1, selectedAuthProfileIds: [1] });
    const rows = db.prepare("SELECT auth_profile_id FROM scan_run_auth_profiles WHERE scan_run_id = ?").all(scanRunId) as { auth_profile_id: number }[];
    expect(rows.map((r) => r.auth_profile_id)).toEqual([1]);
  });
});

describe("mutation scope / business expectation / business invariant / authorization expectation snapshots (Section 14.8)", () => {
  it("captures the mutation scope resources configured for the target at scan start", () => {
    const db = freshTarget();
    addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "1" });
    const { scanRunId } = createScanRun(db, { targetId: 1 });
    expect(getMutationScopeSnapshot(db, scanRunId)).toEqual([{ targetId: 1, objectType: "project", resourceId: "1" }]);
  });

  it("editing or deleting a BusinessExpectation/BusinessInvariant after a scan completes does not change how that scan's report explains its findings", () => {
    const db = freshTarget();
    const expectationId = createBusinessExpectation(db, {
      targetId: 1,
      objectType: "Campaign",
      propertyOrAction: "currentLowestEligibleNumber",
      expectationType: "VISIBILITY",
      expectedValue: "PRIVATE",
      severity: "MEDIUM",
    });
    const invariantId = createBusinessInvariant(db, {
      targetId: 1,
      name: "Ticket.number is immutable after PAID",
      objectType: "Ticket",
      condition: { field: "status", operator: "EQ", value: "PAID" },
      expected: false,
      severity: "HIGH",
    });

    const { scanRunId } = createScanRun(db, { targetId: 1 });

    // The scan has "completed" — now the operator edits, then deletes, the
    // very rules that scan's report would otherwise need to explain its findings.
    updateBusinessExpectation(db, expectationId, { severity: "CRITICAL", expectedValue: "PUBLIC" });
    deleteBusinessExpectation(db, expectationId);
    updateBusinessInvariant(db, invariantId, { severity: "CRITICAL" });
    deleteBusinessInvariant(db, invariantId);

    const expectationsSnapshot = getBusinessExpectationsSnapshot(db, scanRunId);
    expect(expectationsSnapshot).toEqual([
      {
        id: expectationId,
        targetId: 1,
        objectType: "Campaign",
        propertyOrAction: "currentLowestEligibleNumber",
        expectationType: "VISIBILITY",
        expectedValue: "PRIVATE",
        severity: "MEDIUM",
      },
    ]);

    const invariantsSnapshot = getBusinessInvariantsSnapshot(db, scanRunId);
    expect(invariantsSnapshot).toEqual([
      {
        id: invariantId,
        targetId: 1,
        name: "Ticket.number is immutable after PAID",
        objectType: "Ticket",
        condition: { field: "status", operator: "EQ", value: "PAID" },
        expected: false,
        severity: "HIGH",
      },
    ]);
  });

  it("captures the authorization expectations configured for every selected auth profile", () => {
    const db = freshTarget();
    setAuthorizationExpectation(db, { authProfileId: 1, action: "CAMPAIGN_EDIT", expected: "DENIED" });
    const { scanRunId } = createScanRun(db, { targetId: 1, selectedAuthProfileIds: [1] });

    setAuthorizationExpectation(db, { authProfileId: 1, action: "CAMPAIGN_EDIT", expected: "ALLOWED" }); // changed after scan start

    const snapshot = getAuthorizationExpectationsSnapshot(db, scanRunId);
    expect(snapshot).toEqual([{ id: expect.any(Number), authProfileId: 1, action: "CAMPAIGN_EDIT", expected: "DENIED" }]);
  });
});
