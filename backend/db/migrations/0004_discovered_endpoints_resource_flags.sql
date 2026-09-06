-- Section 15.3 (Dashboard aggregation): discovered_endpoints needs to
-- preserve the same isPage/isForm distinction DiscoveredResource already
-- carries in memory, so persisted counts (pages vs. plain endpoints vs.
-- forms) match what buildAttackSurface computes from live discovery data.
ALTER TABLE discovered_endpoints ADD COLUMN is_page INTEGER NOT NULL DEFAULT 0 CHECK (is_page IN (0, 1));
ALTER TABLE discovered_endpoints ADD COLUMN is_form INTEGER NOT NULL DEFAULT 0 CHECK (is_form IN (0, 1));
