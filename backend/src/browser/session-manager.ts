import type { Db } from "../db/connection";
import { encryptCredential, decryptCredential } from "../auth/credential-crypto";
import { maskSecret } from "../evidence/mask-secrets";

export interface StoreBrowserSessionInput {
  authProfileId: number;
  /** The real cookie/token value — encrypted before it ever reaches the database, never persisted as-is. */
  sessionData: string;
  ttlMs: number;
}

interface BrowserSessionRow {
  id: number;
  auth_profile_id: number;
  session_ciphertext: Buffer;
  session_iv: Buffer;
  session_tag: Buffer;
  established_at: string;
  last_used_at: string;
  expires_at: string;
  revoked_at: string | null;
}

/**
 * Browser Session Security (design.md Decision 43): `browser_sessions`
 * cookies/tokens are encrypted with the exact same AES-256-GCM helper as
 * Section 8.4's Authentication Profile credentials — a unique IV per
 * encryption, a verified authentication tag on every read, no parallel
 * encryption implementation for a value that's exactly as sensitive as the
 * credential that produced it.
 */
export function storeBrowserSession(db: Db, input: StoreBrowserSessionInput): number {
  const encrypted = encryptCredential(input.sessionData);
  const expiresAt = new Date(Date.now() + input.ttlMs).toISOString();
  const result = db
    .prepare(
      `INSERT INTO browser_sessions (auth_profile_id, session_ciphertext, session_iv, session_tag, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.authProfileId, encrypted.ciphertext, encrypted.iv, encrypted.tag, expiresAt);
  return Number(result.lastInsertRowid);
}

export interface ReadBrowserSessionResult {
  sessionData: string;
}

/**
 * Returns the decrypted session data for an Authentication Profile's most
 * recent session — or `null` if none exists, or it is expired, or it has
 * been revoked. An expired or revoked session is treated exactly like no
 * session at all (never decrypted, never returned), triggering re-login
 * rather than reuse. Updates `last_used_at` on every successful read.
 */
export function readBrowserSession(db: Db, authProfileId: number): ReadBrowserSessionResult | null {
  const row = db
    .prepare(
      `SELECT id, auth_profile_id, session_ciphertext, session_iv, session_tag, established_at, last_used_at, expires_at, revoked_at
       FROM browser_sessions WHERE auth_profile_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(authProfileId) as unknown as BrowserSessionRow | undefined;
  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  db.prepare("UPDATE browser_sessions SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);

  const sessionData = decryptCredential({ ciphertext: row.session_ciphertext, iv: row.session_iv, tag: row.session_tag });
  return { sessionData };
}

/** Marks every non-revoked session for this profile revoked — a subsequent `readBrowserSession` treats it as absent regardless of its expiry. */
export function revokeBrowserSessions(db: Db, authProfileId: number): void {
  db.prepare("UPDATE browser_sessions SET revoked_at = ? WHERE auth_profile_id = ? AND revoked_at IS NULL").run(
    new Date().toISOString(),
    authProfileId,
  );
}

export interface BrowserSessionDisplay {
  authProfileId: number;
  expiresAt: string;
  revoked: boolean;
  /** A masked preview only — never the real session value. Safe for logs/screenshots/reports/UI. */
  sessionPreview: string;
}

/**
 * The only representation of a session ever meant to reach a log line,
 * screenshot caption, report, or UI display — the real value is masked
 * (Section 8.5's shared masking rule), never serialized in plaintext
 * anywhere outside the encrypted-at-rest storage and the in-memory value
 * used to actually authenticate a request.
 */
export function describeBrowserSessionForDisplay(db: Db, authProfileId: number): BrowserSessionDisplay | null {
  const row = db
    .prepare(
      `SELECT auth_profile_id, session_ciphertext, session_iv, session_tag, expires_at, revoked_at
       FROM browser_sessions WHERE auth_profile_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(authProfileId) as unknown as BrowserSessionRow | undefined;
  if (!row) return null;

  const sessionData = decryptCredential({ ciphertext: row.session_ciphertext, iv: row.session_iv, tag: row.session_tag });
  return {
    authProfileId: row.auth_profile_id,
    expiresAt: row.expires_at,
    revoked: row.revoked_at !== null,
    sessionPreview: maskSecret(sessionData),
  };
}
