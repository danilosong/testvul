import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import {
  createAuthProfile,
  getAuthProfile,
  listAuthProfiles,
  updateAuthProfile,
  deleteAuthProfile,
  getDecryptedCredential,
} from "./auth-profiles-repository";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");
const TEST_KEY = Buffer.alloc(32, 7).toString("base64");
let originalKeyEnv: string | undefined;

beforeAll(() => {
  originalKeyEnv = process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
});

afterAll(() => {
  if (originalKeyEnv === undefined) delete process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY = originalKeyEnv;
});

let dir: string;
let db: Db;

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): Db {
  dir = mkdtempSync(join(tmpdir(), "sca-auth-profiles-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe("auth profile CRUD", () => {
  it("creates a profile and reads it back without ever exposing the credential", () => {
    const db = freshDb();
    const id = createAuthProfile(db, { name: "User A", method: "BEARER", credential: "secret-token" });

    const profile = getAuthProfile(db, id);
    expect(profile).toEqual({ id, name: "User A", method: "BEARER", hasCredential: true });
    expect(getDecryptedCredential(db, id)).toBe("secret-token");
  });

  it("creates a profile with no credential at all", () => {
    const db = freshDb();
    const id = createAuthProfile(db, { name: "Anonymous", method: "BEARER" });
    expect(getAuthProfile(db, id)).toEqual({ id, name: "Anonymous", method: "BEARER", hasCredential: false });
    expect(getDecryptedCredential(db, id)).toBeUndefined();
  });

  it("stores a Browser Authentication Flow configuration", () => {
    const db = freshDb();
    const id = createAuthProfile(db, {
      name: "User B",
      method: "COOKIE",
      browserAuthLoginUrl: "http://127.0.0.1:4100/login",
      browserAuthSelectors: { username: "#username", password: "#password" },
    });
    const profile = getAuthProfile(db, id);
    expect(profile?.browserAuthLoginUrl).toBe("http://127.0.0.1:4100/login");
    expect(profile?.browserAuthSelectors).toEqual({ username: "#username", password: "#password" });
  });

  it("lists every created profile", () => {
    const db = freshDb();
    createAuthProfile(db, { name: "Anonymous", method: "BEARER" });
    createAuthProfile(db, { name: "Admin", method: "COOKIE", credential: "admin-token" });
    expect(listAuthProfiles(db).map((p) => p.name)).toEqual(["Anonymous", "Admin"]);
  });

  it("updates a profile's name and method without touching its credential", () => {
    const db = freshDb();
    const id = createAuthProfile(db, { name: "User A", method: "BEARER", credential: "secret-token" });
    updateAuthProfile(db, id, { name: "User A (renamed)" });
    expect(getAuthProfile(db, id)?.name).toBe("User A (renamed)");
    expect(getDecryptedCredential(db, id)).toBe("secret-token");
  });

  it("updates a profile's credential, replacing the old one", () => {
    const db = freshDb();
    const id = createAuthProfile(db, { name: "User A", method: "BEARER", credential: "old-token" });
    updateAuthProfile(db, id, { credential: "new-token" });
    expect(getDecryptedCredential(db, id)).toBe("new-token");
  });

  it("deletes a profile", () => {
    const db = freshDb();
    const id = createAuthProfile(db, { name: "User A", method: "BEARER" });
    deleteAuthProfile(db, id);
    expect(getAuthProfile(db, id)).toBeNull();
  });
});
