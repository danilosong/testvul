import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { discoverRuntimeSurface } from "./browser-runtime-discovery";
import { discoverDownloadActions } from "./download-actions";
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
  dir = mkdtempSync(join(tmpdir(), "sca-download-actions-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 5, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("Download Actions Are Discovered, Never Executed — against the fixture app's Reports page (Section 12.17)", () => {
  it("the 'Export Report' control is discovered and classified DOWNLOAD_ACTION but never clicked", async () => {
    const { db, scanRunId } = freshScanRun();
    const origin = `http://127.0.0.1:${ports.httpPort}`;

    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin }]);
    const result = await discoverRuntimeSurface(context, `${origin}/app/reports`);

    expect(result.downloadLinks).toHaveLength(1);
    expect(result.downloadLinks[0]!.label).toBe("Export Report");

    const actions = discoverDownloadActions(db, scanRunId, result.url, result.downloadLinks);
    expect(actions).toHaveLength(1);

    const row = db.prepare("SELECT label, classification, status FROM browser_actions WHERE id = ?").get(actions[0]!.id) as {
      label: string;
      classification: string;
      status: string;
    };
    expect(row).toEqual({ label: "Export Report", classification: "DOWNLOAD_ACTION", status: "DISCOVERED" });

    // Proven, not just assumed: /api/export-report was never actually
    // requested during discovery — the export link was read out of the
    // DOM, never clicked/navigated.
    const exportRequests = result.apiCalls.filter((r) => r.url.includes("/api/export-report"));
    expect(exportRequests).toHaveLength(0);

    await context.close();
  }, 30_000);
});
