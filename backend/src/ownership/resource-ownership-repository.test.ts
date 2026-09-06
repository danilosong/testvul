import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { declareResourceOwnership, listResourceOwnership, getResourceOwner } from "./resource-ownership-repository";
import type { ResourceKey } from "../mutation/resource-key";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshTarget(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-ownership-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t2', 'other.com', '[]')").run();
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User A', 'BEARER')").run();
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User B', 'BEARER')").run();
  return db;
}

const PROJECT_123: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "123" };

describe("declareResourceOwnership / listResourceOwnership / getResourceOwner", () => {
  it("declares an ownership mapping and makes it immediately queryable", () => {
    const db = freshTarget();
    declareResourceOwnership(db, { resourceKey: PROJECT_123, ownerAuthProfileId: 1 });
    expect(getResourceOwner(db, PROJECT_123)).toBe(1);
  });

  it("replaces the owner when the same resource is declared again", () => {
    const db = freshTarget();
    declareResourceOwnership(db, { resourceKey: PROJECT_123, ownerAuthProfileId: 1 });
    declareResourceOwnership(db, { resourceKey: PROJECT_123, ownerAuthProfileId: 2 });

    expect(getResourceOwner(db, PROJECT_123)).toBe(2);
    expect(listResourceOwnership(db, 1)).toHaveLength(1); // updated in place, not duplicated
  });

  it("returns null for a resource with no declared owner", () => {
    const db = freshTarget();
    expect(getResourceOwner(db, { ...PROJECT_123, resourceId: "999" })).toBeNull();
  });

  it("distinguishes resources by tenant even when everything else matches", () => {
    const db = freshTarget();
    const tenant1: ResourceKey = { ...PROJECT_123, resourceId: "1", tenantId: "t1" };
    const tenant2: ResourceKey = { ...PROJECT_123, resourceId: "1", tenantId: "t2" };
    declareResourceOwnership(db, { resourceKey: tenant1, ownerAuthProfileId: 1 });
    declareResourceOwnership(db, { resourceKey: tenant2, ownerAuthProfileId: 2 });

    expect(getResourceOwner(db, tenant1)).toBe(1);
    expect(getResourceOwner(db, tenant2)).toBe(2);
  });

  it("does not collide across different targetIds sharing the same resourceId, per the Canonical ResourceKey spec scenario", () => {
    const db = freshTarget();
    const targetAResource: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "123" };
    const targetBResource: ResourceKey = { targetId: 2, origin: "https://other.com", objectType: "project", resourceId: "123" };
    declareResourceOwnership(db, { resourceKey: targetAResource, ownerAuthProfileId: 1 });
    declareResourceOwnership(db, { resourceKey: targetBResource, ownerAuthProfileId: 2 });

    expect(getResourceOwner(db, targetAResource)).toBe(1);
    expect(getResourceOwner(db, targetBResource)).toBe(2);
    expect(listResourceOwnership(db, 1)).toHaveLength(1);
    expect(listResourceOwnership(db, 2)).toHaveLength(1);
  });
});
