import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { runDryRunCapture, registerDryRunOperation } from "./dry-run-capture";
import { getDiscoveredOperations } from "../operation-discovery/discovered-operations-repository";
import { ScopeValidator } from "../scope";
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
  dir = mkdtempSync(join(tmpdir(), "sca-dry-run-capture-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', '127.0.0.1', '[]')").run();
  db.prepare(
    "INSERT INTO scan_run_configs (target_id, scope_json, scan_mode, rate_limit_rps, environment) VALUES (1, '[]', 'SAFE_AUTOMATIC', 5, 'LOCAL_FIXTURE')",
  ).run();
  db.prepare("INSERT INTO scan_runs (target_id, scan_run_config_id) VALUES (1, 1)").run();
  return { db, scanRunId: 1 };
}

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

const SCOPE = new ScopeValidator(["127.0.0.1"]);

async function fetchSettings(): Promise<{ quantity: number }> {
  const res = await fetch(`${origin()}/api/settings`, { headers: { Cookie: "session=userA-token" } });
  return res.json();
}

describe("Browser Dry-Run Request Capture against the fixture app (Section 12.19)", () => {
  it("captures the fixture's 'Save Settings' request, the backend receives no corresponding mutation, and the operation is registered correctly", async () => {
    const { db, scanRunId } = freshScanRun();
    const before = await fetchSettings();

    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);

    const outcome = await runDryRunCapture({
      context,
      pageUrl: `${origin()}/app/settings`,
      actionSelector: ".save-settings-btn",
      scopeValidator: SCOPE,
    });

    expect(outcome.status).toBe("CAPTURED");
    if (outcome.status === "CAPTURED") {
      expect(outcome.request.method).toBe("PATCH");
      expect(outcome.request.url).toBe(`${origin()}/api/settings`);
    }

    registerDryRunOperation(db, scanRunId, outcome);
    const operations = getDiscoveredOperations(db, scanRunId);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ method: "PATCH", url: `${origin()}/api/settings`, source: "BROWSER_DRY_RUN", confidence: "HIGH" });

    const after = await fetchSettings();
    expect(after.quantity).toBe(before.quantity); // never actually mutated

    await context.close();
  }, 30_000);

  it("classifies DRY_RUN_AMBIGUOUS when an action produces two distinct mutating requests, and neither reaches the backend", async () => {
    const { db, scanRunId } = freshScanRun();
    const beforeSettings = await fetchSettings();
    const beforeEnforcedRes = await fetch(`${origin()}/api/settings-enforced`, { headers: { Cookie: "session=userA-token" } });
    const beforeEnforced = await beforeEnforcedRes.json();

    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);

    const outcome = await runDryRunCapture({
      context,
      pageUrl: `${origin()}/app/settings`,
      actionSelector: "#two-mutations-btn",
      scopeValidator: SCOPE,
      // Injects a control that deliberately fires two distinct mutating
      // requests on one click — installed after navigation but before the
      // click, on the very page runDryRunCapture's interception already covers.
      beforeAction: async (page) => {
        await page.evaluate(() => {
          const btn = document.createElement("button");
          btn.id = "two-mutations-btn";
          btn.addEventListener("click", () => {
            fetch("/api/settings", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ quantity: 2 }),
            });
            fetch("/api/settings-enforced", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ quantity: 2 }),
            });
          });
          document.body.appendChild(btn);
        });
      },
    });
    await context.close();

    expect(outcome.status).toBe("DRY_RUN_AMBIGUOUS");
    if (outcome.status === "DRY_RUN_AMBIGUOUS") {
      const distinctKeys = new Set(outcome.requests.map((r) => `${r.method} ${r.url}`));
      expect(distinctKeys.size).toBe(2);
    }
    expect(getDiscoveredOperations(db, scanRunId)).toEqual([]);

    const afterSettings = await fetchSettings();
    const afterEnforcedRes = await fetch(`${origin()}/api/settings-enforced`, { headers: { Cookie: "session=userA-token" } });
    const afterEnforced = await afterEnforcedRes.json();
    expect(afterSettings.quantity).toBe(beforeSettings.quantity);
    expect(afterEnforced.quantity).toBe(beforeEnforced.quantity);
  }, 30_000);

  it("marks an unsafely-capturable action DRY_RUN_UNAVAILABLE rather than executing it", async () => {
    freshScanRun();
    const before = await fetchSettings();
    const context = await browser.newContext();
    await context.addCookies([{ name: "session", value: "userA-token", url: origin() }]);

    const outcome = await runDryRunCapture({
      context,
      pageUrl: `${origin()}/app/settings`,
      actionSelector: ".save-settings-btn",
      scopeValidator: SCOPE,
      interceptionInstallable: false, // simulates interception failing to install reliably before dispatch
    });

    expect(outcome.status).toBe("DRY_RUN_UNAVAILABLE");
    const after = await fetchSettings();
    expect(after.quantity).toBe(before.quantity);

    await context.close();
  }, 30_000);

  it("the primary session shows no side effect from a Dry-Run attempt run in a disposable page/context", async () => {
    freshScanRun();
    const primaryContext = await browser.newContext();
    await primaryContext.addCookies([{ name: "session", value: "userA-token", url: origin() }]);
    const primaryPage = await primaryContext.newPage();
    await primaryPage.goto(`${origin()}/app/settings`);
    // Bump the client-only counter to a distinctive, in-memory-only value.
    await primaryPage.click(".increase-btn >> nth=0");
    const primaryQuantityBefore = await primaryPage.$eval(".quantity-value >> nth=0", (el) => el.textContent);

    // A disposable context sharing the same session's cookies — never the primary page/context.
    const disposableCookies = await primaryContext.cookies();
    const disposableContext = await browser.newContext();
    await disposableContext.addCookies(disposableCookies);

    await runDryRunCapture({
      context: disposableContext,
      pageUrl: `${origin()}/app/settings`,
      actionSelector: ".save-settings-btn",
      scopeValidator: SCOPE,
    });
    await disposableContext.close();

    // The primary page was never reloaded/touched — its purely
    // client-side, in-memory counter value survives untouched.
    const primaryQuantityAfter = await primaryPage.$eval(".quantity-value >> nth=0", (el) => el.textContent);
    expect(primaryQuantityAfter).toBe(primaryQuantityBefore);

    await primaryContext.close();
  }, 30_000);
});
