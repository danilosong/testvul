import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { storeBrowserSession, readBrowserSession, revokeBrowserSessions, describeBrowserSessionForDisplay } from "./session-manager";

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
  dir = mkdtempSync(join(tmpdir(), "sca-session-manager-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO auth_profiles (name, method) VALUES ('User A', 'BEARER')").run();
  return db;
}

const REAL_SESSION_VALUE = "real-session-cookie-value-abc123";

describe("storeBrowserSession / readBrowserSession", () => {
  it("session data is encrypted at rest — the raw row never contains the plaintext session value", () => {
    const db = freshDb();
    storeBrowserSession(db, { authProfileId: 1, sessionData: REAL_SESSION_VALUE, ttlMs: 60_000 });

    const row = db.prepare("SELECT session_ciphertext FROM browser_sessions WHERE auth_profile_id = 1").get() as {
      session_ciphertext: Uint8Array;
    };
    const rawBytes = Buffer.from(row.session_ciphertext).toString("latin1");
    expect(rawBytes).not.toContain(REAL_SESSION_VALUE);
  });

  it("reads back the exact session value once decrypted", () => {
    const db = freshDb();
    storeBrowserSession(db, { authProfileId: 1, sessionData: REAL_SESSION_VALUE, ttlMs: 60_000 });

    const result = readBrowserSession(db, 1);
    expect(result?.sessionData).toBe(REAL_SESSION_VALUE);
  });

  it("an expired session is treated as absent, not reused", () => {
    const db = freshDb();
    storeBrowserSession(db, { authProfileId: 1, sessionData: REAL_SESSION_VALUE, ttlMs: -1 }); // already expired

    expect(readBrowserSession(db, 1)).toBeNull();
  });

  it("a revoked session is treated as absent, not reused, even though it hasn't expired", () => {
    const db = freshDb();
    storeBrowserSession(db, { authProfileId: 1, sessionData: REAL_SESSION_VALUE, ttlMs: 60_000 });
    revokeBrowserSessions(db, 1);

    expect(readBrowserSession(db, 1)).toBeNull();
  });

  it("returns null when no session exists at all for the profile", () => {
    const db = freshDb();
    expect(readBrowserSession(db, 1)).toBeNull();
  });
});

describe("describeBrowserSessionForDisplay", () => {
  it("no log/screenshot/report reference to a session shows a plaintext value — the display representation is always masked", () => {
    const db = freshDb();
    storeBrowserSession(db, { authProfileId: 1, sessionData: REAL_SESSION_VALUE, ttlMs: 60_000 });

    const display = describeBrowserSessionForDisplay(db, 1);
    expect(display).not.toBeNull();
    expect(display!.sessionPreview).not.toBe(REAL_SESSION_VALUE);
    expect(display!.sessionPreview).not.toContain(REAL_SESSION_VALUE);
  });

  it("reports revoked: true for a revoked session even though the display path doesn't reject it outright (an operator can still see it happened)", () => {
    const db = freshDb();
    storeBrowserSession(db, { authProfileId: 1, sessionData: REAL_SESSION_VALUE, ttlMs: 60_000 });
    revokeBrowserSessions(db, 1);

    const display = describeBrowserSessionForDisplay(db, 1);
    expect(display?.revoked).toBe(true);
  });
});
