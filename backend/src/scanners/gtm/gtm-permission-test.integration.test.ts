import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db/connection";
import { runMigrations } from "../../db/migrator";
import { ScopeValidator } from "../../scope";
import { SecurityHttpClient } from "../../http/security-http-client";
import { runGtmPermissionTest } from "./gtm-permission-test";
import { evaluateGtmPermissionFinding } from "./gtm-finding-policy";
import { addMutationScopeEntry } from "../../mutation/mutation-scope";
import { setAuthorizationExpectation, getAuthorizationExpectation } from "../../auth/authorization-expectations-repository";
import { withAuthHeaders } from "../authenticated-requester";
import type { ResourceKey } from "../../mutation/resource-key";
import type { DiscoveredOperation } from "../../operation-discovery/discovered-operation";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "db", "migrations");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let httpClient: SecurityHttpClient;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  httpClient = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
});

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
  dir = mkdtempSync(join(tmpdir(), "sca-gtm-permission-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 5, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "1" });
  return { db, scanRunId: 1 };
}

function insertAuthProfile(db: Db, name: string): number {
  const result = db.prepare("INSERT INTO auth_profiles (name, method) VALUES (?, 'BEARER')").run(name);
  return Number(result.lastInsertRowid);
}

const RESOURCE = (): ResourceKey => ({ targetId: 1, origin: `http://127.0.0.1:${ports.httpPort}`, objectType: "project", resourceId: "1" });
const RESOURCE_URL = () => `http://127.0.0.1:${ports.httpPort}/api/projects/1`;
const OPERATIONS = (): DiscoveredOperation[] => [
  { method: "GET", url: RESOURCE_URL(), source: "OPENAPI", confidence: "HIGH" },
  { method: "PATCH", url: RESOURCE_URL(), source: "OPENAPI", confidence: "HIGH" },
];

describe("GTM permission test against the real fixture app, gated on the Expected Permission Policy", () => {
  it("low-privilege AUTHORIZED contradicting a DENIED expectation produces an Authorization Policy Violation finding", async () => {
    const { db, scanRunId } = freshScanRun();
    const userBProfileId = insertAuthProfile(db, "User B");
    setAuthorizationExpectation(db, { authProfileId: userBProfileId, action: "analyticsGtm", expected: "DENIED" });

    // analyticsGtm is the fixture's intentionally vulnerable field: any
    // authenticated user (not just the owner) can change it.
    const result = await runGtmPermissionTest({
      db,
      scanRunId,
      requester: withAuthHeaders(httpClient, { Authorization: "Bearer userB-token" }),
      resourceKey: RESOURCE(),
      resourceUrl: RESOURCE_URL(),
      fieldPath: "analyticsGtm",
      initiator: "API",
      holder: "API:GTM_SCANNER",
      operations: OPERATIONS(),
    });

    expect(result.outcome).toBe("AUTHORIZED");
    expect(result.restoreOutcome).toBe("RESTORE_OK");

    const expectation = getAuthorizationExpectation(db, userBProfileId, "analyticsGtm");
    expect(evaluateGtmPermissionFinding(result.outcome, expectation)).toBe("AUTHORIZATION_POLICY_VIOLATION");
  });

  it("Admin AUTHORIZED matching an ALLOWED expectation produces no finding", async () => {
    const { db, scanRunId } = freshScanRun();
    const adminProfileId = insertAuthProfile(db, "Admin");
    setAuthorizationExpectation(db, { authProfileId: adminProfileId, action: "protectedGtm", expected: "ALLOWED" });

    const result = await runGtmPermissionTest({
      db,
      scanRunId,
      requester: withAuthHeaders(httpClient, { Authorization: "Bearer admin-token" }),
      resourceKey: RESOURCE(),
      resourceUrl: RESOURCE_URL(),
      fieldPath: "protectedGtm",
      initiator: "API",
      holder: "API:GTM_SCANNER",
      operations: OPERATIONS(),
    });

    expect(result.outcome).toBe("AUTHORIZED");

    const expectation = getAuthorizationExpectation(db, adminProfileId, "protectedGtm");
    expect(evaluateGtmPermissionFinding(result.outcome, expectation)).toBe("NO_FINDING");
  });

  it("a format-rejection fixture produces VALIDATION_REJECTED — no finding, distinct from UNAUTHORIZED", async () => {
    const { db, scanRunId } = freshScanRun();
    const userAProfileId = insertAuthProfile(db, "User A");
    // Even with a DENIED expectation configured, a validation rejection must never surface as a finding.
    setAuthorizationExpectation(db, { authProfileId: userAProfileId, action: "strictFormatGtm", expected: "DENIED" });

    // strictFormatGtm requires /^GTM-[A-Z]{4}\d{4}$/ — the default canary
    // "GTM-SECURITYTEST" doesn't match, and userA owns project 1 so this
    // isn't a permission failure.
    const result = await runGtmPermissionTest({
      db,
      scanRunId,
      requester: withAuthHeaders(httpClient, { Authorization: "Bearer userA-token" }),
      resourceKey: RESOURCE(),
      resourceUrl: RESOURCE_URL(),
      fieldPath: "strictFormatGtm",
      initiator: "API",
      holder: "API:GTM_SCANNER",
      operations: OPERATIONS(),
    });

    expect(result.outcome).toBe("VALIDATION_REJECTED");
    expect(result.outcome).not.toBe("UNAUTHORIZED");

    const expectation = getAuthorizationExpectation(db, userAProfileId, "strictFormatGtm");
    expect(evaluateGtmPermissionFinding(result.outcome, expectation)).toBe("NO_FINDING");
  });

  it("an unconfigured expectation produces INCONCLUSIVE_PERMISSION_EXPECTATION", async () => {
    const { db, scanRunId } = freshScanRun();
    const userBProfileId = insertAuthProfile(db, "User B");
    // No authorization_expectations row configured for this profile/action at all.

    const result = await runGtmPermissionTest({
      db,
      scanRunId,
      requester: withAuthHeaders(httpClient, { Authorization: "Bearer userB-token" }),
      resourceKey: RESOURCE(),
      resourceUrl: RESOURCE_URL(),
      fieldPath: "analyticsGtm",
      initiator: "API",
      holder: "API:GTM_SCANNER",
      operations: OPERATIONS(),
    });

    expect(result.outcome).toBe("AUTHORIZED");
    const expectation = getAuthorizationExpectation(db, userBProfileId, "analyticsGtm");
    expect(expectation).toBe("NO_EXPECTATION_CONFIGURED");
    expect(evaluateGtmPermissionFinding(result.outcome, expectation)).toBe("INCONCLUSIVE_PERMISSION_EXPECTATION");
  });

  it("never loads an external GTM container — the canary id is a dedicated test-only marker, never a real container", async () => {
    const { db, scanRunId } = freshScanRun();
    const result = await runGtmPermissionTest({
      db,
      scanRunId,
      requester: withAuthHeaders(httpClient, { Authorization: "Bearer userA-token" }),
      resourceKey: RESOURCE(),
      resourceUrl: RESOURCE_URL(),
      fieldPath: "analyticsGtm",
      initiator: "API",
      holder: "API:GTM_SCANNER",
      operations: OPERATIONS(),
    });

    expect(result.outcome).toBe("AUTHORIZED");
    // Restored back to the fixture's real seeded value afterward.
    const after = await httpClient.request(RESOURCE_URL(), { headers: { Authorization: "Bearer userA-token" } });
    const project = JSON.parse(after.body) as { analyticsGtm: string };
    expect(project.analyticsGtm).toBe("GTM-REAL0001");
  });
});
