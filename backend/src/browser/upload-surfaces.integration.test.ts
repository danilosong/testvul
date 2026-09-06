import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { discoverRuntimeSurface } from "./browser-runtime-discovery";
import { discoverUploadSurfaces } from "./upload-surfaces";
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
  dir = mkdtempSync(join(tmpdir(), "sca-upload-surfaces-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 5, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("Upload Surfaces Are Discovered, Never Executed — against the fixture app's Reports page (Section 12.18)", () => {
  it("the upload form's file input is discovered and recorded, but no file is ever supplied or submitted", async () => {
    const { db, scanRunId } = freshScanRun();
    const origin = `http://127.0.0.1:${ports.httpPort}`;

    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin }]);
    const result = await discoverRuntimeSurface(context, `${origin}/app/reports`);

    expect(result.uploadSurfaces).toHaveLength(1);
    expect(result.uploadSurfaces[0]!.label).toBe("file");

    const surfaces = discoverUploadSurfaces(db, scanRunId, result.url, result.uploadSurfaces);
    expect(surfaces).toHaveLength(1);

    const row = db.prepare("SELECT label, classification, status FROM browser_actions WHERE id = ?").get(surfaces[0]!.id) as {
      label: string;
      classification: string;
      status: string;
    };
    expect(row).toEqual({ label: "file", classification: "UPLOAD_SURFACE", status: "DISCOVERED" });

    // Proven, not just assumed: no file was ever attached to the input,
    // and /api/upload was never actually requested.
    const page = await context.newPage();
    await page.goto(`${origin}/app/reports`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fileCount = await page.$eval('input[name="file"]', (el: any) => el.files?.length ?? 0);
    expect(fileCount).toBe(0);
    await page.close();

    const uploadRequests = result.apiCalls.filter((r) => r.url.includes("/api/upload"));
    expect(uploadRequests).toHaveLength(0);

    await context.close();
  }, 30_000);
});
