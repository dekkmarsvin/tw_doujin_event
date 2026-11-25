-- Baseline (#546 phase 5d): the schema the runtime initializer built, minus
-- the tables 0002 retires. Every statement is IF NOT EXISTS, so applying it
-- to a database the initializer already built changes nothing.

CREATE TABLE IF NOT EXISTS event_notices (
  event_id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('info', 'important')),
  text TEXT NOT NULL,
  url TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS planning_shares (
  share_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  items_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  request_ip_hash TEXT
);
CREATE TABLE IF NOT EXISTS site_settings (
  id TEXT PRIMARY KEY CHECK (id = 'global'),
  organizer_application_mode TEXT NOT NULL CHECK (organizer_application_mode IN ('closed', 'invite_only', 'public')),
  organizer_allowed_emails_json TEXT NOT NULL,
  account_notifications_enabled INTEGER NOT NULL CHECK (account_notifications_enabled IN (0, 1)),
  account_notifications_since INTEGER,
  admin_review_notifications_enabled INTEGER NOT NULL CHECK (admin_review_notifications_enabled IN (0, 1)),
  publication_enabled INTEGER NOT NULL CHECK (publication_enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  contact_url TEXT NOT NULL DEFAULT '',
  claim_review_notice TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS site_service_check (
  id TEXT PRIMARY KEY CHECK (id = 'global'),
  requested_at INTEGER NOT NULL,
  checked_at INTEGER,
  result_json TEXT
);
CREATE TABLE IF NOT EXISTS account_notification_preferences (
  account_id TEXT PRIMARY KEY NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('off', 'hourly', 'daily')),
  version INTEGER NOT NULL,
  enabled_since INTEGER NOT NULL,
  write_token TEXT NOT NULL,
  locale TEXT
);
CREATE TABLE IF NOT EXISTS account_notification_items (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  occurrence TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  event_id TEXT,
  circle_id TEXT,
  candidate_id TEXT,
  source_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER,
  detail TEXT NOT NULL DEFAULT '',
  occurred_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  batch_id TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted', 'cancelled', 'failed')),
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER,
  disabled_at INTEGER,
  deletion_started_at INTEGER
);
CREATE TABLE IF NOT EXISTS admins (
  email TEXT PRIMARY KEY NOT NULL,
  added_by TEXT,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  request_ip_hash TEXT,
  audience TEXT NOT NULL DEFAULT 'circle',
  minted_by TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS circle_claims (
  notification_submission_id TEXT,
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  circle_id TEXT NOT NULL,
  circle_name_key TEXT NOT NULL,
  circle_name_at_claim TEXT NOT NULL,
  source_row_at_claim INTEGER,
  status TEXT NOT NULL,
  method TEXT,
  target_url TEXT,
  challenge_token_hash TEXT,
  challenge_expires_at INTEGER,
  challenge_attempts INTEGER NOT NULL DEFAULT 0,
  evidence_url TEXT,
  evidence_note TEXT,
  created_at INTEGER NOT NULL,
  verified_at INTEGER,
  reviewed_by TEXT,
  reviewed_at INTEGER
);
CREATE TABLE IF NOT EXISTS circle_overrides (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  circle_id TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  previous_fields_json TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'live',
  updated_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  post_event_hidden INTEGER NOT NULL DEFAULT 0,
  retention_choice TEXT,
  retention_expires_at INTEGER,
  hosted_thumbnail_key TEXT,
  takedown_reason TEXT,
  takendown_by TEXT,
  takendown_at INTEGER
);
CREATE TABLE IF NOT EXISTS overrides_doc (
  event_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  phase TEXT NOT NULL DEFAULT 'during'
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  at INTEGER NOT NULL,
  actor_account_id TEXT,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  detail_json TEXT,
  ip_hash TEXT,
  shredded_at INTEGER
);
CREATE TABLE IF NOT EXISTS preview_mail_sink (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS map_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  candidate_id TEXT,
  period_key TEXT NOT NULL,
  venue_space_id TEXT NOT NULL,
  owner_account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  current_revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  decision_at INTEGER,
  transition_token TEXT,
  retention_action TEXT
);
CREATE TABLE IF NOT EXISTS map_draft_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content_json TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organizer_reference_records (
  path TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  organizer_id TEXT,
  revision TEXT,
  display_name TEXT NOT NULL,
  public_reference_json TEXT NOT NULL,
  source_captured_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS organizer_category_sequences (
  reference_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organizer_venues (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  source_url TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organizer_venue_spaces (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  source_url TEXT,
  default_area_mode TEXT NOT NULL DEFAULT 'imported',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organizer_applications (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  reason TEXT NOT NULL DEFAULT '',
  candidate_id TEXT UNIQUE,
  review_token TEXT
);
CREATE TABLE IF NOT EXISTS organizer_event_candidates (
  notification_submission_id TEXT,
  id TEXT PRIMARY KEY NOT NULL,
  tentative_name TEXT NOT NULL,
  event_id TEXT,
  event_id_locked_at INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  current_version INTEGER NOT NULL DEFAULT 1,
  current_draft_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_updated_by TEXT NOT NULL,
  last_updated_role TEXT NOT NULL,
  submitted_by TEXT,
  submitted_at INTEGER,
  approved_by TEXT,
  approved_at INTEGER,
  published_version INTEGER,
  published_at INTEGER,
  publication_operation TEXT NOT NULL DEFAULT 'CREATE' CHECK (publication_operation IN ('CREATE', 'AMEND'))
);
CREATE TABLE IF NOT EXISTS organizer_amendments (
  candidate_id TEXT PRIMARY KEY NOT NULL,
  source_candidate_id TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  source_job_id TEXT NOT NULL,
  baseline_json TEXT NOT NULL,
  baseline_sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organizer_amendment_changes (
  candidate_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  changes_json TEXT NOT NULL,
  settings_json TEXT,
  revision_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organizer_workspace_state (
  candidate_id TEXT PRIMARY KEY NOT NULL,
  onboarding_completed_at INTEGER,
  onboarding_completed_by TEXT,
  last_validated_version INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organizer_workspace_preferences (
  id TEXT PRIMARY KEY NOT NULL,
  candidate_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  guided_task TEXT NOT NULL DEFAULT 'identity_source',
  last_section TEXT NOT NULL DEFAULT 'event',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organizer_event_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  candidate_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  event_id TEXT,
  draft_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_role TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organizer_event_grants (
  id TEXT PRIMARY KEY NOT NULL,
  candidate_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  role TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  revoked_by TEXT,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS organizer_event_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  candidate_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  accepted_by TEXT,
  accepted_at INTEGER,
  revoked_by TEXT,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS organizer_event_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  candidate_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor_account_id TEXT NOT NULL,
  note TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organizer_import_sources (
  id TEXT PRIMARY KEY NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_version INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  worksheet TEXT,
  sha256 TEXT NOT NULL,
  source_description TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  replaced_at INTEGER
);
CREATE TABLE IF NOT EXISTS organizer_import_rows (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  day_id TEXT NOT NULL,
  venue_space_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  booth_code TEXT NOT NULL,
  codes_json TEXT,
  circle_name TEXT NOT NULL,
  stable_key TEXT,
  identity_group TEXT
);
CREATE TABLE IF NOT EXISTS organizer_submission_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organizer_publication_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_version INTEGER NOT NULL,
  snapshot_id TEXT NOT NULL,
  approval_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  step TEXT NOT NULL DEFAULT 'assemble',
  data_pr_number INTEGER,
  data_head_sha TEXT,
  data_merge_sha TEXT,
  main_pr_number INTEGER,
  main_head_sha TEXT,
  main_merge_sha TEXT,
  workflow_run_id INTEGER,
  workflow_run_attempt INTEGER,
  workflow_retry_attempt INTEGER,
  production_manifest_sha256 TEXT,
  failure_code TEXT,
  retryable INTEGER NOT NULL DEFAULT 1,
  remote_write_intent_at INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  pending_attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organizer_publication_lease (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  token TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS planning_shares_expiry_idx ON planning_shares(expires_at);
CREATE INDEX IF NOT EXISTS planning_shares_ip_idx ON planning_shares(request_ip_hash, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS account_notification_occurrence_idx ON account_notification_items(occurrence, account_id);
CREATE INDEX IF NOT EXISTS account_notification_due_idx ON account_notification_items(state, batch_id, due_at);
CREATE INDEX IF NOT EXISTS account_notification_recipient_idx ON account_notification_items(account_id, state);
CREATE INDEX IF NOT EXISTS account_notification_batch_items_idx ON account_notification_items(batch_id, state);
CREATE INDEX IF NOT EXISTS organizer_applications_account_idx ON organizer_applications(account_id, created_at);
CREATE INDEX IF NOT EXISTS organizer_applications_status_idx ON organizer_applications(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_applications_review_idx ON organizer_applications(review_token);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_idx ON accounts(email);
CREATE UNIQUE INDEX IF NOT EXISTS login_tokens_hash_idx ON login_tokens(token_hash);
CREATE INDEX IF NOT EXISTS login_tokens_email_idx ON login_tokens(email, created_at);
CREATE INDEX IF NOT EXISTS login_tokens_ip_idx ON login_tokens(request_ip_hash, created_at);
CREATE INDEX IF NOT EXISTS login_tokens_expiry_idx ON login_tokens(expires_at);
CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS circle_claims_account_circle_idx ON circle_claims(event_id, circle_id, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS circle_claims_one_owner_idx ON circle_claims(event_id, circle_id) WHERE status = 'verified';
CREATE INDEX IF NOT EXISTS circle_claims_status_idx ON circle_claims(status, created_at);
CREATE INDEX IF NOT EXISTS circle_claims_account_idx ON circle_claims(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS circle_overrides_key_idx ON circle_overrides(event_id, circle_id);
CREATE INDEX IF NOT EXISTS circle_overrides_live_idx ON circle_overrides(event_id, status, updated_at);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log(at);
CREATE INDEX IF NOT EXISTS audit_subject_idx ON audit_log(subject_type, subject_id, at);
CREATE INDEX IF NOT EXISTS preview_mail_sink_email_idx ON preview_mail_sink(email, created_at);
CREATE INDEX IF NOT EXISTS map_drafts_owner_idx ON map_drafts(owner_account_id, updated_at);
CREATE INDEX IF NOT EXISTS map_drafts_scope_idx ON map_drafts(event_id, period_key, venue_space_id, updated_at);
CREATE INDEX IF NOT EXISTS map_drafts_candidate_scope_idx ON map_drafts(candidate_id, period_key, venue_space_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS map_drafts_candidate_active_idx ON map_drafts(candidate_id, period_key, venue_space_id) WHERE candidate_id IS NOT NULL AND status <> 'withdrawn';
CREATE UNIQUE INDEX IF NOT EXISTS map_drafts_one_active_approved_idx ON map_drafts(event_id, period_key, venue_space_id) WHERE status IN ('approved', 'exported');
CREATE UNIQUE INDEX IF NOT EXISTS map_draft_revisions_key_idx ON map_draft_revisions(draft_id, revision);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_venues_name_idx ON organizer_venues(name_key);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_venue_spaces_venue_idx ON organizer_venue_spaces(venue_id, name_key);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_venue_spaces_id_venue_idx ON organizer_venue_spaces(id, venue_id);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_candidates_event_id_idx ON organizer_event_candidates(event_id) WHERE event_id IS NOT NULL AND publication_operation = 'CREATE';
CREATE UNIQUE INDEX IF NOT EXISTS organizer_candidates_active_amendment_idx ON organizer_event_candidates(event_id) WHERE publication_operation = 'AMEND' AND status NOT IN ('published','abandoned');
CREATE UNIQUE INDEX IF NOT EXISTS organizer_amendment_changes_version_idx ON organizer_amendment_changes(candidate_id, version);
CREATE INDEX IF NOT EXISTS organizer_candidates_status_idx ON organizer_event_candidates(status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_workspace_preferences_key_idx ON organizer_workspace_preferences(candidate_id, account_id);
CREATE INDEX IF NOT EXISTS organizer_workspace_preferences_account_idx ON organizer_workspace_preferences(account_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_revisions_key_idx ON organizer_event_revisions(candidate_id, version);
CREATE INDEX IF NOT EXISTS organizer_grants_account_idx ON organizer_event_grants(account_id, revoked_at, candidate_id);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_grants_key_idx ON organizer_event_grants(candidate_id, account_id);
CREATE INDEX IF NOT EXISTS organizer_invitations_email_idx ON organizer_event_invitations(email, accepted_at, revoked_at);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_invitations_active_idx ON organizer_event_invitations(candidate_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS organizer_reviews_candidate_idx ON organizer_event_reviews(candidate_id, at);
CREATE INDEX IF NOT EXISTS organizer_import_sources_candidate_idx ON organizer_import_sources(candidate_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_import_sources_active_idx ON organizer_import_sources(candidate_id) WHERE replaced_at IS NULL;
CREATE INDEX IF NOT EXISTS organizer_import_rows_source_idx ON organizer_import_rows(source_id, source_row);
CREATE INDEX IF NOT EXISTS organizer_import_rows_placement_idx ON organizer_import_rows(candidate_id, day_id, venue_space_id, booth_code);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_snapshots_key_idx ON organizer_submission_snapshots(candidate_id, candidate_version);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_snapshots_hash_idx ON organizer_submission_snapshots(sha256);
CREATE UNIQUE INDEX IF NOT EXISTS organizer_publication_candidate_idx ON organizer_publication_jobs(candidate_id, candidate_version);
CREATE INDEX IF NOT EXISTS organizer_publication_queue_idx ON organizer_publication_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS organizer_publication_due_idx ON organizer_publication_jobs(status, next_attempt_at, created_at);
