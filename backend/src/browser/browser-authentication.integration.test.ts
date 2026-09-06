import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { establishBrowserSession, type LoginSelectors } from "./browser-authentication";
import { readBrowserSession } from "./session-manager";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");
const TEST_KEY = Buffer.alloc(32, 7).toString("base64");
let originalKeyEnv: string | undefined;

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };
let browser: Browser;

beforeAll(async () => {
  originalKeyEnv = process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
  servers = createServers();
  ports = await servers.start();
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser.close();
  await servers.stop();
  if (originalKeyEnv === undefined) delete process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY = originalKeyEnv;
});

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-browser-auth-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User A', 'BEARER')").run(); // id 1
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User B', 'BEARER')").run(); // id 2
  return db;
}

function origin(): string {
  return `http://127.0.0.1:${ports.httpPort}`;
}

const SELECTORS: LoginSelectors = {
  username: 'input[name="username"]',
  password: 'input[name="password"]',
  submit: 'button[type="submit"]',
};

async function whoAmI(context: import("playwright").BrowserContext): Promise<string> {
  const page = await context.newPage();
  await page.goto(`${origin()}/app/projects`); // any authenticated same-origin page
  const id = await page.evaluate(async () => {
    const res = await fetch("/api/me", { credentials: "include" });
    const data = await res.json();
    return data.id;
  });
  await page.close();
  return id;
}

describe("Browser Authentication against the real fixture app's login page (Section 12.13)", () => {
  it("establishes and confirms independent sessions for User A and User B", async () => {
    const db = freshDb();

    const contextA = await browser.newContext();
    const resultA = await establishBrowserSession({
      db,
      context: contextA,
      authProfileId: 1,
      loginUrl: `${origin()}/login`,
      selectors: SELECTORS,
      username: "userA",
      password: "userA-pass",
      successUrlPattern: "**/app/projects",
    });
    expect(resultA.reused).toBe(false);
    expect(await whoAmI(contextA)).toBe("userA");
    await contextA.close();

    const contextB = await browser.newContext();
    const resultB = await establishBrowserSession({
      db,
      context: contextB,
      authProfileId: 2,
      loginUrl: `${origin()}/login`,
      selectors: SELECTORS,
      username: "userB",
      password: "userB-pass",
      successUrlPattern: "**/app/projects",
    });
    expect(resultB.reused).toBe(false);
    expect(await whoAmI(contextB)).toBe("userB");
    await contextB.close();

    // Each profile's own encrypted session was stored independently.
    expect(readBrowserSession(db, 1)?.sessionData).toBeTruthy();
    expect(readBrowserSession(db, 2)?.sessionData).toBeTruthy();
    expect(readBrowserSession(db, 1)?.sessionData).not.toBe(readBrowserSession(db, 2)?.sessionData);
  }, 30_000);

  it("reuses an existing session rather than re-running the login flow", async () => {
    const db = freshDb();
    const context1 = await browser.newContext();
    await establishBrowserSession({
      db,
      context: context1,
      authProfileId: 1,
      loginUrl: `${origin()}/login`,
      selectors: SELECTORS,
      username: "userA",
      password: "userA-pass",
      successUrlPattern: "**/app/projects",
    });
    await context1.close();

    const context2 = await browser.newContext();
    const result = await establishBrowserSession({
      db,
      context: context2,
      authProfileId: 1,
      loginUrl: `${origin()}/login`,
      selectors: SELECTORS,
      username: "userA",
      password: "userA-pass",
      successUrlPattern: "**/app/projects",
    });
    expect(result.reused).toBe(true);
    expect(await whoAmI(context2)).toBe("userA");
    await context2.close();
  }, 30_000);
});
