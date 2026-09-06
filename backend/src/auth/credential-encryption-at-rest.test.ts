import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection";
import { runMigrations } from "../db/migrator";
import { createAuthProfile, getDecryptedCredential } from "./auth-profiles-repository";
import { MissingEncryptionKeyError } from "./credential-crypto";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");
const TEST_KEY = Buffer.alloc(32, 5).toString("base64");
let originalKeyEnv: string | undefined;

beforeAll(() => {
  originalKeyEnv = process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY;
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
  dir = mkdtempSync(join(tmpdir(), "sca-credential-at-rest-"));
  db = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe("credential encryption at rest (Section 8.4)", () => {
  it("never stores the plaintext credential in the raw database row", () => {
    process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    const db = freshDb();
    const plaintext = "userA-super-secret-token";
    const id = createAuthProfile(db, { name: "User A", method: "BEARER", credential: plaintext });

    const row = db.prepare("SELECT credential_ciphertext, credential_iv, credential_tag FROM auth_profiles WHERE id = ?").get(id) as {
      credential_ciphertext: Uint8Array;
      credential_iv: Uint8Array;
      credential_tag: Uint8Array;
    };
    const ciphertext = Buffer.from(row.credential_ciphertext);

    expect(row.credential_ciphertext).toBeInstanceOf(Uint8Array);
    expect(ciphertext.toString("utf8")).not.toContain(plaintext);
    expect(ciphertext.includes(Buffer.from(plaintext, "utf8"))).toBe(false);
    // The key is never stored alongside the ciphertext — only ciphertext/iv/tag live in this row.
    expect(row.credential_iv).toBeInstanceOf(Uint8Array);
    expect(row.credential_tag).toBeInstanceOf(Uint8Array);
  });

  it("fails closed when no encryption key is configured for the process", () => {
    delete process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY;
    const db = freshDb();
    expect(() => createAuthProfile(db, { name: "User A", method: "BEARER", credential: "secret" })).toThrow(
      MissingEncryptionKeyError,
    );
  });

  it("fails to decrypt when the stored ciphertext has been tampered with", () => {
    process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    const db = freshDb();
    const id = createAuthProfile(db, { name: "User A", method: "BEARER", credential: "secret-token" });

    // Simulate tampering with the raw stored bytes (e.g. a compromised DB file).
    const row = db.prepare("SELECT credential_ciphertext FROM auth_profiles WHERE id = ?").get(id) as {
      credential_ciphertext: Buffer;
    };
    const tampered = Buffer.from(row.credential_ciphertext);
    tampered[0] = tampered[0]! ^ 0xff;
    db.prepare("UPDATE auth_profiles SET credential_ciphertext = ? WHERE id = ?").run(tampered, id);

    expect(() => getDecryptedCredential(db, id)).toThrow();
  });

  it("fails to decrypt when the stored authentication tag has been tampered with", () => {
    process.env.AUTH_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    const db = freshDb();
    const id = createAuthProfile(db, { name: "User A", method: "BEARER", credential: "secret-token" });

    const row = db.prepare("SELECT credential_tag FROM auth_profiles WHERE id = ?").get(id) as { credential_tag: Buffer };
    const tampered = Buffer.from(row.credential_tag);
    tampered[0] = tampered[0]! ^ 0xff;
    db.prepare("UPDATE auth_profiles SET credential_tag = ? WHERE id = ?").run(tampered, id);

    expect(() => getDecryptedCredential(db, id)).toThrow();
  });
});
