import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { createNewSecurityAudit } from "../target-configuration/new-security-audit";
import { startScan } from "../target-configuration/start-scan";
import { recordDiscoveredEndpoint } from "../discovery/discovered-endpoints-repository";
import { recordFinding } from "./finding-repository";
import { recordBrowserEvidence } from "../browser/browser-evidence-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");
let dir: string;
let db: Db;
afterEach(() => { db?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

function setup() {
  dir = mkdtempSync(join(tmpdir(), "sca-reporting-routes-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  const targetId = createNewSecurityAudit(db, { projectName: "Auditoria", targetDns: "example.com", environment: "STAGING" });
  const { scanRunId } = startScan(db, { targetId });
  return { app: buildApp(db), scanRunId };
}

describe("Section 17.6 — Dashboard API", () => {
  it("returns state, discovery, severity and complete coverage groups", async () => {
    const { app, scanRunId } = setup();
    const response = await app.inject({ method: "GET", url: `/api/scan-runs/${scanRunId}/dashboard` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      target: expect.objectContaining({ name: "Auditoria" }),
      scanRun: expect.objectContaining({ state: "PASSIVE_PENDING" }),
      discoveryCounts: expect.any(Object), technicalCoverage: expect.any(Array),
      browserCoverage: expect.any(Object), businessLogicCoverage: expect.any(Object), environmentClassification: "STAGING",
    }));
  });

  it("returns an attack-surface tree and endpoint detail for a browser-discovered endpoint", async () => {
    const { app, scanRunId } = setup();
    const endpointId = recordDiscoveredEndpoint(db, scanRunId, { method: "GET", url: "https://example.com/app/projects", contentType: "application/json" }, "BROWSER");
    const surface = await app.inject({ method: "GET", url: `/api/scan-runs/${scanRunId}/attack-surface` });
    expect(surface.statusCode).toBe(200);
    expect(surface.json().endpoints).toEqual([expect.objectContaining({ id: endpointId, discoveredVia: "BROWSER" })]);
    const detail = await app.inject({ method: "GET", url: `/api/endpoints/${endpointId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual(expect.objectContaining({ url: "https://example.com/app/projects", fieldCount: 0 }));
  });

  it("returns finding detail with browser-assisted evidence", async () => {
    const { app, scanRunId } = setup();
    const findingId = recordFinding(db, { scanRunId, title: "Acesso indevido", severity: "HIGH", evidentiaryOutcome: "PROVEN_VULNERABLE", targetEndpoint: "/api/projects/2" });
    recordBrowserEvidence(db, { scanRunId, findingId, kind: "DOM_SNAPSHOT", structuralData: { pageUrl: "/projects/2", result: "owned-by-user-b" } });
    const response = await app.inject({ method: "GET", url: `/api/findings/${findingId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({ title: "Acesso indevido", targetName: "Auditoria", browserEvidence: [expect.objectContaining({ kind: "DOM_SNAPSHOT" })] }));
  });

  it("downloads HTML and JSON reports with coverage and configuration snapshot", async () => {
    const { app, scanRunId } = setup();
    const json = await app.inject({ method: "GET", url: `/api/scan-runs/${scanRunId}/reports/json` });
    expect(json.statusCode).toBe(200);
    expect(json.headers["content-disposition"]).toContain(`auditoria-${scanRunId}.json`);
    expect(json.json()).toEqual(expect.objectContaining({ scanRunConfigSnapshot: expect.any(Object), dashboard: expect.objectContaining({ technicalCoverage: expect.any(Array) }) }));
    const html = await app.inject({ method: "GET", url: `/api/scan-runs/${scanRunId}/reports/html` });
    expect(html.statusCode).toBe(200);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.body).toContain("Security Configuration Auditor Report");
  });
});
