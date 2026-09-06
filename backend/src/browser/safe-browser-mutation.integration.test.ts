import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { withAuthHeaders } from "../scanners/authenticated-requester";
import { addMutationScopeEntry } from "../mutation/mutation-scope";
import { getLatestJournalEntry } from "../mutation/mutation-journal-repository";
import { runSafeBrowserMutation } from "./safe-browser-mutation";
import type { DiscoveredAction } from "./action-discovery";
import type { ResourceKey } from "../mutation/resource-key";
import type { DiscoveredOperation } from "../operation-discovery/discovered-operation";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

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

function freshScanRun(scanMode: string): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-safe-browser-mutation-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', ?, 5, 'LOCAL_FIXTURE')",
  ).run(scanMode);
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  addMutationScopeEntry(db, { targetId: 1, objectType: "settings", resourceId: "userA" });
  return { db, scanRunId: 1 };
}

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

const SCOPE = new ScopeValidator(["127.0.0.1"]);
const RESOURCE_URL = () => `${origin()}/api/settings`;
const RESOURCE: ResourceKey = { targetId: 1, origin: "http://127.0.0.1", objectType: "settings", resourceId: "userA" };
const SAVE_SETTINGS_ACTION: DiscoveredAction = {
  id: 1,
  pageUrl: "",
  selector: ".save-settings-btn",
  label: "Save Settings",
  classification: "SAFE_MUTATION",
};
function staticOperations(): DiscoveredOperation[] {
  return [
    { method: "GET", url: RESOURCE_URL(), source: "OPENAPI", confidence: "HIGH" },
    { method: "PATCH", url: RESOURCE_URL(), source: "OPENAPI", confidence: "HIGH" },
  ];
}

async function fetchSettings(): Promise<{ quantity: number }> {
  const res = await fetch(RESOURCE_URL(), { headers: { Cookie: "session=userA-token" } });
  return res.json();
}

describe("Safe Browser Mutation discovery-before-mutation sequence against the fixture app (Section 12.20)", () => {
  it("an already-eligible SAFE_MUTATION action confirms backup, journal update, UI+API verification, and restore/restore-verification all occur", async () => {
    const { db, scanRunId } = freshScanRun("SAFE_AUTOMATIC");
    const before = await fetchSettings();

    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);

    const outcome = await runSafeBrowserMutation({
      db,
      scanRunId,
      disposableContext: context,
      requester: withAuthHeaders(httpClient, { Cookie: "session=userA-token" }),
      action: { ...SAVE_SETTINGS_ACTION, pageUrl: `${origin()}/app/settings` },
      pageUrl: `${origin()}/app/settings`,
      scopeValidator: SCOPE,
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL(),
      fieldPath: "quantity",
      testValue: before.quantity + 5,
      minConfidence: "MEDIUM",
      existingOperations: staticOperations(), // an already-established static operation template
      scanMode: "SAFE_AUTOMATIC",
      mutationAuthorized: true,
    });

    expect(outcome.status).toBe("MUTATED");
    if (outcome.status === "MUTATED") {
      expect(outcome.cycleResult.outcome).toBe("RESTORE_OK");
    }

    // Journal shows the full backup -> mutate -> restore sequence completed.
    const journalEntry = getLatestJournalEntry(db, RESOURCE);
    expect(journalEntry?.state).toBe("RESTORE_OK");

    // API verification: the resource is back to its original value.
    const afterApi = await fetchSettings();
    expect(afterApi.quantity).toBe(before.quantity);

    // UI verification: the browser's own rendered page shows the restored value too.
    const page = await context.newPage();
    await page.goto(`${origin()}/app/settings`);
    const displayed = await page.$eval(".quantity-value >> nth=0", (el) => el.textContent);
    expect(displayed).toBe(String(before.quantity));
    await page.close();

    await context.close();
  }, 30_000);

  it("no SAFE_MUTATION executes without confirmed authorization", async () => {
    const { db, scanRunId } = freshScanRun("SAFE_AUTOMATIC");
    const before = await fetchSettings();

    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);

    const outcome = await runSafeBrowserMutation({
      db,
      scanRunId,
      disposableContext: context,
      requester: withAuthHeaders(httpClient, { Cookie: "session=userA-token" }),
      action: { ...SAVE_SETTINGS_ACTION, pageUrl: `${origin()}/app/settings` },
      pageUrl: `${origin()}/app/settings`,
      scopeValidator: SCOPE,
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL(),
      fieldPath: "quantity",
      testValue: before.quantity + 5,
      minConfidence: "MEDIUM",
      existingOperations: staticOperations(),
      scanMode: "SAFE_AUTOMATIC",
      mutationAuthorized: false, // never confirmed
    });

    expect(outcome.status).toBe("NOT_AUTHORIZED");
    const after = await fetchSettings();
    expect(after.quantity).toBe(before.quantity);

    await context.close();
  }, 30_000);

  it("never clicks a SAFE_MUTATION-classified action for real before an operation template has been established", async () => {
    const { db, scanRunId } = freshScanRun("SAFE_AUTOMATIC");
    const before = await fetchSettings();

    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);

    const outcome = await runSafeBrowserMutation({
      db,
      scanRunId,
      disposableContext: context,
      requester: withAuthHeaders(httpClient, { Cookie: "session=userA-token" }),
      action: { ...SAVE_SETTINGS_ACTION, pageUrl: `${origin()}/app/settings` },
      pageUrl: `${origin()}/app/settings`,
      scopeValidator: SCOPE,
      resourceKey: RESOURCE,
      resourceUrl: RESOURCE_URL(),
      fieldPath: "quantity",
      testValue: before.quantity + 5,
      minConfidence: "MEDIUM",
      existingOperations: [], // no static template
      scanMode: "SAFE_AUTOMATIC",
      mutationAuthorized: true,
      interceptionInstallable: false, // and Dry-Run Capture can't establish one either
    });

    expect(outcome.status).toBe("NO_OPERATION_TEMPLATE");
    // Never reached runMutationTestCycle at all — the resource is untouched.
    const after = await fetchSettings();
    expect(after.quantity).toBe(before.quantity);
    expect(getLatestJournalEntry(db, RESOURCE)).toBeNull();

    await context.close();
  }, 30_000);
});
