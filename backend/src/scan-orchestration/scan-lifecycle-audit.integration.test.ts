import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { withAuthHeaders } from "../scanners/authenticated-requester";
import { resolveDns } from "../dns/resolver";
import { discoverRoot } from "../discovery/http-discovery";
import { runMutationTestCycle } from "../mutation/mutation-cycle";
import { addMutationScopeEntry } from "../mutation/mutation-scope";
import { listAuditEvents } from "../mutation/audit-events-repository";
import type { DiscoveredOperation } from "../operation-discovery/discovered-operation";
import { runPipelineWithAuditTrail } from "./scan-lifecycle-audit";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
}, 60_000);

afterAll(async () => {
  await servers.stop();
});

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

describe("Section 14.5 — the scan lifecycle audit trail against a real scan run, including one write test", () => {
  it("asserts a complete, correctly-ordered event sequence for a full scan", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sca-scan-lifecycle-audit-integration-"));
    const db: Db = openDb(join(dir, "test.db"));
    runMigrations(db, MIGRATIONS_DIR);
    db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
    db.prepare(
      "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 5, 'LOCAL_FIXTURE')",
    ).run();
    db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
    const scanRunId = 1;
    addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "1" });

    const scopeValidator = new ScopeValidator(["127.0.0.1"]);
    const httpClient = new SecurityHttpClient({ scopeValidator, allowPrivateNetworks: true });
    const resourceUrl = `${origin()}/api/projects/1`;
    const operations: DiscoveredOperation[] = [
      { method: "GET", url: resourceUrl, source: "OPENAPI", confidence: "HIGH" },
      { method: "PATCH", url: resourceUrl, source: "OPENAPI", confidence: "HIGH" },
    ];

    await runPipelineWithAuditTrail(db, scanRunId, {
      stageRunners: {
        DNS_RESOLVER: () => resolveDns("127.0.0.1"),
        SCOPE_VALIDATION: async () => scopeValidator.isInScope(origin()),
        HTTP_DISCOVERY: () => discoverRoot(httpClient, origin()),
        SECURITY_TESTS: () =>
          runMutationTestCycle({
            db,
            scanRunId,
            requester: withAuthHeaders(httpClient, { Authorization: "Bearer userA-token" }),
            resourceKey: { targetId: 1, origin: origin(), objectType: "project", resourceId: "1" },
            resourceUrl,
            fieldPath: "notes",
            testValue: "scan-lifecycle-audit-probe",
            initiator: "API",
            holder: "API:SCAN_LIFECYCLE_AUDIT_TEST",
            operations,
          }),
      },
    });

    const events = listAuditEvents(db, scanRunId);
    expect(events.map((e) => e.eventType)).toEqual([
      "SCAN_STARTED",
      "STAGE_DNS_RESOLVER_RUNNING",
      "STAGE_DNS_RESOLVER_COMPLETED",
      "STAGE_SCOPE_VALIDATION_RUNNING",
      "STAGE_SCOPE_VALIDATION_COMPLETED",
      "STAGE_HTTP_DISCOVERY_RUNNING",
      "STAGE_HTTP_DISCOVERY_COMPLETED",
      "STAGE_SECURITY_TESTS_RUNNING",
      "STAGE_SECURITY_TESTS_COMPLETED",
      "SCAN_FINISHED",
    ]);
    expect(events[events.length - 1]?.payload).toEqual({ outcome: "COMPLETED" });

    // The write test genuinely ran and restored — the audit trail describes a real scan, not a no-op.
    const journalRows = db.prepare("SELECT state FROM mutation_journal WHERE resource_id = '1' ORDER BY id DESC LIMIT 1").all() as { state: string }[];
    expect(journalRows[0]?.state).toBe("RESTORE_OK");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});
