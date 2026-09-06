import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { isTargetBusinessProfileEnabled, listTargetBusinessProfiles, setTargetBusinessProfileEnabled } from "./target-business-profiles-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshTarget(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-target-business-profiles-repo-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO targets (name, hostname, scope_json) VALUES ('t', 'example.com', '[]')").run();
  return db;
}

describe("target-business-profiles-repository (Section 13.22)", () => {
  it("a profile is disabled by default until explicitly enabled", () => {
    const db = freshTarget();
    expect(isTargetBusinessProfileEnabled(db, 1, "contest")).toBe(false);
  });

  it("enables a profile and reflects it in both the single-profile check and the listing", () => {
    const db = freshTarget();
    setTargetBusinessProfileEnabled(db, 1, "contest", true);
    expect(isTargetBusinessProfileEnabled(db, 1, "contest")).toBe(true);
    expect(listTargetBusinessProfiles(db, 1)).toEqual([{ profileName: "contest", enabled: true }]);
  });

  it("re-enabling/disabling the same profile updates the existing row rather than duplicating it", () => {
    const db = freshTarget();
    setTargetBusinessProfileEnabled(db, 1, "contest", true);
    setTargetBusinessProfileEnabled(db, 1, "contest", false);
    expect(listTargetBusinessProfiles(db, 1)).toEqual([{ profileName: "contest", enabled: false }]);
  });
});
