import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { classifyMutationScope } from "../mutation/mutation-scope";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");
let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshApp() {
  dir = mkdtempSync(join(tmpdir(), "sca-mutation-scope-routes-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('Audit', 'example.com', '[\"example.com\"]')").run();
  return buildApp(db);
}

describe("Section 16.9 — Test Resource Scope configuration API", () => {
  it("declares and lists a TEST_RESOURCE while leaving reads unrestricted", async () => {
    const app = freshApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/targets/1/mutation-scope",
      payload: { origin: "https://example.com", objectType: "project", resourceId: "991", description: "QA project" },
    });
    expect(created.statusCode).toBe(201);

    const listed = await app.inject({ method: "GET", url: "/api/targets/1/mutation-scope" });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([
      expect.objectContaining({ targetId: 1, objectType: "project", resourceId: "991", description: "QA project" }),
    ]);
    expect(classifyMutationScope(db, { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "991" })).toBe(
      "TEST_RESOURCE",
    );
  });

  it("defaults an undeclared resource to UNKNOWN_RESOURCE without blocking target reads", async () => {
    const app = freshApp();
    expect(classifyMutationScope(db, { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "404" })).toBe(
      "UNKNOWN_RESOURCE",
    );
    const targetResponse = await app.inject({ method: "GET", url: "/api/targets/1" });
    expect(targetResponse.statusCode).toBe(200);
  });
});
