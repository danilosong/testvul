-- Security Configuration Auditor — initial schema (design.md Decision 5).
--
-- Every resource-identifying table carries the canonical ResourceKey columns
-- (target_id, origin, tenant_id, object_type, resource_id — design.md
-- Decision 49) rather than a bare resource id, so the same resource_id under
-- a different target or tenant is never conflated by a lock, journal,
-- ownership, or mutation-scope check.

-- ── target-configuration ────────────────────────────────────────────────

CREATE TABLE targets (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  name                    TEXT NOT NULL,
  hostname                TEXT NOT NULL,
  scope_json              TEXT NOT NULL, -- JSON array of allowed hosts/wildcards
  default_scan_mode       TEXT NOT NULL DEFAULT 'PASSIVE'
                            CHECK (default_scan_mode IN ('PASSIVE', 'SAFE_AUTOMATIC', 'ADVANCED')),
  rate_limit_rps          REAL NOT NULL DEFAULT 2,
  allow_private_networks  INTEGER NOT NULL DEFAULT 0 CHECK (allow_private_networks IN (0, 1)),
  environment             TEXT NOT NULL DEFAULT 'DEVELOPMENT'
                            CHECK (environment IN ('LOCAL_FIXTURE', 'DEVELOPMENT', 'STAGING', 'PRODUCTION')),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE mutation_scope_resources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id     INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  origin        TEXT,
  object_type   TEXT,
  resource_id   TEXT,
  tenant_id     TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_mutation_scope_resources_target ON mutation_scope_resources(target_id);

-- ── auth-profiles ───────────────────────────────────────────────────────

CREATE TABLE auth_profiles (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  name                        TEXT NOT NULL,
  method                      TEXT NOT NULL
                                CHECK (method IN ('BEARER', 'COOKIE', 'API_KEY', 'CUSTOM_HEADERS')),
  credential_ciphertext       BLOB,
  credential_iv               BLOB,
  credential_tag              BLOB,
  browser_auth_login_url      TEXT,
  browser_auth_selectors_json TEXT,
  created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE auth_profile_allowed_hosts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_profile_id INTEGER NOT NULL REFERENCES auth_profiles(id) ON DELETE CASCADE,
  hostname        TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (auth_profile_id, hostname)
);

-- ── business-logic-testing (operator-configured rules; live editable data) ─

CREATE TABLE business_expectations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id           INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  object_type         TEXT NOT NULL,
  property_or_action  TEXT NOT NULL,
  expectation_type    TEXT NOT NULL CHECK (expectation_type IN (
                          'AUTHORITY', 'VISIBILITY', 'MUTABILITY', 'STATE_ELIGIBILITY',
                          'MAX_LIMIT', 'ROLE_PERMISSION', 'REQUIRES_PREVIOUS_STATE',
                          'CONFIDENTIAL_UNTIL_STATE'
                        )),
  expected_value      TEXT NOT NULL,
  lifecycle_condition_json TEXT, -- declarative {field,operator,value}/{and|or|not:[...]} DSL only, never code
  severity            TEXT NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_business_expectations_target ON business_expectations(target_id);

CREATE TABLE business_invariants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id     INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  object_type   TEXT NOT NULL,
  condition_json TEXT NOT NULL, -- same declarative DSL as business_expectations.lifecycle_condition_json
  expected_json TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_business_invariants_target ON business_invariants(target_id);

-- ── scan-orchestration ──────────────────────────────────────────────────

-- scan_run_configs is written once at scan start and never updated again
-- (design.md Decision 25/51); scan_runs points to it, not the other way
-- around, so a running/finished scan never reads live `targets`/rule tables.
CREATE TABLE scan_run_configs (
  id                                  INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id                           INTEGER NOT NULL REFERENCES targets(id),
  scope_json                          TEXT NOT NULL,
  scan_mode                           TEXT NOT NULL CHECK (scan_mode IN ('PASSIVE', 'SAFE_AUTOMATIC', 'ADVANCED')),
  rate_limit_rps                      REAL NOT NULL,
  concurrency                         INTEGER NOT NULL DEFAULT 2,
  allow_private_networks              INTEGER NOT NULL DEFAULT 0 CHECK (allow_private_networks IN (0, 1)),
  environment                         TEXT NOT NULL
                                        CHECK (environment IN ('LOCAL_FIXTURE', 'DEVELOPMENT', 'STAGING', 'PRODUCTION')),
  browser_egress_level                TEXT CHECK (browser_egress_level IN ('BROWSER_EGRESS_STRICT', 'BROWSER_EGRESS_BEST_EFFORT')),
  enabled_scanners_json               TEXT NOT NULL DEFAULT '[]',
  enabled_business_profiles_json      TEXT NOT NULL DEFAULT '[]',
  write_test_flags_json               TEXT NOT NULL DEFAULT '{}',
  mutation_scope_snapshot_json        TEXT NOT NULL DEFAULT '[]',
  business_expectations_snapshot_json TEXT NOT NULL DEFAULT '[]',
  business_invariants_snapshot_json   TEXT NOT NULL DEFAULT '[]',
  authorization_expectations_snapshot_json TEXT NOT NULL DEFAULT '[]',
  mutation_authorization_confirmed_by TEXT,
  mutation_authorization_confirmed_at TEXT,
  created_at                          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE scan_runs (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id                INTEGER NOT NULL REFERENCES targets(id),
  scan_run_config_id       INTEGER NOT NULL REFERENCES scan_run_configs(id),
  state                    TEXT NOT NULL DEFAULT 'PASSIVE_PENDING' CHECK (state IN (
                              'PASSIVE_PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED',
                              'CANCELLED', 'RESTORE_REQUIRED', 'COMPLETED_WITH_RECOVERY'
                            )),
  had_restore_incident     INTEGER NOT NULL DEFAULT 0 CHECK (had_restore_incident IN (0, 1)),
  had_partial_truncation   INTEGER NOT NULL DEFAULT 0 CHECK (had_partial_truncation IN (0, 1)),
  truncation_limit_reached TEXT,
  started_at               TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at              TEXT
);

CREATE INDEX idx_scan_runs_target ON scan_runs(target_id);

CREATE TABLE scan_run_auth_profiles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id     INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  auth_profile_id INTEGER NOT NULL REFERENCES auth_profiles(id),
  UNIQUE (scan_run_id, auth_profile_id)
);

-- ── crawler-api-discovery / dns-http-discovery ──────────────────────────

CREATE TABLE discovered_hosts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id      INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  hostname         TEXT NOT NULL,
  in_scope         INTEGER NOT NULL CHECK (in_scope IN (0, 1)),
  discovery_source TEXT NOT NULL CHECK (discovery_source IN (
                       'REDIRECT', 'LINK', 'SCRIPT', 'CNAME', 'TLS_SAN', 'BROWSER', 'CRAWL', 'MANUAL'
                     )),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_discovered_hosts_scan_run ON discovered_hosts(scan_run_id);

CREATE TABLE discovered_endpoints (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id    INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  method         TEXT NOT NULL,
  url            TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (classification IN (
                     'AUTH', 'CONFIGURATION', 'USER', 'PROJECT', 'CAMPAIGN', 'PAYMENT',
                     'PUBLIC', 'ADMIN', 'UNKNOWN'
                   )),
  content_type   TEXT,
  discovered_via TEXT NOT NULL DEFAULT 'STATIC' CHECK (discovered_via IN ('STATIC', 'BROWSER', 'OPENAPI')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_discovered_endpoints_scan_run ON discovered_endpoints(scan_run_id);

CREATE TABLE discovered_fields (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id            INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  endpoint_id            INTEGER REFERENCES discovered_endpoints(id) ON DELETE CASCADE,
  field_path             TEXT NOT NULL,
  classification         TEXT NOT NULL CHECK (classification IN (
                             'HTML', 'URL', 'IDENTIFIER', 'GTM', 'PIXEL', 'EMAIL', 'PHONE',
                             'BOOLEAN', 'NUMBER', 'GENERIC_STRING'
                           )),
  sample_value_sanitized TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_discovered_fields_scan_run ON discovered_fields(scan_run_id);
CREATE INDEX idx_discovered_fields_endpoint ON discovered_fields(endpoint_id);

-- ── operation-discovery ─────────────────────────────────────────────────

CREATE TABLE discovered_operations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id        INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  method             TEXT NOT NULL,
  url                TEXT NOT NULL,
  content_type       TEXT,
  request_schema_json  TEXT,
  response_schema_json TEXT,
  source             TEXT NOT NULL CHECK (source IN (
                         'OPENAPI', 'HTML_FORM', 'JAVASCRIPT_STATIC_ANALYSIS',
                         'BROWSER_RUNTIME', 'BROWSER_DRY_RUN', 'MANUAL'
                       )),
  confidence         TEXT NOT NULL CHECK (confidence IN ('LOW', 'MEDIUM', 'HIGH')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_discovered_operations_scan_run ON discovered_operations(scan_run_id);
CREATE INDEX idx_discovered_operations_method_url ON discovered_operations(method, url);

-- ── json-field-analysis / candidate-eligibility ─────────────────────────

CREATE TABLE candidates (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id          INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  scanner              TEXT NOT NULL,
  endpoint_id          INTEGER REFERENCES discovered_endpoints(id) ON DELETE SET NULL,
  operation_id         INTEGER REFERENCES discovered_operations(id) ON DELETE SET NULL,
  field_path           TEXT,
  confidence           TEXT CHECK (confidence IN ('LOW', 'MEDIUM', 'HIGH')),
  priority             INTEGER CHECK (priority IN (1, 2, 3)),
  eligibility_state    TEXT NOT NULL DEFAULT 'INCONCLUSIVE' CHECK (eligibility_state IN (
                           'TESTABLE', 'PASSIVE_ONLY', 'SKIPPED_NO_WRITE_TEMPLATE', 'SKIPPED_NO_AUTH',
                           'SKIPPED_NO_OWNERSHIP_DATA', 'SKIPPED_SENSITIVE_RESOURCE', 'SKIPPED_OUT_OF_SCOPE',
                           'SKIPPED_NON_TEST_RESOURCE', 'SKIPPED_REVERSIBILITY_NOT_PROVEN',
                           'SKIPPED_ENVIRONMENT_POLICY', 'INCONCLUSIVE', 'INCONCLUSIVE_BUSINESS_EXPECTATION',
                           'INCONCLUSIVE_TRUST_BOUNDARY'
                         )),
  browser_testability  TEXT CHECK (browser_testability IN (
                           'REQUIRES_BROWSER_RUNTIME', 'BROWSER_TESTABLE', 'BROWSER_INCONCLUSIVE',
                           'DRY_RUN_UNAVAILABLE', 'FULLY_TESTABLE'
                         )),
  evidentiary_outcome  TEXT NOT NULL DEFAULT 'NOT_TESTED' CHECK (evidentiary_outcome IN (
                           'PROVEN_VULNERABLE', 'PROVEN_BLOCKED', 'INCONCLUSIVE', 'NOT_TESTED'
                         )),
  metadata_json        TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_candidates_scan_run ON candidates(scan_run_id);
CREATE INDEX idx_candidates_eligibility_state ON candidates(eligibility_state);

-- ── scanners-xss-gtm-idor ────────────────────────────────────────────────

CREATE TABLE resource_ownership (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id           INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  origin              TEXT NOT NULL,
  tenant_id           TEXT,
  object_type         TEXT NOT NULL,
  resource_id         TEXT NOT NULL,
  owner_auth_profile_id INTEGER NOT NULL REFERENCES auth_profiles(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (target_id, origin, tenant_id, object_type, resource_id)
);

CREATE INDEX idx_resource_ownership_key ON resource_ownership(target_id, object_type, resource_id);

CREATE TABLE authorization_expectations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_profile_id INTEGER NOT NULL REFERENCES auth_profiles(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  expected        TEXT NOT NULL CHECK (expected IN ('ALLOWED', 'DENIED')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (auth_profile_id, action)
);

-- ── backup-restore-evidence ─────────────────────────────────────────────
-- resource_backups / resource_locks / mutation_journal / business_test_plans
-- all key on the canonical ResourceKey columns, never a bare resource id,
-- per design.md Decision 49.

CREATE TABLE resource_backups (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id         INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  target_id           INTEGER NOT NULL REFERENCES targets(id),
  origin              TEXT NOT NULL,
  tenant_id           TEXT,
  object_type         TEXT NOT NULL,
  resource_id         TEXT NOT NULL,
  content             TEXT NOT NULL,
  content_hash        TEXT NOT NULL,
  captured_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_resource_backups_key ON resource_backups(target_id, origin, tenant_id, object_type, resource_id);

CREATE TABLE resource_locks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id           INTEGER NOT NULL REFERENCES targets(id),
  origin              TEXT NOT NULL,
  tenant_id           TEXT,
  object_type         TEXT NOT NULL,
  resource_id         TEXT NOT NULL,
  holder              TEXT NOT NULL, -- e.g. "API:<scanner>" / "BROWSER" / "BUSINESS_LOGIC:<plan-id>"
  acquired_at         TEXT NOT NULL DEFAULT (datetime('now')),
  lease_expires_at    TEXT NOT NULL,
  UNIQUE (target_id, origin, tenant_id, object_type, resource_id)
);

CREATE TABLE mutation_journal (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id         INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  target_id           INTEGER NOT NULL REFERENCES targets(id),
  origin              TEXT NOT NULL,
  tenant_id           TEXT,
  object_type         TEXT NOT NULL,
  resource_id         TEXT NOT NULL,
  initiator           TEXT NOT NULL CHECK (initiator IN ('API', 'BROWSER', 'BUSINESS_LOGIC')),
  field_path          TEXT,
  state               TEXT NOT NULL CHECK (state IN (
                          'BACKUP_CREATED', 'MUTATION_PENDING', 'MUTATION_APPLIED', 'RESTORE_PENDING',
                          'RESTORE_OK', 'RESTORE_FAILED', 'RESTORE_CONFLICT'
                        )),
  requires_manual_intervention INTEGER NOT NULL DEFAULT 0 CHECK (requires_manual_intervention IN (0, 1)),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_mutation_journal_key ON mutation_journal(target_id, origin, tenant_id, object_type, resource_id);
CREATE INDEX idx_mutation_journal_state ON mutation_journal(state);

-- ── browser-security-testing ────────────────────────────────────────────

CREATE TABLE browser_sessions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_profile_id     INTEGER NOT NULL REFERENCES auth_profiles(id) ON DELETE CASCADE,
  session_ciphertext  BLOB NOT NULL,
  session_iv          BLOB NOT NULL,
  session_tag         BLOB NOT NULL,
  established_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at        TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at          TEXT NOT NULL,
  revoked_at          TEXT
);

CREATE INDEX idx_browser_sessions_auth_profile ON browser_sessions(auth_profile_id);

CREATE TABLE browser_actions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id    INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  page_url       TEXT NOT NULL,
  label          TEXT,
  classification TEXT NOT NULL CHECK (classification IN (
                     'SAFE_READ', 'SAFE_MUTATION', 'SENSITIVE_MUTATION', 'DESTRUCTIVE', 'UNKNOWN',
                     'DOWNLOAD_ACTION', 'UPLOAD_SURFACE'
                   )),
  status         TEXT NOT NULL DEFAULT 'DISCOVERED' CHECK (status IN (
                     'DISCOVERED', 'EXECUTED', 'SKIPPED', 'BLOCKED', 'DRY_RUN_CAPTURED', 'DRY_RUN_AMBIGUOUS'
                   )),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_browser_actions_scan_run ON browser_actions(scan_run_id);

-- ── evidence (findings-reporting) ───────────────────────────────────────
-- Declared here, ahead of business-logic-testing's per-scan tables, so
-- `business_observed_properties.evidence_id` can hold a real foreign key
-- instead of an undefined/untyped reference.

CREATE TABLE evidence (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id           INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  candidate_id          INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
  auth_profile_id       INTEGER REFERENCES auth_profiles(id) ON DELETE SET NULL,
  endpoint              TEXT,
  field_path            TEXT,
  request_sanitized_json  TEXT,
  response_sanitized_json TEXT,
  original_value_sanitized TEXT,
  test_value_sanitized     TEXT,
  verification_outcome  TEXT,
  restore_status        TEXT CHECK (restore_status IN ('RESTORE_OK', 'RESTORE_FAILED', 'RESTORE_CONFLICT') OR restore_status IS NULL),
  truncated             INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  original_size          INTEGER,
  content_hash           TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_evidence_scan_run ON evidence(scan_run_id);

-- ── business-logic-testing (per-scan discovered/observed data) ─────────

CREATE TABLE business_objects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id  INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  object_type  TEXT NOT NULL,
  source       TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_business_objects_scan_run ON business_objects(scan_run_id);

CREATE TABLE business_states (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id  INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  object_type  TEXT NOT NULL,
  state_value  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_business_states_scan_run ON business_states(scan_run_id);

CREATE TABLE business_operations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id    INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  object_type    TEXT NOT NULL,
  operation_id   INTEGER REFERENCES discovered_operations(id) ON DELETE SET NULL,
  description    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_business_operations_scan_run ON business_operations(scan_run_id);

CREATE TABLE business_observed_properties (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id         INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  object_type         TEXT NOT NULL,
  property_or_action  TEXT NOT NULL,
  observed_value_json TEXT NOT NULL,
  evidence_id         INTEGER REFERENCES evidence(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_business_observed_properties_scan_run ON business_observed_properties(scan_run_id);
CREATE INDEX idx_business_observed_properties_key ON business_observed_properties(object_type, property_or_action);

CREATE TABLE webhook_operations (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id                 INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  endpoint                    TEXT NOT NULL,
  provider                    TEXT,
  authentication_mechanism    TEXT,
  signature_mechanism         TEXT,
  replay_protection           TEXT,
  idempotency                 TEXT,
  resulting_state_transition  TEXT,
  auth_analysis_result        TEXT CHECK (auth_analysis_result IN (
                                  'VERIFIED_MECHANISM_DETECTED', 'NO_MECHANISM_OBSERVED', 'INCONCLUSIVE'
                                )),
  created_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_webhook_operations_scan_run ON webhook_operations(scan_run_id);

-- ── findings (findings-reporting) ───────────────────────────────────────

CREATE TABLE findings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id          INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  severity             TEXT NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  category             TEXT CHECK (category IN (
                           'BUSINESS_LOGIC', 'WORKFLOW_BYPASS', 'PARAMETER_TAMPERING', 'SERVER_CONTROLLED_FIELD',
                           'STATE_EXPOSURE', 'PREDICTABILITY', 'REPLAY', 'MISSING_IDEMPOTENCY', 'RACE_CONDITION',
                           'LIMIT_BYPASS', 'INVALID_STATE_TRANSITION', 'BUSINESS_AUTHORIZATION',
                           'BUSINESS_STATE_INFERENCE'
                         ) OR category IS NULL),
  confidence           TEXT CHECK (confidence IN ('LOW', 'MEDIUM', 'HIGH') OR confidence IS NULL),
  proof_level          TEXT CHECK (proof_level IN (
                           'OBSERVED', 'INFERRED', 'SAFE_PROBE_CONFIRMED', 'CONFIRMED', 'INCONCLUSIVE', 'NOT_TESTED'
                         ) OR proof_level IS NULL),
  target_endpoint      TEXT,
  field_path           TEXT,
  auth_profile_id      INTEGER REFERENCES auth_profiles(id) ON DELETE SET NULL,
  evidence_id          INTEGER REFERENCES evidence(id) ON DELETE SET NULL,
  recommendation       TEXT,
  restore_status       TEXT,
  evidentiary_outcome  TEXT NOT NULL DEFAULT 'NOT_TESTED' CHECK (evidentiary_outcome IN (
                           'PROVEN_VULNERABLE', 'PROVEN_BLOCKED', 'INCONCLUSIVE', 'NOT_TESTED'
                         )),
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_findings_scan_run ON findings(scan_run_id);
CREATE INDEX idx_findings_severity ON findings(severity);

CREATE TABLE browser_evidence (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id           INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  finding_id            INTEGER REFERENCES findings(id) ON DELETE SET NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('SCREENSHOT', 'DOM_SNAPSHOT')),
  asset_ref             TEXT,
  structural_data_json  TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_browser_evidence_scan_run ON browser_evidence(scan_run_id);

CREATE TABLE business_test_plans (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id          INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  target_id            INTEGER REFERENCES targets(id),
  origin               TEXT,
  tenant_id            TEXT,
  object_type          TEXT,
  resource_id          TEXT,
  candidate_id         INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
  operation_id         INTEGER REFERENCES discovered_operations(id) ON DELETE SET NULL,
  invariant_id         INTEGER REFERENCES business_invariants(id) ON DELETE SET NULL,
  expectation_id       INTEGER REFERENCES business_expectations(id) ON DELETE SET NULL,
  safety_classification TEXT NOT NULL CHECK (safety_classification IN (
                            'PASSIVE', 'SAFE_READ', 'SAFE_REVERSIBLE_MUTATION', 'SENSITIVE', 'FINANCIAL', 'DESTRUCTIVE'
                          )),
  proof_level          TEXT CHECK (proof_level IN (
                           'OBSERVED', 'INFERRED', 'SAFE_PROBE_CONFIRMED', 'CONFIRMED', 'INCONCLUSIVE', 'NOT_TESTED'
                         ) OR proof_level IS NULL),
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_business_test_plans_scan_run ON business_test_plans(scan_run_id);
CREATE INDEX idx_business_test_plans_key ON business_test_plans(target_id, origin, tenant_id, object_type, resource_id);

-- ── scan-orchestration: audit trail ─────────────────────────────────────

CREATE TABLE audit_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_run_id   INTEGER NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  payload_json  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_events_scan_run ON audit_events(scan_run_id);
CREATE INDEX idx_audit_events_type ON audit_events(event_type);
