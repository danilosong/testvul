import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db/connection";
import { runMigrations } from "../../db/migrator";
import { ScopeValidator } from "../../scope";
import { SecurityHttpClient } from "../../http/security-http-client";
import { withAuthHeaders } from "../authenticated-requester";
import { addMutationScopeEntry } from "../../mutation/mutation-scope";
import { runMutationTestCycle } from "../../mutation/mutation-cycle";
import { discoverRuntimeSurface } from "../../browser/browser-runtime-discovery";
import { classifyWriteIdorFinding } from "./write-idor-finding";
import type { ResourceKey } from "../../mutation/resource-key";
import type { DiscoveredOperation } from "../../operation-discovery/discovered-operation";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "db", "migrations");
const USER_A_PROFILE_ID = 1;
const USER_B_PROFILE_ID = 2;

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let browser: Browser;
let httpClient: SecurityHttpClient;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  browser = await chromium.launch({ headless: true });
  httpClient = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
}, 60_000);

afterAll(async () => {
  await browser.close();
  await servers.stop();
});

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshScanRun(): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-write-idor-finding-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 5, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "2" });
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User A', 'BEARER')").run(); // id 1
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User B', 'BEARER')").run(); // id 2
  return { db, scanRunId: 1 };
}

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

describe("UI absence is never evidence of backend authorization (Section 12.21)", () => {
  it("a backend PATCH acceptance from User A on User B's resource is flagged Broken Authorization, even though the UI never exposed an edit control for it", async () => {
    const { db, scanRunId } = freshScanRun();
    const resourceUrl = `${origin()}/api/projects/2`; // owned by userB
    const resourceKey: ResourceKey = { targetId: 1, origin: origin(), objectType: "project", resourceId: "2" };

    // Confirm the premise first: as User A, the UI genuinely exposes no
    // control at all on User B's project detail page — not for
    // analyticsGtm, not for anything.
    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    const discovery = await discoverRuntimeSurface(context, `${origin()}/app/projects/2`);
    expect(discovery.buttons).toEqual([]);
    await context.close();

    // Yet the backend accepts User A's write to User B's analyticsGtm field.
    const operations: DiscoveredOperation[] = [
      { method: "GET", url: resourceUrl, source: "OPENAPI", confidence: "HIGH" },
      { method: "PATCH", url: resourceUrl, source: "OPENAPI", confidence: "HIGH" },
    ];
    const cycleResult = await runMutationTestCycle({
      db,
      scanRunId,
      requester: withAuthHeaders(httpClient, { Authorization: "Bearer userA-token" }),
      resourceKey,
      resourceUrl,
      fieldPath: "analyticsGtm",
      testValue: "GTM-BROKENAUTH",
      initiator: "API",
      holder: "API:IDOR_SCANNER",
      operations,
    });
    expect(cycleResult.outcome).toBe("RESTORE_OK");

    // The classification never consults any UI/browser_actions data at
    // all — only who acted, who owns the resource, and whether the
    // backend accepted it.
    const mutationWasAccepted = cycleResult.outcome === "RESTORE_OK";
    const classification = classifyWriteIdorFinding(USER_A_PROFILE_ID, USER_B_PROFILE_ID, mutationWasAccepted);
    expect(classification).toBe("BROKEN_AUTHORIZATION");
  }, 30_000);
});
