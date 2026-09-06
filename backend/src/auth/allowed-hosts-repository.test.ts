import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { getAllowedHosts } from "./allowed-hosts-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-allowed-hosts-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe("getAllowedHosts", () => {
  it("returns an empty list for a profile with no declared sharing hosts", () => {
    const db = freshDb();
    db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('Profile A', 'BEARER')").run();
    expect(getAllowedHosts(db, 1)).toEqual([]);
  });

  it("returns the hostnames declared for a profile, lowercased", () => {
    const db = freshDb();
    db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('Profile A', 'BEARER')").run();
    db.prepare("INSERT INTO auth_profile_allowed_hosts (auth_profile_id, hostname) VALUES (1, 'CDN.example.com')").run();
    db.prepare("INSERT INTO auth_profile_allowed_hosts (auth_profile_id, hostname) VALUES (1, 'api.example.com')").run();
    expect(getAllowedHosts(db, 1).sort()).toEqual(["api.example.com", "cdn.example.com"]);
  });

  it("does not return another profile's allowed hosts", () => {
    const db = freshDb();
    db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('Profile A', 'BEARER')").run();
    db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('Profile B', 'BEARER')").run();
    db.prepare("INSERT INTO auth_profile_allowed_hosts (auth_profile_id, hostname) VALUES (1, 'a.example.com')").run();
    db.prepare("INSERT INTO auth_profile_allowed_hosts (auth_profile_id, hostname) VALUES (2, 'b.example.com')").run();
    expect(getAllowedHosts(db, 1)).toEqual(["a.example.com"]);
    expect(getAllowedHosts(db, 2)).toEqual(["b.example.com"]);
  });
});
