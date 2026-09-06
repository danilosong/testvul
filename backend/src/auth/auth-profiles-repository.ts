import type { Db } from "../db/connection";
import type { AuthProfile, AuthProfileInput } from "./auth-profile";
import { decryptCredential, encryptCredential } from "./credential-crypto";

interface AuthProfileRow {
  id: number;
  name: string;
  method: AuthProfile["method"];
  credential_ciphertext: Buffer | null;
  credential_iv: Buffer | null;
  credential_tag: Buffer | null;
  browser_auth_login_url: string | null;
  browser_auth_selectors_json: string | null;
}

function rowToProfile(row: AuthProfileRow): AuthProfile {
  const profile: AuthProfile = {
    id: row.id,
    name: row.name,
    method: row.method,
    hasCredential: row.credential_ciphertext !== null,
  };
  if (row.browser_auth_login_url !== null) profile.browserAuthLoginUrl = row.browser_auth_login_url;
  if (row.browser_auth_selectors_json !== null) profile.browserAuthSelectors = JSON.parse(row.browser_auth_selectors_json);
  return profile;
}

function encryptedFields(credential: string | undefined): { ciphertext: Buffer | null; iv: Buffer | null; tag: Buffer | null } {
  if (credential === undefined) return { ciphertext: null, iv: null, tag: null };
  const encrypted = encryptCredential(credential);
  return { ciphertext: encrypted.ciphertext, iv: encrypted.iv, tag: encrypted.tag };
}

export function createAuthProfile(db: Db, input: AuthProfileInput): number {
  const { ciphertext, iv, tag } = encryptedFields(input.credential);
  const result = db
    .prepare(
      `INSERT INTO auth_profiles
        (name, method, credential_ciphertext, credential_iv, credential_tag, browser_auth_login_url, browser_auth_selectors_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.method,
      ciphertext,
      iv,
      tag,
      input.browserAuthLoginUrl ?? null,
      input.browserAuthSelectors ? JSON.stringify(input.browserAuthSelectors) : null,
    );
  return Number(result.lastInsertRowid);
}

export function getAuthProfile(db: Db, id: number): AuthProfile | null {
  const row = db.prepare("SELECT * FROM auth_profiles WHERE id = ?").get(id) as unknown as AuthProfileRow | undefined;
  return row ? rowToProfile(row) : null;
}

export function listAuthProfiles(db: Db): AuthProfile[] {
  const rows = db.prepare("SELECT * FROM auth_profiles ORDER BY id").all() as unknown as AuthProfileRow[];
  return rows.map(rowToProfile);
}

/** Updates a profile's fields. Omitting `credential` leaves the existing
 * one untouched; it is never possible to "read back" the old value here. */
export function updateAuthProfile(db: Db, id: number, input: Partial<AuthProfileInput>): void {
  const existing = db.prepare("SELECT * FROM auth_profiles WHERE id = ?").get(id) as unknown as AuthProfileRow | undefined;
  if (!existing) throw new Error(`No auth profile with id ${id}`);

  const name = input.name ?? existing.name;
  const method = input.method ?? existing.method;
  const browserAuthLoginUrl = input.browserAuthLoginUrl !== undefined ? input.browserAuthLoginUrl : existing.browser_auth_login_url;
  const browserAuthSelectorsJson =
    input.browserAuthSelectors !== undefined ? JSON.stringify(input.browserAuthSelectors) : existing.browser_auth_selectors_json;

  let ciphertext = existing.credential_ciphertext;
  let iv = existing.credential_iv;
  let tag = existing.credential_tag;
  if (input.credential !== undefined) {
    const encrypted = encryptedFields(input.credential);
    ciphertext = encrypted.ciphertext;
    iv = encrypted.iv;
    tag = encrypted.tag;
  }

  db.prepare(
    `UPDATE auth_profiles
     SET name = ?, method = ?, credential_ciphertext = ?, credential_iv = ?, credential_tag = ?,
         browser_auth_login_url = ?, browser_auth_selectors_json = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(name, method, ciphertext, iv, tag, browserAuthLoginUrl, browserAuthSelectorsJson, id);
}

export function deleteAuthProfile(db: Db, id: number): void {
  db.prepare("DELETE FROM auth_profiles WHERE id = ?").run(id);
}

/** Decrypts and returns the stored credential — for internal use by the
 * request pipeline only, never exposed through the profile-management API. */
export function getDecryptedCredential(db: Db, id: number): string | undefined {
  const row = db.prepare("SELECT * FROM auth_profiles WHERE id = ?").get(id) as unknown as AuthProfileRow | undefined;
  if (!row || row.credential_ciphertext === null || row.credential_iv === null || row.credential_tag === null) {
    return undefined;
  }
  return decryptCredential({ ciphertext: row.credential_ciphertext, iv: row.credential_iv, tag: row.credential_tag });
}
