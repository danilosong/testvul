import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { ScopeValidator } from "../scope";
import { SecurityHttpClient } from "../http/security-http-client";
import { getAllowedHosts } from "./allowed-hosts-repository";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");
const TEST_KEY = Buffer.alloc(32, 11).toString("base64");
let originalKeyEnv: string | undefined;

let servers: ReturnType<typeof createServers>;
let ports: { httpPort: number; httpsPort: number; crossOriginPort: number };

beforeAll(async () => {
  originalKeyEnv = process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
  servers = createServers();
  ports = await servers.start();
});

afterAll(async () => {
  await servers.stop();
  if (originalKeyEnv === undefined) delete process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY = originalKeyEnv;
});

let dbDir: string;
let db: Db;
let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
  db?.close();
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
});

function freshApp(): FastifyInstance {
  dbDir = mkdtempSync(join(tmpdir(), "sca-cred-sharing-"));
  db = openDb(join(dbDir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  app = buildApp(db);
  return app;
}

describe("per-host credential sharing opt-in (Section 8.6)", () => {
  it("is backed by the auth_profile_allowed_hosts relational table, not a JSON blob on the profile", () => {
    freshApp();
    const columns = (db.prepare("PRAGMA table_info(auth_profiles)").all() as { name: string }[]).map((r) => r.name);
    expect(columns).not.toContain("allowed_hosts_json");
    expect(columns).not.toContain("credential_sharing_json");

    const allowedHostsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_profile_allowed_hosts'")
      .get();
    expect(allowedHostsTable).toBeDefined();
  });

  it("does not share credentials with a host the operator never configured, by default", async () => {
    const app = freshApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/auth-profiles", payload: { name: "User A", method: "BEARER", credential: "secret-token" } })
    ).json();
    expect(getAllowedHosts(db, created.id)).toEqual([]);

    const client = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
    const response = await client.request(`http://127.0.0.1:${ports.httpPort}/redirect/cross-origin-auth`, {
      headers: { Authorization: "Bearer secret-token" },
      credentialSharingAllowedHosts: getAllowedHosts(db, created.id),
    });
    expect(JSON.parse(response.body).headers.authorization).toBeUndefined();
  });

  it("shares credentials with a host the operator explicitly added via the allowed-hosts API", async () => {
    const app = freshApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/auth-profiles", payload: { name: "User A", method: "BEARER", credential: "secret-token" } })
    ).json();

    await app.inject({ method: "POST", url: `/api/auth-profiles/${created.id}/allowed-hosts`, payload: { hostname: "127.0.0.1" } });
    expect(getAllowedHosts(db, created.id)).toEqual(["127.0.0.1"]);

    const client = new SecurityHttpClient({ scopeValidator: new ScopeValidator(["127.0.0.1"]), allowPrivateNetworks: true });
    const response = await client.request(`http://127.0.0.1:${ports.httpPort}/redirect/cross-origin-auth`, {
      headers: { Authorization: "Bearer secret-token" },
      credentialSharingAllowedHosts: getAllowedHosts(db, created.id),
    });
    expect(JSON.parse(response.body).headers.authorization).toBe("Bearer secret-token");
  });
});
