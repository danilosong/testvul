import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { classifyMutationScope, addMutationScopeEntry, assertMutationScopeAllowed, MutationScopeViolationError } from "./mutation-scope";
import type { ResourceKey } from "./resource-key";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshTarget(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-mutation-scope-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  return db;
}

const RESOURCE: ResourceKey = { targetId: 1, origin: "https://example.com", objectType: "project", resourceId: "991" };

describe("classifyMutationScope", () => {
  it("classifies UNKNOWN_RESOURCE when the target has no Mutation Scope configured at all", () => {
    const db = freshTarget();
    expect(classifyMutationScope(db, RESOURCE)).toBe("UNKNOWN_RESOURCE");
  });

  it("classifies TEST_RESOURCE when a scope entry matches exactly", () => {
    const db = freshTarget();
    addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "991" });
    expect(classifyMutationScope(db, RESOURCE)).toBe("TEST_RESOURCE");
  });

  it("classifies NON_TEST_RESOURCE when the target has Mutation Scope configured but this resource isn't part of it", () => {
    const db = freshTarget();
    addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "456" });
    expect(classifyMutationScope(db, RESOURCE)).toBe("NON_TEST_RESOURCE");
  });

  it("treats a NULL column on a scope entry as a wildcard for that dimension (e.g. a whole test tenant)", () => {
    const db = freshTarget();
    addMutationScopeEntry(db, { targetId: 1, tenantId: "qa-security", description: "Test User: qa-security" });
    const tenantResource: ResourceKey = { ...RESOURCE, tenantId: "qa-security" };
    expect(classifyMutationScope(db, tenantResource)).toBe("TEST_RESOURCE");
    expect(classifyMutationScope(db, { ...RESOURCE, tenantId: "other-tenant" })).toBe("NON_TEST_RESOURCE");
  });
});

describe("assertMutationScopeAllowed", () => {
  it("throws MutationScopeViolationError for UNKNOWN_RESOURCE without an override", () => {
    const db = freshTarget();
    expect(() => assertMutationScopeAllowed(db, RESOURCE, false)).toThrow(MutationScopeViolationError);
  });

  it("does not throw for TEST_RESOURCE", () => {
    const db = freshTarget();
    addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "991" });
    expect(() => assertMutationScopeAllowed(db, RESOURCE, false)).not.toThrow();
  });

  it("requires the override to be explicitly true — a falsy/absent override still blocks a NON_TEST_RESOURCE", () => {
    const db = freshTarget();
    addMutationScopeEntry(db, { targetId: 1, objectType: "project", resourceId: "456" });
    expect(() => assertMutationScopeAllowed(db, RESOURCE, false)).toThrow(MutationScopeViolationError);
    expect(() => assertMutationScopeAllowed(db, RESOURCE, true)).not.toThrow();
  });
});
