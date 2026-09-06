import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { createBusinessExpectation } from "./business-expectations-repository";
import { validateServerControlledField } from "./server-controlled-field-validation";
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

function freshScanRun(): { db: Db; scanRunId: number; targetId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-server-controlled-field-validation-integration-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 5, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1, targetId: 1 };
}

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

async function reserveVulnContestTicket(campaignId: string, ticketNumber: number): Promise<{ attemptedValue: unknown; resultingValue: unknown }> {
  const response = await httpClient.request(`${origin()}/api/vuln-contest/campaigns/${campaignId}/reservations`, {
    method: "POST",
    headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
    body: JSON.stringify({ ticketNumber }),
  });
  expect(response.status).toBe(201);
  const resultingNumber = (JSON.parse(response.body) as { number: number }).number;
  return { attemptedValue: ticketNumber, resultingValue: resultingNumber };
}

describe("Section 13.9 — Server-Controlled Field Validation against the fixture's real client-controlled ticketNumber field", () => {
  it("produces a SERVER_CONTROLLED_FIELD finding when the observed CLIENT_CONTROLLED ticketNumber contradicts a configured SERVER-authority expectation", async () => {
    const { db, scanRunId, targetId } = freshScanRun();
    createBusinessExpectation(db, {
      targetId,
      objectType: "Ticket",
      propertyOrAction: "ticketNumber.control",
      expectationType: "AUTHORITY",
      expectedValue: "SERVER_CONTROLLED",
      severity: "HIGH",
    });

    const outcome = await validateServerControlledField({
      db,
      scanRunId,
      targetId,
      objectType: "Ticket",
      fieldName: "ticketNumber",
      targetEnvironment: "LOCAL_FIXTURE",
      isFinancialOrDangerous: false,
      currentObjectState: {},
      attemptMutatingProbe: () => reserveVulnContestTicket("2", 555001),
    });

    expect(outcome).toEqual({ status: "VALIDATED", control: "CLIENT_CONTROLLED", comparison: "CONTRADICTION", finding: true });
  });

  it("produces only INCONCLUSIVE_BUSINESS_EXPECTATION for the identical real observation when no expectation is configured", async () => {
    const { db, scanRunId, targetId } = freshScanRun();

    const outcome = await validateServerControlledField({
      db,
      scanRunId,
      targetId,
      objectType: "Ticket",
      fieldName: "ticketNumber",
      targetEnvironment: "LOCAL_FIXTURE",
      isFinancialOrDangerous: false,
      currentObjectState: {},
      attemptMutatingProbe: () => reserveVulnContestTicket("2", 555002),
    });

    expect(outcome).toEqual({ status: "VALIDATED", control: "CLIENT_CONTROLLED", comparison: "INCONCLUSIVE_BUSINESS_EXPECTATION", finding: false });
  });

  it.each(["DEVELOPMENT", "STAGING", "PRODUCTION"] as const)(
    "never actually mutates the equivalent real-target financial field (winningNumber, via an eligible-number-shifting reservation) against a target classified %s",
    async (targetEnvironment) => {
      const { db, scanRunId, targetId } = freshScanRun();
      let attempted = false;

      const outcome = await validateServerControlledField({
        db,
        scanRunId,
        targetId,
        objectType: "Campaign",
        fieldName: "winningNumber",
        targetEnvironment,
        isFinancialOrDangerous: true,
        currentObjectState: {},
        attemptMutatingProbe: async () => {
          attempted = true;
          return reserveVulnContestTicket("2", 1); // would only run for a LOCAL_FIXTURE target
        },
      });

      expect(attempted).toBe(false);
      expect(outcome).toEqual({ status: "SKIPPED_NOT_LOCAL_FIXTURE" });
    },
  );
});
