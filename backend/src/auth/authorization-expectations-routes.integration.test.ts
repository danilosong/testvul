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
  dbDir = mkdtempSync(join(tmpdir(), "sca-authz-routes-"));
  db = openDb(join(dbDir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User A', 'BEARER')").run();
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('Admin', 'BEARER')").run();
  app = buildApp(db);
  return app;
}

describe("Expected Permission Policy API", () => {
  it("querying an unconfigured profile/action pair returns NO_EXPECTATION_CONFIGURED, distinct from ALLOWED or DENIED", async () => {
    const app = freshApp();
    const res = await app.inject({ method: "GET", url: "/api/authorization-expectations?authProfileId=1&action=CAMPAIGN_EDIT" });
    expect(res.json()).toEqual({ expected: "NO_EXPECTATION_CONFIGURED" });
  });

  it("creates and retrieves a User A/CAMPAIGN_EDIT/DENIED and an Admin/CAMPAIGN_EDIT/ALLOWED entry independently", async () => {
    const app = freshApp();
    await app.inject({ method: "POST", url: "/api/authorization-expectations", payload: { authProfileId: 1, action: "CAMPAIGN_EDIT", expected: "DENIED" } });
    await app.inject({ method: "POST", url: "/api/authorization-expectations", payload: { authProfileId: 2, action: "CAMPAIGN_EDIT", expected: "ALLOWED" } });

    const userARes = await app.inject({ method: "GET", url: "/api/authorization-expectations?authProfileId=1&action=CAMPAIGN_EDIT" });
    const adminRes = await app.inject({ method: "GET", url: "/api/authorization-expectations?authProfileId=2&action=CAMPAIGN_EDIT" });

    expect(userARes.json()).toEqual({ expected: "DENIED" });
    expect(adminRes.json()).toEqual({ expected: "ALLOWED" });
  });
});
