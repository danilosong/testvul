import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { describeStateTransition, isWebhookShapedEndpoint } from "./webhook-operation";
import { listWebhookOperations, recordWebhookOperation } from "./webhook-operations-repository";
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

let dir: string | undefined;
let db: Db | undefined;

afterEach(() => {
  if (db) {
    db.close();
    db = undefined;
  }
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

describe("Section 13.23 — the ExternalTrustBoundary/WebhookOperation model against the real fixture payment webhook (1.6)", () => {
  it("records a real, legitimately-observed external call that transitions a Ticket from PENDING_PAYMENT to PAID as a WebhookOperation with that resulting state transition", async () => {
    dir = mkdtempSync(join(tmpdir(), "sca-webhook-operation-integration-"));
    db = openDb(join(dir, "test.db"));
    runMigrations(db, MIGRATIONS_DIR);
    db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
    db.prepare(
      "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 5, 'LOCAL_FIXTURE')",
    ).run();
    db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();

    const webhookEndpoint = "/api/contest/payments/webhook";
    expect(isWebhookShapedEndpoint(webhookEndpoint)).toBe(true);

    const reserveResponse = await httpClient.request(`${origin()}/api/contest/campaigns/1/reservations`, {
      method: "POST",
      headers: { Authorization: "Bearer userA-token" },
    });
    const reservation = JSON.parse(reserveResponse.body) as { id: string };

    const purchaseResponse = await httpClient.request(`${origin()}/api/contest/reservations/${reservation.id}/purchase`, {
      method: "POST",
      headers: { Authorization: "Bearer userA-token" },
    });
    const purchase = JSON.parse(purchaseResponse.body) as { ticket: { id: string; status: string }; purchase: { id: string } };
    expect(purchase.ticket.status).toBe("PENDING_PAYMENT");
    const stateBefore = purchase.ticket.status;

    // A real, legitimately-signed external call — never a forged/unauthenticated
    // callback (Section 13.25's exclusive, LOCAL_FIXTURE+TEST_RESOURCE-gated job).
    const rawBody = JSON.stringify({ purchaseId: purchase.purchase.id });
    const signature = createHmac("sha256", "fixture-webhook-secret").update(rawBody).digest("hex");
    const webhookResponse = await httpClient.request(`${origin()}${webhookEndpoint}`, {
      method: "POST",
      headers: { "X-Webhook-Signature": signature, "Content-Type": "application/json" },
      body: rawBody,
    });
    const webhookResult = JSON.parse(webhookResponse.body) as { ticket: { status: string } };
    const stateAfter = webhookResult.ticket.status;
    expect(stateAfter).toBe("PAID");

    const id = recordWebhookOperation(db, {
      scanRunId: 1,
      endpoint: webhookEndpoint,
      signatureMechanism: "HMAC-SHA256 (X-Webhook-Signature)",
      resultingStateTransition: describeStateTransition("Ticket", stateBefore, stateAfter),
    });

    const ops = listWebhookOperations(db, 1);
    expect(ops).toEqual([
      {
        id,
        scanRunId: 1,
        endpoint: webhookEndpoint,
        signatureMechanism: "HMAC-SHA256 (X-Webhook-Signature)",
        resultingStateTransition: "Ticket: PENDING_PAYMENT -> PAID",
      },
    ]);
  });
});
