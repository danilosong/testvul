import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { discoverRuntimeSurface } from "./browser-runtime-discovery";
import { discoverAndClassifyActions } from "./action-discovery";
import { runDiscoveryStage } from "./discovery-stage";
import { assertNotDestructiveAction } from "./destructive-action-denylist";
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

function freshScanRun(scanMode: string): { db: Db; scanRunId: number } {
  dir = mkdtempSync(join(tmpdir(), "sca-destructive-denylist-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', ?, 5, 'LOCAL_FIXTURE')",
  ).run(scanMode);
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

describe("Destructive Action Denylist against the fixture app's Delete Account control (Section 12.16)", () => {
  it.each(["PASSIVE", "SAFE_AUTOMATIC", "ADVANCED"])(
    "the 'Delete Account' control is discovered and classified DESTRUCTIVE but never invoked, in %s mode",
    async (scanMode) => {
      const { db, scanRunId } = freshScanRun(scanMode);
      const origin = `http://127.0.0.1:${ports.httpPort}`;

      const context = await browser.newContext();
      await context.addCookies([{ name: "session", value: "userA-token", url: origin }]);
      const result = await discoverRuntimeSurface(context, `${origin}/app/settings`);

      const actions = discoverAndClassifyActions(db, scanRunId, result.url, result.buttons);
      const deleteAccount = actions.find((a) => a.label === "Delete Account");
      expect(deleteAccount?.classification).toBe("DESTRUCTIVE");
      // Never auto-executed, in any mode — assertNotDestructiveAction would refuse it outright.
      expect(() => assertNotDestructiveAction(deleteAccount!.label)).toThrow();

      const executeSafeRead = vi.fn().mockResolvedValue(undefined);
      const dryRunCapture = vi.fn().mockResolvedValue(undefined);
      await runDiscoveryStage(actions, { executeSafeRead, dryRunCapture });
      // The DESTRUCTIVE action never reaches either handler regardless of scanMode.
      expect(executeSafeRead).not.toHaveBeenCalledWith(deleteAccount);
      expect(dryRunCapture).not.toHaveBeenCalledWith(deleteAccount);

      await context.close();

      // The real backend state confirms it: the account still exists —
      // logging back in as userA still succeeds.
      const loginRes = await fetch(`${origin}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "userA", password: "userA-pass" }),
      });
      expect(loginRes.status).toBe(200);
    },
    30_000,
  );
});
