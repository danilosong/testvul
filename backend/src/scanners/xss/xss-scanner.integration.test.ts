import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db/connection";
import { runMigrations } from "../../db/migrator";
import { ScopeValidator } from "../../scope";
import { SecurityHttpClient } from "../../http/security-http-client";
import { XssScanner } from "./xss-scanner";
import { addMutationScopeEntry } from "../../mutation/mutation-scope";
import { insertCandidate } from "../../eligibility/candidates-repository";
import { getEvidenceById } from "../../evidence/evidence-repository";
import type { ScanContext, Candidate } from "../security-scanner";
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
  dir = mkdtempSync(join(tmpdir(), "sca-xss-scanner-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 5, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

const RESOURCE = (): ResourceKey => ({ targetId: 1, origin: `http://127.0.0.1:${ports.httpPort}`, objectType: "project", resourceId: "1" });
const RESOURCE_URL = () => `http://127.0.0.1:${ports.httpPort}/api/projects/1`;
const OPERATIONS = (): DiscoveredOperation[] => [
  { method: "GET", url: RESOURCE_URL(), source: "OPENAPI", confidence: "HIGH" },
  { method: "PATCH", url: RESOURCE_URL(), source: "OPENAPI", confidence: "HIGH" },
];

function candidateFor(db: Db, scanRunId: number, fieldPath: string): Candidate {
  const persisted = insertCandidate(db, scanRunId, {
    scanner: "XSS",
    resourceKey: RESOURCE(),
    resourceUrl: RESOURCE_URL(),
    writeMethod: "PATCH",
    fieldPath,
    operations: OPERATIONS(),
    minConfidence: "MEDIUM",
    isPassiveTest: false,
    inScope: true,
    hasRequiredAuth: true,
    requiresOwnershipData: false,
    hasOwnershipData: false,
    advancedOverrideConfirmed: false,
    environmentPolicyAllows: true,
    localFixtureDenylistOverrideActive: false,
  });
  expect(persisted.eligibilityState).toBe("TESTABLE");

  return {
    id: persisted.id,
    scanner: "XSS",
    resourceKey: RESOURCE(),
    resourceUrl: RESOURCE_URL(),
    fieldPath,
    writeMethod: "PATCH",
    eligibilityState: persisted.eligibilityState,
    browserTestability: persisted.browserTestability,
  };
}

function contextFor(db: Db, scanRunId: number): ScanContext {
  return {
    db,
    scanRunId,
    httpClient,
    operations: OPERATIONS(),
    minConfidence: "MEDIUM",
    authHeaders: { Authorization: "Bearer userA-token" }, // userA owns project 1
  };
}

describe("XssScanner base canary test against the real fixture app", () => {
  it("detects RAW_HTML against the fixture's vulnerable (stored-verbatim) field", async () => {
    const { db, scanRunId } = freshScanRun();
    addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "1" });
    const scanner = new XssScanner(httpClient);

    const result = await scanner.test(contextFor(db, scanRunId), candidateFor(db, scanRunId, "notes"));

    expect(result.verdict).toBe("RAW_HTML");
    const evidence = getEvidenceById(db, result.evidenceIds[0]!)!;
    expect(evidence.restoreStatus).toBe("RESTORE_OK");
  });

  it("detects ESCAPED against the fixture's HTML-escaping field", async () => {
    const { db, scanRunId } = freshScanRun();
    addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "1" });
    const scanner = new XssScanner(httpClient);

    const result = await scanner.test(contextFor(db, scanRunId), candidateFor(db, scanRunId, "description"));

    expect(result.verdict).toBe("ESCAPED");
  });

  it("detects HTML_ALLOWED against the fixture's allowlist-sanitizing field", async () => {
    const { db, scanRunId } = freshScanRun();
    addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "1" });
    const scanner = new XssScanner(httpClient);

    const result = await scanner.test(contextFor(db, scanRunId), candidateFor(db, scanRunId, "summaryHtml"));

    expect(result.verdict).toBe("HTML_ALLOWED");
  });

  it("always restores the original field value after classifying, regardless of verdict", async () => {
    const { db, scanRunId } = freshScanRun();
    addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "1" });
    const scanner = new XssScanner(httpClient);

    await scanner.test(contextFor(db, scanRunId), candidateFor(db, scanRunId, "notes"));

    const after = await httpClient.request(RESOURCE_URL(), { headers: { Authorization: "Bearer userA-token" } });
    const project = JSON.parse(after.body) as { notes: string };
    expect(project.notes).toBe("Welcome to Alpha");
  });
});

describe("XssScanner Sanitizer Probe against the real fixture app", () => {
  it("classifies UNSAFE_ATTRIBUTE_SURVIVED against the fixture's vulnerable (stored-verbatim) field, without executing anything", async () => {
    const { db, scanRunId } = freshScanRun();
    addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "1" });
    const scanner = new XssScanner(httpClient);

    const result = await scanner.testSanitizerProbe(contextFor(db, scanRunId), candidateFor(db, scanRunId, "notes"));

    expect(result.verdict).toBe("UNSAFE_ATTRIBUTE_SURVIVED");

    // Always restored afterward, same guarantee as the base canary test.
    const after = await httpClient.request(RESOURCE_URL(), { headers: { Authorization: "Bearer userA-token" } });
    const project = JSON.parse(after.body) as { notes: string };
    expect(project.notes).toBe("Welcome to Alpha");
  });
});
