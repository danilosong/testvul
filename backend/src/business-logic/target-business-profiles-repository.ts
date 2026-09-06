import type { Db } from "../db/connection";

export interface TargetBusinessProfileState {
  profileName: string;
  enabled: boolean;
}

/** Sets whether `profileName` (e.g. "contest") is enabled as a default for `targetId`'s next scan — never true by default for any non-Generic profile (design.md Decision 36). */
export function setTargetBusinessProfileEnabled(db: Db, targetId: number, profileName: string, enabled: boolean): void {
  db.prepare(
    `INSERT INTO target_business_profiles (target_id, profile_name, enabled, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (target_id, profile_name) DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`,
  ).run(targetId, profileName, enabled ? 1 : 0);
}

export function listTargetBusinessProfiles(db: Db, targetId: number): TargetBusinessProfileState[] {
  const rows = db.prepare("SELECT profile_name, enabled FROM target_business_profiles WHERE target_id = ? ORDER BY profile_name").all(targetId) as unknown as {
    profile_name: string;
    enabled: number;
  }[];
  return rows.map((row) => ({ profileName: row.profile_name, enabled: row.enabled === 1 }));
}

export function isTargetBusinessProfileEnabled(db: Db, targetId: number, profileName: string): boolean {
  const row = db.prepare("SELECT enabled FROM target_business_profiles WHERE target_id = ? AND profile_name = ?").get(targetId, profileName) as
    | { enabled: number }
    | undefined;
  return row?.enabled === 1;
}
