import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { createNewSecurityAudit } from "./new-security-audit";
import { getScanRunConfigSnapshot } from "../scan-orchestration/scan-run-config-snapshot";
import { listAuditEvents } from "../mutation/audit-events-repository";
import { MUTATION_AUTHORIZATION_CONFIRMATION_TEXT, MutationAuthorizationRequiredError, requiresMutationAuthorization, startScan } from "./start-scan";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshTarget(): { db: Db; targetId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-start-scan-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  const targetId = createNewSecurityAudit(db, { projectName: "My Project", targetDns: "example.com" });
  return { db, targetId };
}

describe("requiresMutationAuthorization (Section 16.6)", () => {
  it("Safe Automatic and Advanced always require it", () => {
    expect(requiresMutationAuthorization("SAFE_AUTOMATIC")).toBe(true);
    expect(requiresMutationAuthorization("ADVANCED")).toBe(true);
  });

  it("Passive-mode audits never require it", () => {
    expect(requiresMutationAuthorization("PASSIVE")).toBe(false);
    expect(requiresMutationAuthorization("PASSIVE", {})).toBe(false);
  });

  it("requires it for any mode with a write-test flag enabled", () => {
    expect(requiresMutationAuthorization("PASSIVE", { browserWrites: true })).toBe(true);
  });
});

describe("startScan (Section 16.6)", () => {
  it("rejects a Safe Automatic start request without prior confirmation, creating nothing", () => {
    const { db, targetId } = freshTarget();
    expect(() => startScan(db, { targetId, scanMode: "SAFE_AUTOMATIC" })).toThrow(MutationAuthorizationRequiredError);
    expect(db.prepare("SELECT COUNT(*) as c FROM scan_runs").get() as { c: number }).toEqual({ c: 0 });
  });

  it("rejects a confirmation whose text doesn't match verbatim", () => {
    const { db, targetId } = freshTarget();
    expect(() =>
      startScan(db, {
        targetId,
        scanMode: "SAFE_AUTOMATIC",
        mutationAuthorization: { confirmationText: "I confirm this.", confirmedBy: "operator@example.com" },
      }),
    ).toThrow(MutationAuthorizationRequiredError);
  });

  it("providing the exact confirmation allows the audit to start and records it in both the snapshot and the audit trail", () => {
    const { db, targetId } = freshTarget();
    const { scanRunId } = startScan(db, {
      targetId,
      scanMode: "SAFE_AUTOMATIC",
      mutationAuthorization: { confirmationText: MUTATION_AUTHORIZATION_CONFIRMATION_TEXT, confirmedBy: "operator@example.com" },
    });

    const snapshot = getScanRunConfigSnapshot(db, scanRunId);
    expect(snapshot.scanMode).toBe("SAFE_AUTOMATIC");
    expect(snapshot.mutationAuthorizationConfirmedBy).toBe("operator@example.com");

    const events = listAuditEvents(db, scanRunId);
    const confirmationEvent = events.find((e) => e.eventType === "MUTATION_AUTHORIZATION_CONFIRMED");
    expect(confirmationEvent?.payload).toEqual({ confirmedBy: "operator@example.com", confirmationText: MUTATION_AUTHORIZATION_CONFIRMATION_TEXT });
  });

  it("Passive-mode audits never require the confirmation and start immediately", () => {
    const { db, targetId } = freshTarget();
    const { scanRunId } = startScan(db, { targetId, scanMode: "PASSIVE" });
    expect(getScanRunConfigSnapshot(db, scanRunId).mutationAuthorizationConfirmedBy).toBeUndefined();
    expect(listAuditEvents(db, scanRunId).some((e) => e.eventType === "MUTATION_AUTHORIZATION_CONFIRMED")).toBe(false);
  });

  it("defaults to the target's own scan mode when none is specified for the start request", () => {
    const { db, targetId } = freshTarget(); // target defaults to PASSIVE
    const { scanRunId } = startScan(db, { targetId });
    expect(getScanRunConfigSnapshot(db, scanRunId).scanMode).toBe("PASSIVE");
  });
});
