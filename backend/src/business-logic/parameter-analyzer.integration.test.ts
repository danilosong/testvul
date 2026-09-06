import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { listObservedProperties } from "./business-observed-properties-repository";
import { recordParameterClassification } from "./parameter-analyzer";
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
  dir = mkdtempSync(join(tmpdir(), "sca-parameter-analyzer-integration-"));
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

describe("Section 13.8 — Parameter Classification grounded in the fixture's real Ticket.number field", () => {
  it("classifies ticketNumber SERVER_CONTROLLED on the protected purchase flow, which assigns the number itself and never even reads a client-supplied one", async () => {
    const { db, scanRunId } = freshScanRun();
    const reservationResponse = await httpClient.request(`${origin()}/api/contest/campaigns/1/reservations`, {
      method: "POST",
      headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(reservationResponse.status).toBe(201);
    const reservation = JSON.parse(reservationResponse.body) as { id: string };

    const attemptedNumber = 999999;
    const purchaseResponse = await httpClient.request(`${origin()}/api/contest/reservations/${reservation.id}/purchase`, {
      method: "POST",
      headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
      body: JSON.stringify({ ticketNumber: attemptedNumber }),
    });
    expect(purchaseResponse.status).toBe(201);
    const resultingNumber = (JSON.parse(purchaseResponse.body) as { ticket: { number: number } }).ticket.number;
    expect(resultingNumber).not.toBe(attemptedNumber);

    const control = recordParameterClassification(db, scanRunId, "Ticket", "number", attemptedNumber, resultingNumber);
    expect(control).toBe("SERVER_CONTROLLED");
    expect(listObservedProperties(db, scanRunId, "Ticket", "number.control")[0]?.observedValue).toBe("SERVER_CONTROLLED");
  });

  it("classifies ticketNumber CLIENT_CONTROLLED on the vuln-contest flow, which honors the client-supplied value verbatim", async () => {
    const { db, scanRunId } = freshScanRun();
    const attemptedNumber = 424242;
    const response = await httpClient.request(`${origin()}/api/vuln-contest/campaigns/2/reservations`, {
      method: "POST",
      headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
      body: JSON.stringify({ ticketNumber: attemptedNumber }),
    });
    expect(response.status).toBe(201);
    const resultingNumber = (JSON.parse(response.body) as { number: number }).number;
    expect(resultingNumber).toBe(attemptedNumber);

    const control = recordParameterClassification(db, scanRunId, "Ticket", "number", attemptedNumber, resultingNumber);
    expect(control).toBe("CLIENT_CONTROLLED");
    expect(listObservedProperties(db, scanRunId, "Ticket", "number.control")[0]?.observedValue).toBe("CLIENT_CONTROLLED");
  });
});
