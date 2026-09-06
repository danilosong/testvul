import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { createBusinessExpectation } from "./business-expectations-repository";
import { listObservedProperties } from "./business-observed-properties-repository";
import { analyzeStateExposure, recordStateExposureObservation } from "./state-exposure-analyzer";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let httpClient: SecurityHttpClient;
let browser: Browser;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  httpClient = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser.close();
  await servers.stop();
});

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number; targetId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-state-exposure-analyzer-integration-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 5, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1, targetId: 1 };
}

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

async function reserveVulnContestTicket(campaignId: string, ticketNumber: number): Promise<void> {
  const response = await httpClient.request(`${origin()}/api/vuln-contest/campaigns/${campaignId}/reservations`, {
    method: "POST",
    headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
    body: JSON.stringify({ ticketNumber }),
  });
  expect(response.status).toBe(201);
}

async function fetchCurrentLowestEligibleNumber(campaignId: string): Promise<number | null> {
  const response = await httpClient.request(`${origin()}/api/vuln-contest/campaigns/${campaignId}/current-lowest-eligible-number`, { method: "GET" });
  expect(response.status).toBe(200);
  return (JSON.parse(response.body) as { currentLowestEligibleNumber: number | null }).currentLowestEligibleNumber;
}

describe("Section 13.10 — State Exposure Analysis against the fixture's real currentLowestEligibleNumber endpoint (1.6)", () => {
  it("raises a finding: the value is exposed unauthenticated while a PRIVATE-while-open expectation applies and the campaign is OPEN", async () => {
    const { db, scanRunId, targetId } = freshScanRun();
    createBusinessExpectation(db, {
      targetId,
      objectType: "Campaign",
      propertyOrAction: "currentLowestEligibleNumber",
      expectationType: "VISIBILITY",
      expectedValue: "PRIVATE",
      lifecycleCondition: { field: "closed", operator: "EQ", value: false },
      severity: "MEDIUM",
    });

    await reserveVulnContestTicket("2", 61001);
    const observedNumber = await fetchCurrentLowestEligibleNumber("2");
    expect(observedNumber).not.toBeNull();

    const result = analyzeStateExposure({
      db,
      scanRunId,
      targetId,
      objectType: "Campaign",
      fieldName: "currentLowestEligibleNumber",
      location: "API",
      exposed: observedNumber !== null,
      rawValue: observedNumber,
      currentObjectState: { closed: false },
    });

    expect(result).toEqual({ credentialShaped: false, comparison: "CONTRADICTION", finding: true });
  });

  it("produces no finding for the identical exposure when the configured expectation is PUBLIC instead", async () => {
    const { db, scanRunId, targetId } = freshScanRun();
    createBusinessExpectation(db, {
      targetId,
      objectType: "Campaign",
      propertyOrAction: "currentLowestEligibleNumber",
      expectationType: "VISIBILITY",
      expectedValue: "PUBLIC",
      severity: "MEDIUM",
    });

    await reserveVulnContestTicket("2", 61002);
    const observedNumber = await fetchCurrentLowestEligibleNumber("2");
    expect(observedNumber).not.toBeNull();

    const result = analyzeStateExposure({
      db,
      scanRunId,
      targetId,
      objectType: "Campaign",
      fieldName: "currentLowestEligibleNumber",
      location: "API",
      exposed: observedNumber !== null,
      rawValue: observedNumber,
      currentObjectState: { closed: false },
    });

    expect(result).toEqual({ credentialShaped: false, comparison: "MATCH", finding: false });
  });

  it("produces no finding for the identical exposure once the campaign is CLOSED — the PRIVATE-while-open expectation no longer applies", async () => {
    const { db, scanRunId, targetId } = freshScanRun();
    createBusinessExpectation(db, {
      targetId,
      objectType: "Campaign",
      propertyOrAction: "currentLowestEligibleNumber",
      expectationType: "VISIBILITY",
      expectedValue: "PRIVATE",
      lifecycleCondition: { field: "closed", operator: "EQ", value: false },
      severity: "MEDIUM",
    });

    await reserveVulnContestTicket("2", 61003);
    const observedNumber = await fetchCurrentLowestEligibleNumber("2");
    expect(observedNumber).not.toBeNull();

    const result = analyzeStateExposure({
      db,
      scanRunId,
      targetId,
      objectType: "Campaign",
      fieldName: "currentLowestEligibleNumber",
      location: "API",
      exposed: observedNumber !== null,
      rawValue: observedNumber,
      currentObjectState: { closed: true },
    });

    expect(result).toEqual({ credentialShaped: false, comparison: "INCONCLUSIVE_BUSINESS_EXPECTATION", finding: false });
  });

  it("an accessToken key observed in a real browser's localStorage never itself becomes a finding, and its raw value is never persisted", async () => {
    const { db, scanRunId } = freshScanRun();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin()}/app/projects/2`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page.evaluate as any)(() => localStorage.setItem("accessToken", "eyJhbGciOiJIUzI1NiJ9.real-secret-session-token"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawValue = await (page.evaluate as any)(() => localStorage.getItem("accessToken"));
    await context.close();

    recordStateExposureObservation({
      db,
      scanRunId,
      objectType: "Session",
      fieldName: "accessToken",
      location: "BROWSER_STORAGE",
      exposed: rawValue !== null,
      rawValue,
    });

    const stored = listObservedProperties(db, scanRunId, "Session", "accessToken");
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored[0]?.observedValue)).not.toContain("real-secret-session-token");
  }, 30_000);
});
