-- Section 14.7 (Safe Scan Cancellation): when cancellation was requested
-- for a scan run, and by whom — NULL means never requested. The
-- orchestrator checks this before starting each new test (design.md
-- Decision 17); it never touches an already-running mutation cycle.
ALTER TABLE scan_runs ADD COLUMN cancellation_requested_at TEXT;
ALTER TABLE scan_runs ADD COLUMN cancellation_requested_by TEXT;
