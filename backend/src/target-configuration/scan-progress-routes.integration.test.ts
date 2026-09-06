import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { recordAuditEvent } from "../mutation/audit-events-repository";
import { createNewSecurityAudit } from "./new-security-audit";
import { startScan } from "./start-scan";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");
let dir: string;
let db: Db;

afterEach(() => { db?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

function setup() {
  dir = mkdtempSync(join(tmpdir(), "sca-progress-routes-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  const targetId = createNewSecurityAudit(db, { projectName: "Audit", targetDns: "example.com" });
  const { scanRunId } = startScan(db, { targetId });
  return { app: buildApp(db), scanRunId };
}

describe("Section 17.5 — scan progress and cancellation API", () => {
  it("returns fixed-stage progress from the audit trail", async () => {
    const { app, scanRunId } = setup();
    recordAuditEvent(db, scanRunId, "STAGE_DNS_RESOLVER_RUNNING", { stage: "DNS_RESOLVER", status: "RUNNING" });
    recordAuditEvent(db, scanRunId, "STAGE_DNS_RESOLVER_COMPLETED", { stage: "DNS_RESOLVER", status: "COMPLETED" });
    const response = await app.inject({ method: "GET", url: `/api/scan-runs/${scanRunId}/progress` });
    expect(response.statusCode).toBe(200);
    expect(response.json().stages[0]).toEqual({ stage: "DNS_RESOLVER", status: "COMPLETED" });
    expect(response.json().stages.at(-1)).toEqual({ stage: "REPORT", status: "PENDING" });
  });

  it("records a safe cancellation request without forcing an in-flight state transition", async () => {
    const { app, scanRunId } = setup();
    const response = await app.inject({ method: "POST", url: `/api/scan-runs/${scanRunId}/cancel`, payload: { requestedBy: "operator@example.com" } });
    expect(response.statusCode).toBe(202);
    const progress = (await app.inject({ method: "GET", url: `/api/scan-runs/${scanRunId}/progress` })).json();
    expect(progress.cancellationRequested).toBe(true);
    expect(progress.events).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: "SCAN_CANCELLATION_REQUESTED" })]));
  });
});
