import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { withAuthHeaders } from "../scanners/authenticated-requester";
import { runMutationTestCycle } from "../mutation/mutation-cycle";
import { addMutationScopeEntry } from "../mutation/mutation-scope";
import type { ResourceKey } from "../mutation/resource-key";
import type { DiscoveredOperation } from "../operation-discovery/discovered-operation";
import { testPriceIntegrity, testQuantityBoundaries } from "./price-integrity-analyzer";
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

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-price-integrity-integration-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 5, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "1" });
  return { db, scanRunId: 1 };
}

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

describe("Section 13.15 — Price/Amount Integrity testing against the real fixture project.price field", () => {
  it("mutates a price field only via the LOCAL_FIXTURE Test Capability against a LOCAL_FIXTURE target, and produces the expected finding", async () => {
    const { db, scanRunId } = freshScanRun();
    const resourceUrl = `${origin()}/api/projects/1`;
    const resourceKey: ResourceKey = { targetId: 1, origin: origin(), objectType: "project", resourceId: "1" };
    const operations: DiscoveredOperation[] = [
      { method: "GET", url: resourceUrl, source: "OPENAPI", confidence: "HIGH" },
      { method: "PATCH", url: resourceUrl, source: "OPENAPI", confidence: "HIGH" },
    ];

    const result = await testPriceIntegrity({
      fieldPath: "price",
      targetEnvironment: "LOCAL_FIXTURE",
      localFixtureTestCapabilityEnabled: true,
      clientSuppliedValue: 1,
      performMutationAndReadResult: async () => {
        const cycleResult = await runMutationTestCycle({
          db,
          scanRunId,
          requester: withAuthHeaders(httpClient, { Authorization: "Bearer userA-token" }),
          resourceKey,
          resourceUrl,
          fieldPath: "price",
          testValue: 1,
          initiator: "API",
          holder: "API:PRICE_INTEGRITY",
          operations,
        });
        expect(cycleResult.outcome).toBe("RESTORE_OK");
        return (JSON.parse(cycleResult.postMutationBody) as { price: number }).price;
      },
    });

    expect(result).toEqual({ status: "TESTED", result: { control: "CLIENT_CONTROLLED", finding: true } });
  });

  it("never attempts a risky mutation of the denylisted price field against a non-fixture target", async () => {
    let invocationCount = 0;
    const result = await testPriceIntegrity({
      fieldPath: "price",
      targetEnvironment: "PRODUCTION",
      localFixtureTestCapabilityEnabled: true,
      clientSuppliedValue: 1,
      performMutationAndReadResult: async () => {
        invocationCount++;
        return 1;
      },
    });

    expect(invocationCount).toBe(0);
    expect(result).toEqual({ status: "VALIDATION_PROBE_ONLY" });
  });
});

describe("Section 13.15 — Quantity Boundary testing against the real fixture settings-enforced endpoint", () => {
  it("detects the fixture's real lower-bound gap: 0 and a negative quantity are wrongly accepted alongside the enforced upper bound", async () => {
    const result = await testQuantityBoundaries({
      fieldPath: "quantity",
      targetEnvironment: "LOCAL_FIXTURE",
      localFixtureTestCapabilityEnabled: true,
      max: 10,
      performBoundaryAttempt: async (value) => {
        const response = await httpClient.request(`${origin()}/api/settings-enforced`, {
          method: "PATCH",
          headers: { Authorization: "Bearer userA-token", "Content-Type": "application/json" },
          body: JSON.stringify({ quantity: value }),
        });
        return { accepted: response.status === 200 };
      },
    });

    expect(result.status).toBe("TESTED");
    if (result.status !== "TESTED") throw new Error("unreachable");
    expect(result.outcomes).toEqual([
      { boundary: "ZERO", value: 0, accepted: true },
      { boundary: "NEGATIVE", value: -1, accepted: true },
      { boundary: "MAX", value: 10, accepted: true },
      { boundary: "MAX_PLUS_ONE", value: 11, accepted: false },
    ]);
    expect(result.finding).toBe(true);
  });
});
