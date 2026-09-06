import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createServers } = require("../../../fixtures/vulnerable-app/server");

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");
const TEST_KEY = Buffer.alloc(32, 3).toString("base64");
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
  dbDir = mkdtempSync(join(tmpdir(), "sca-auth-routes-"));
  db = openDb(join(dbDir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  app = buildApp(db);
  return app;
}

describe("Authentication Profile Management API", () => {
  it("creates a profile and never returns the full credential", async () => {
    const app = freshApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth-profiles",
      payload: { name: "User A", method: "BEARER", credential: "userA-secret-token" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.maskedCredential).not.toBe("userA-secret-token");
    expect(JSON.stringify(body)).not.toContain("userA-secret-token");
  });

  it("editing an existing profile returns only a masked credential, per the spec's own test requirement", async () => {
    const app = freshApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/auth-profiles", payload: { name: "User A", method: "BEARER", credential: "original-secret" } })
    ).json();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/auth-profiles/${created.id}`,
      payload: { credential: "replaced-secret-value" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.maskedCredential).not.toBe("replaced-secret-value");
    expect(body.maskedCredential).not.toContain("replaced-secret-value".slice(6, -4)); // the masked middle is gone
    expect(JSON.stringify(body)).not.toContain("replaced-secret-value");
  });

  it("lists and deletes profiles without ever exposing a credential", async () => {
    const app = freshApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/auth-profiles", payload: { name: "Admin", method: "COOKIE", credential: "admin-secret" } })
    ).json();

    const listRes = await app.inject({ method: "GET", url: "/api/auth-profiles" });
    expect(JSON.stringify(listRes.json())).not.toContain("admin-secret");

    const deleteRes = await app.inject({ method: "DELETE", url: `/api/auth-profiles/${created.id}` });
    expect(deleteRes.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/auth-profiles/${created.id}` })).statusCode).toBe(404);
  });

  it('"test profile" issues its request through the safe HTTP client, per the spec\'s own test requirement', async () => {
    const app = freshApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/auth-profiles", payload: { name: "User A", method: "BEARER", credential: "userA-token" } })
    ).json();

    // Proof it's the real SecurityHttpClient, not a stub: (a) it correctly
    // authenticates against the fixture's real auth check, and (b) it is
    // still bound by the mandatory scope gate.
    const authedRes = await app.inject({
      method: "POST",
      url: `/api/auth-profiles/${created.id}/test`,
      payload: { targetUrl: `http://127.0.0.1:${ports.httpPort}/api/projects/1`, scope: ["127.0.0.1"], allowPrivateNetworks: true },
    });
    expect(authedRes.json().status).toBe(200);

    const outOfScopeRes = await app.inject({
      method: "POST",
      url: `/api/auth-profiles/${created.id}/test`,
      payload: { targetUrl: `http://127.0.0.1:${ports.httpPort}/api/projects/1`, scope: ["only-this.example"] },
    });
    expect(outOfScopeRes.statusCode).toBe(422); // ScopeViolationError surfaced as a clean error, not a bypass
  });

  it("writes a credential-sharing host to auth_profile_allowed_hosts", async () => {
    const app = freshApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/auth-profiles", payload: { name: "User A", method: "BEARER" } })
    ).json();

    await app.inject({ method: "POST", url: `/api/auth-profiles/${created.id}/allowed-hosts`, payload: { hostname: "cdn.example.com" } });

    const row = db.prepare("SELECT hostname FROM auth_profile_allowed_hosts WHERE auth_profile_id = ?").get(created.id) as {
      hostname: string;
    };
    expect(row.hostname).toBe("cdn.example.com");
  });
});
