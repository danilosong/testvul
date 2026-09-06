import type { Db } from "../db/connection";

/**
 * The `auth_profile_allowed_hosts` data from migration 0001: hosts an
 * operator has explicitly declared safe to receive a given Authentication
 * Profile's credentials even across an origin change (e.g., a same-app
 * API host and CDN host that are meant to share a session). Section 8's UI
 * populates this table; here it is only read.
 */
export function getAllowedHosts(db: Db, authProfileId: number): string[] {
  const rows = db
    .prepare("SELECT hostname FROM auth_profile_allowed_hosts WHERE auth_profile_id = ?")
    .all(authProfileId) as { hostname: string }[];
  return rows.map((row) => row.hostname.toLowerCase());
}
