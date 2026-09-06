-- Section 13.22 (Business Logic Rules management UI/API): which optional
-- Business Logic Profiles (e.g. "contest") are enabled as a default for a
-- target's *next* scan. This is deliberately separate from
-- scan_run_configs.enabled_business_profiles_json (Decision 25/51), which
-- is the immutable, already-started-scan snapshot — this table is only
-- ever read at scan-start time to seed that snapshot, never by a running
-- or finished scan.
CREATE TABLE target_business_profiles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id    INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  profile_name TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (target_id, profile_name)
);

CREATE INDEX idx_target_business_profiles_target ON target_business_profiles(target_id);
