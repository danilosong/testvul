import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db/connection";
import { runMigrations } from "../../db/migrator";
import { findRouteDifferences, evaluateRouteDifferences } from "./role-route-comparison";
import { setAuthorizationExpectation } from "../../auth/authorization-expectations-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "db", "migrations");
const ADMIN_PROFILE_ID = 1;
const USER_A_PROFILE_ID = 2;

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-role-route-comparison-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('Admin', 'BEARER')").run();
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User A', 'BEARER')").run();
  return db;
}

const ADMIN_ROUTES = ["/app/projects", "/app/settings", "/app/admin"];
const USER_A_ROUTES = ["/app/projects", "/app/settings"];

describe("findRouteDifferences", () => {
  it("surfaces a route reachable by Admin but not User A", () => {
    const profileRoutes = new Map([
      [ADMIN_PROFILE_ID, ADMIN_ROUTES],
      [USER_A_PROFILE_ID, USER_A_ROUTES],
    ]);

    const differences = findRouteDifferences(profileRoutes);

    expect(differences).toHaveLength(1);
    expect(differences[0]).toEqual({ route: "/app/admin", reachableByProfileIds: [ADMIN_PROFILE_ID] });
  });

  it("does not surface a route every compared profile can reach", () => {
    const profileRoutes = new Map([
      [ADMIN_PROFILE_ID, ADMIN_ROUTES],
      [USER_A_PROFILE_ID, USER_A_ROUTES],
    ]);
    const differences = findRouteDifferences(profileRoutes);
    expect(differences.find((d) => d.route === "/app/projects")).toBeUndefined();
  });
});

describe("evaluateRouteDifferences", () => {
  it("comparing Admin's and User A's discovered routes surfaces the difference without auto-flagging it absent a configured expectation", () => {
    const db = freshDb();
    const differences = findRouteDifferences(
      new Map([
        [ADMIN_PROFILE_ID, ADMIN_ROUTES],
        [USER_A_PROFILE_ID, USER_A_ROUTES],
      ]),
    );
    // No authorization_expectations row configured for /app/admin at all.

    const evaluated = evaluateRouteDifferences(db, differences);

    expect(evaluated).toHaveLength(1);
    expect(evaluated[0]!.route).toBe("/app/admin");
    expect(evaluated[0]!.verdict).toBe("SURFACED");
  });

  it("classifies AUTHORIZATION_POLICY_VIOLATION only once a DENIED expectation is actually configured for the reaching profile", () => {
    const db = freshDb();
    setAuthorizationExpectation(db, { authProfileId: ADMIN_PROFILE_ID, action: "/app/admin", expected: "DENIED" });

    const differences = findRouteDifferences(
      new Map([
        [ADMIN_PROFILE_ID, ADMIN_ROUTES],
        [USER_A_PROFILE_ID, USER_A_ROUTES],
      ]),
    );
    const evaluated = evaluateRouteDifferences(db, differences);

    expect(evaluated[0]!.verdict).toBe("AUTHORIZATION_POLICY_VIOLATION");
  });
});
