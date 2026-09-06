import type { Db } from "../db/connection";
import type { AuthorizationExpectation, AuthorizationExpectationInput, PermissionQueryResult } from "./authorization-expectation";

export function setAuthorizationExpectation(db: Db, input: AuthorizationExpectationInput): number {
  db.prepare(
    `INSERT INTO authorization_expectations (auth_profile_id, action, expected)
     VALUES (?, ?, ?)
     ON CONFLICT (auth_profile_id, action) DO UPDATE SET expected = excluded.expected`,
  ).run(input.authProfileId, input.action, input.expected);
  const row = db
    .prepare("SELECT id FROM authorization_expectations WHERE auth_profile_id = ? AND action = ?")
    .get(input.authProfileId, input.action) as { id: number };
  return row.id;
}

/**
 * Distinguishes "no expectation configured" from an actual ALLOWED/DENIED
 * value — a scanner comparing observed behavior against expectation must
 * never conflate "nothing declared" with "declared as denied" (or allowed).
 */
export function getAuthorizationExpectation(db: Db, authProfileId: number, action: string): PermissionQueryResult {
  const row = db
    .prepare("SELECT expected FROM authorization_expectations WHERE auth_profile_id = ? AND action = ?")
    .get(authProfileId, action) as { expected: PermissionQueryResult } | undefined;
  return row ? row.expected : "NO_EXPECTATION_CONFIGURED";
}

export function listAuthorizationExpectations(db: Db, authProfileId: number): AuthorizationExpectation[] {
  const rows = db
    .prepare("SELECT id, auth_profile_id, action, expected FROM authorization_expectations WHERE auth_profile_id = ? ORDER BY id")
    .all(authProfileId) as unknown as { id: number; auth_profile_id: number; action: string; expected: AuthorizationExpectation["expected"] }[];
  return rows.map((row) => ({ id: row.id, authProfileId: row.auth_profile_id, action: row.action, expected: row.expected }));
}
