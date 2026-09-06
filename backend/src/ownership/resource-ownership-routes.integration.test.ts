import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dbDir: string;
let db: Db;
let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
  db?.close();
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
});

function freshApp(): FastifyInstance {
  dbDir = mkdtempSync(join(tmpdir(), "sca-ownership-routes-"));
  db = openDb(join(dbDir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User A', 'BEARER')").run();
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User B', 'BEARER')").run();
  app = buildApp(db);
  return app;
}

describe("Resource Ownership Management API", () => {
  it('declaring "User A owns Project 123" and "User B owns Project 456" makes both mappings available with no further steps, per the spec scenario', async () => {
    const app = freshApp();

    await app.inject({
      method: "POST",
      url: "/api/resource-ownership",
      payload: {
        resourceKey: { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "123" },
        ownerAuthProfileId: 1,
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/resource-ownership",
      payload: {
        resourceKey: { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "456" },
        ownerAuthProfileId: 2,
      },
    });

    const listRes = await app.inject({ method: "GET", url: "/api/resource-ownership?targetId=1" });
    const mappings = listRes.json();

    expect(mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceKey: expect.objectContaining({ resourceId: "123" }), ownerAuthProfileId: 1 }),
        expect.objectContaining({ resourceKey: expect.objectContaining({ resourceId: "456" }), ownerAuthProfileId: 2 }),
      ]),
    );
  });

  it("rejects a request missing required fields", async () => {
    const app = freshApp();
    const res = await app.inject({ method: "POST", url: "/api/resource-ownership", payload: { resourceKey: { targetId: 1 } } });
    expect(res.statusCode).toBe(400);
  });
});
