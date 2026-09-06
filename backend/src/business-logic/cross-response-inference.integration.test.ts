import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { listObservedProperties } from "./business-observed-properties-repository";
import { recordCrossResponseInference } from "./cross-response-inference";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let httpClient: SecurityHttpClient;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  httpClient = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
}, 60_000);

afterAll(async () => {
  await servers.stop();
});

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-cross-response-inference-integration-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 5, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

describe("Section 13.11 — Cross-Response Information Combination Analysis against two real fixture endpoints", () => {
  it("combines a reservation response with the current-lowest-eligible-number response to infer a likely winning number, recorded only as POTENTIAL_BUSINESS_STATE_INFERENCE — never as a confirmed finding", async () => {
    const { db, scanRunId } = freshScanRun();

    // Response 1: reserving a vuln-contest ticket reveals only that
    // ticket's own number — nothing about the campaign's eventual winner.
    const reservationResponse = await httpClient.request(`${origin()}/api/vuln-contest/campaigns/2/reservations`, {
      method: "POST",
      headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
      body: JSON.stringify({ ticketNumber: 31337 }),
    });
    expect(reservationResponse.status).toBe(201);
    const ticketNumber = (JSON.parse(reservationResponse.body) as { number: number }).number;

    // Response 2: the unauthenticated eligibility endpoint reveals only a
    // number — nothing about which ticket it belongs to or who owns it.
    const eligibilityResponse = await httpClient.request(`${origin()}/api/vuln-contest/campaigns/2/current-lowest-eligible-number`, { method: "GET" });
    expect(eligibilityResponse.status).toBe(200);
    const currentLowestEligibleNumber = (JSON.parse(eligibilityResponse.body) as { currentLowestEligibleNumber: number }).currentLowestEligibleNumber;

    // Combined, the two individually-innocuous responses let an observer
    // infer that ticketNumber is likely to become the campaign's winning
    // number once closed — a business-state inference neither response
    // alone discloses.
    expect(currentLowestEligibleNumber).toBe(ticketNumber);

    recordCrossResponseInference({
      db,
      scanRunId,
      objectType: "Campaign",
      inferredProperty: "likelyWinningNumber",
      combinedFrom: ["reservation.number", "current-lowest-eligible-number.currentLowestEligibleNumber"],
    });

    const stored = listObservedProperties(db, scanRunId, "Campaign", "likelyWinningNumber");
    expect(stored).toHaveLength(1);
    expect((stored[0]?.observedValue as { classification: string }).classification).toBe("POTENTIAL_BUSINESS_STATE_INFERENCE");

    const findingCount = (db.prepare("SELECT COUNT(*) as c FROM findings WHERE scan_run_id = ?").get(scanRunId) as { c: number }).c;
    expect(findingCount).toBe(0);
  });
});
