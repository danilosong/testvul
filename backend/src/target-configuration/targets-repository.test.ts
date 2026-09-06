import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { createTarget, getTarget, listTargets } from "./targets-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-targets-repo-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe("targets-repository (Section 16.1)", () => {
  it("applies the schema's own defaults (Passive, 2 req/s, DEVELOPMENT) when not overridden", () => {
    const db = freshDb();
    const id = createTarget(db, { name: "My Project", hostname: "example.com", scope: ["example.com"] });
    const target = getTarget(db, id);
    expect(target).toEqual({
      id,
      name: "My Project",
      hostname: "example.com",
      scope: ["example.com"],
      defaultScanMode: "PASSIVE",
      rateLimitRps: 2,
      allowPrivateNetworks: false,
      environment: "DEVELOPMENT",
    });
  });

  it("honors explicit overrides", () => {
    const db = freshDb();
    const id = createTarget(db, {
      name: "My Project",
      hostname: "127.0.0.1",
      scope: ["127.0.0.1"],
      defaultScanMode: "SAFE_AUTOMATIC",
      rateLimitRps: 5,
      allowPrivateNetworks: true,
      environment: "LOCAL_FIXTURE",
    });
    const target = getTarget(db, id);
    expect(target?.defaultScanMode).toBe("SAFE_AUTOMATIC");
    expect(target?.rateLimitRps).toBe(5);
    expect(target?.allowPrivateNetworks).toBe(true);
    expect(target?.environment).toBe("LOCAL_FIXTURE");
  });

  it("lists every created target", () => {
    const db = freshDb();
    createTarget(db, { name: "A", hostname: "a.example.com", scope: ["a.example.com"] });
    createTarget(db, { name: "B", hostname: "b.example.com", scope: ["b.example.com"] });
    expect(listTargets(db).map((t) => t.name)).toEqual(["A", "B"]);
  });

  it("returns null for a nonexistent target", () => {
    const db = freshDb();
    expect(getTarget(db, 999)).toBeNull();
  });
});
