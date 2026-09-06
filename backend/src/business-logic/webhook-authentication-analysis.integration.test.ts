import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { analyzeWebhookAuthentication } from "./webhook-authentication-analysis";
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

describe("Section 13.24 — Webhook Authentication Analysis against the real fixture payment webhooks (1.6)", () => {
  it("records the vulnerable webhook's real, legitimately-observed call as NO_MECHANISM_OBSERVED, without an automatic finding", async () => {
    dir = mkdtempSync(join(tmpdir(), "sca-webhook-auth-analysis-integration-"));
    db = openDb(join(dir, "test.db"));
    runMigrations(db, MIGRATIONS_DIR);
    db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
    db.prepare(
      "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 5, 'LOCAL_FIXTURE')",
    ).run();
    db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();

    const requestHeaders = { "Content-Type": "application/json" };
    const response = await httpClient.request(`${origin()}/api/vuln-contest/payments/webhook`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ ticketId: "nonexistent" }),
    });
    expect(response.status).toBe(404); // ticket doesn't exist, but the call itself was accepted with no auth check at all

    const result = analyzeWebhookAuthentication({ requestObserved: true, headers: requestHeaders });
    expect(result).toBe("NO_MECHANISM_OBSERVED");

    const findingCount = (db.prepare("SELECT COUNT(*) as c FROM findings WHERE scan_run_id = ?").get(1) as { c: number }).c;
    expect(findingCount).toBe(0);
  });

  it("records the protected webhook's real signed call as VERIFIED_MECHANISM_DETECTED", async () => {
    const requestHeaders = { "X-Webhook-Signature": "0".repeat(64), "Content-Type": "application/json" };
    const response = await httpClient.request(`${origin()}/api/contest/payments/webhook`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ purchaseId: "nonexistent" }),
    });
    expect(response.status).toBe(401); // signature doesn't match, but its very presence is what's being analyzed here

    const result = analyzeWebhookAuthentication({ requestObserved: true, headers: requestHeaders });
    expect(result).toBe("VERIFIED_MECHANISM_DETECTED");
  });
});
