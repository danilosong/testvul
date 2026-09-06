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
import { classifyBusinessOperationSafety, executeBusinessOperation } from "./business-operation-safety";
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

describe("Section 13.19 — a SAFE_REVERSIBLE_MUTATION business operation goes through the identical mutation-cycle chain as an API-driven mutation", () => {
  it("records the full BACKUP_CREATED -> MUTATION_PENDING -> MUTATION_APPLIED -> RESTORE_PENDING -> RESTORE_OK journal sequence against a real fixture field", async () => {
    dir = mkdtempSync(join(tmpdir(), "sca-business-operation-safety-integration-"));
    db = openDb(join(dir, "test.db"));
    runMigrations(db, MIGRATIONS_DIR);
    db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
    db.prepare(
      "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 5, 'LOCAL_FIXTURE')",
    ).run();
    db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
    addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "1" });

    const resourceUrl = `${origin()}/api/projects/1`;
    const resourceKey: ResourceKey = { targetId: 1, origin: origin(), objectType: "project", resourceId: "1" };
    const operations: DiscoveredOperation[] = [
      { method: "GET", url: resourceUrl, source: "OPENAPI", confidence: "HIGH" },
      { method: "PATCH", url: resourceUrl, source: "OPENAPI", confidence: "HIGH" },
    ];

    const classification = classifyBusinessOperationSafety({
      isDestructive: false,
      performsMutation: true,
      issuesRequest: true,
      isFinancialField: false,
      isSensitiveField: false,
    });
    expect(classification).toBe("SAFE_REVERSIBLE_MUTATION");

    const currentDb = db;
    const result = await executeBusinessOperation({
      classification,
      targetEnvironment: "PRODUCTION", // SAFE_REVERSIBLE_MUTATION runs regardless — the mutation cycle itself proves it's safe to
      performViaMutationCycle: () =>
        runMutationTestCycle({
          db: currentDb,
          scanRunId: 1,
          requester: withAuthHeaders(httpClient, { Authorization: "Bearer userA-token" }),
          resourceKey,
          resourceUrl,
          fieldPath: "notes",
          testValue: "business-logic-operation-safety-probe",
          initiator: "API",
          holder: "API:BUSINESS_LOGIC",
          operations,
        }),
    });

    expect(result.status).toBe("EXECUTED_VIA_MUTATION_CYCLE");
    if (result.status !== "EXECUTED_VIA_MUTATION_CYCLE") throw new Error("unreachable");
    expect(result.result.outcome).toBe("RESTORE_OK");

    const rows = db.prepare("SELECT state FROM mutation_journal WHERE resource_id = ? ORDER BY id").all("1") as { state: string }[];
    expect(rows.map((row) => row.state)).toEqual(["BACKUP_CREATED", "MUTATION_PENDING", "MUTATION_APPLIED", "RESTORE_PENDING", "RESTORE_OK"]);

    // Confirms the field was genuinely restored — identical end state to any other scanner's mutation cycle.
    const verifyResponse = await httpClient.request(resourceUrl, { headers: { Authorization: "Bearer userA-token" } });
    expect((JSON.parse(verifyResponse.body) as { notes: string }).notes).not.toBe("business-logic-operation-safety-probe");
  });
});
