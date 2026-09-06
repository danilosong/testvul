import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { discoverRuntimeSurface } from "./browser-runtime-discovery";
import { discoverAndClassifyActions } from "./action-discovery";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let browser: Browser;

beforeAll(async () => {
  servers = createServers();
  ports = await servers.start();
  browser = await chromium.launch({ headless: true });
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
  dir = mkdtempSync(join(tmpdir(), "sca-action-discovery-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'PASSIVE', 5, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("Action Discovery against the fixture app's Settings page (Section 12.14)", () => {
  it("classifies 'Save Settings' as SAFE_MUTATION and 'Delete Account' as DESTRUCTIVE", async () => {
    const { db, scanRunId } = freshScanRun();
    const origin = `http://127.0.0.1:${ports.httpPort}`;

    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin }]);
    const result = await discoverRuntimeSurface(context, `${origin}/app/settings`);
    await context.close();

    const actions = discoverAndClassifyActions(db, scanRunId, result.url, result.buttons);

    const saveSettings = actions.find((a) => a.label === "Save Settings");
    const deleteAccount = actions.find((a) => a.label === "Delete Account");

    expect(saveSettings?.classification).toBe("SAFE_MUTATION");
    expect(deleteAccount?.classification).toBe("DESTRUCTIVE");

    // Persisted, not just returned in memory.
    const rows = db.prepare("SELECT label, classification FROM browser_actions WHERE scan_run_id = ?").all(scanRunId) as {
      label: string;
      classification: string;
    }[];
    expect(rows).toContainEqual({ label: "Save Settings", classification: "SAFE_MUTATION" });
    expect(rows).toContainEqual({ label: "Delete Account", classification: "DESTRUCTIVE" });
  }, 30_000);
});
