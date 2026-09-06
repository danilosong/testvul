import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { setAuthorizationExpectation, getAuthorizationExpectation, listAuthorizationExpectations } from "./authorization-expectations-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshProfile(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-authz-expect-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User A', 'BEARER')").run();
  return db;
}

describe("authorization expectations", () => {
  it("returns NO_EXPECTATION_CONFIGURED for an unconfigured profile/action pair, distinct from ALLOWED or DENIED, per the spec scenario", () => {
    const db = freshProfile();
    expect(getAuthorizationExpectation(db, 1, "CAMPAIGN_EDIT")).toBe("NO_EXPECTATION_CONFIGURED");
  });

  it("returns the configured expectation once one is set", () => {
    const db = freshProfile();
    setAuthorizationExpectation(db, { authProfileId: 1, action: "CAMPAIGN_EDIT", expected: "DENIED" });
    expect(getAuthorizationExpectation(db, 1, "CAMPAIGN_EDIT")).toBe("DENIED");
  });

  it("replaces an existing expectation rather than duplicating it", () => {
    const db = freshProfile();
    setAuthorizationExpectation(db, { authProfileId: 1, action: "CAMPAIGN_EDIT", expected: "DENIED" });
    setAuthorizationExpectation(db, { authProfileId: 1, action: "CAMPAIGN_EDIT", expected: "ALLOWED" });
    expect(getAuthorizationExpectation(db, 1, "CAMPAIGN_EDIT")).toBe("ALLOWED");
    expect(listAuthorizationExpectations(db, 1)).toHaveLength(1);
  });

  it("keeps NO_EXPECTATION_CONFIGURED distinct from the string values ALLOWED/DENIED at the type level", () => {
    const db = freshProfile();
    const result = getAuthorizationExpectation(db, 1, "SOME_ACTION");
    expect(result).not.toBe("ALLOWED");
    expect(result).not.toBe("DENIED");
    expect(result).toBe("NO_EXPECTATION_CONFIGURED");
  });
});
