import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { withAuthHeaders } from "../scanners/authenticated-requester";
import { runMutationTestCycle } from "../mutation/mutation-cycle";
import { addMutationScopeEntry } from "../mutation/mutation-scope";
import type { DiscoveredOperation } from "../operation-discovery/discovered-operation";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestScanCancellation, runCancellableSecurityTestsAndFinalize } from "./scan-cancellation";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

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

describe("Section 14.7 — Safe Scan Cancellation against a real, in-flight mutation cycle (1.6)", () => {
  it("lets an in-flight resource's real restore complete before the scan reports CANCELLED, and never starts the next test", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sca-scan-cancellation-integration-"));
    const db: Db = openDb(join(dir, "test.db"));
    runMigrations(db, MIGRATIONS_DIR);
    db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
    db.prepare(
      "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 5, 'LOCAL_FIXTURE')",
    ).run();
    db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
    const scanRunId = 1;
    addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "1" });

    const scopeValidator = new ScopeValidator(["127.0.0.1"]);
    const httpClient = new SecurityHttpClient({ scopeValidator, allowPrivateNetworks: true });
    const requester = withAuthHeaders(httpClient, { Authorization: "Bearer userA-token" });
    const resourceUrl = `${origin()}/api/projects/1`;
    const operations: DiscoveredOperation[] = [
      { method: "GET", url: resourceUrl, source: "OPENAPI", confidence: "HIGH" },
      { method: "PATCH", url: resourceUrl, source: "OPENAPI", confidence: "HIGH" },
    ];

    let secondTestStarted = false;

    const firstTest = async () => {
      // Cancellation arrives concurrently, right as this real mutation
      // cycle begins its own backup->mutate->restore work.
      requestScanCancellation(db, scanRunId, "operator@example.com");
      await runMutationTestCycle({
        db,
        scanRunId,
        requester,
        resourceKey: { targetId: 1, origin: origin(), objectType: "project", resourceId: "1" },
        resourceUrl,
        fieldPath: "notes",
        testValue: "cancellation-in-flight-probe",
        initiator: "API",
        holder: "API:CANCELLATION_TEST",
        operations,
      });
    };
    const secondTest = async () => {
      secondTestStarted = true;
    };

    const { queueResult, finalState } = await runCancellableSecurityTestsAndFinalize(db, scanRunId, [firstTest, secondTest], {
      unrecoverableErrorOccurred: false,
      anyQueueTruncated: false,
    });

    expect(secondTestStarted).toBe(false);
    expect(queueResult).toEqual({ startedCount: 1, skippedDueToCancellation: 1 });

    // The in-flight resource's real restore genuinely completed before finalization.
    const journalRows = db.prepare("SELECT state FROM mutation_journal WHERE resource_id = '1' ORDER BY id DESC LIMIT 1").all() as { state: string }[];
    expect(journalRows[0]?.state).toBe("RESTORE_OK");

    expect(finalState).toBe("CANCELLED");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});
