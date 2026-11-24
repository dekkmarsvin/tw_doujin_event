-- Tables retired in #546: map contributors (5a), batched notifications (5c)
-- and the GitHub publication webhook log (4b).

DROP TABLE IF EXISTS map_contributor_grants;
DROP TABLE IF EXISTS map_draft_files;
DROP TABLE IF EXISTS map_draft_reviews;
DROP TABLE IF EXISTS map_draft_comments;
DROP TABLE IF EXISTS map_draft_exports;
DROP TABLE IF EXISTS account_notification_batches;
DROP TABLE IF EXISTS admin_notification_preferences;
DROP TABLE IF EXISTS review_notification_batches;
DROP TABLE IF EXISTS review_notification_items;
DROP TABLE IF EXISTS github_webhook_deliveries;

-- Older deployments stay reachable at their own URLs and still carry the
-- runtime initializer that 5d removed. It skips table creation once this
-- marker is at or past its version, so a far-ahead value keeps those
-- deployments from recreating the tables dropped above.
CREATE TABLE IF NOT EXISTS identity_runtime_state (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL CHECK (version >= 0));
INSERT INTO identity_runtime_state (id, version) VALUES (1, 1000000) ON CONFLICT(id) DO UPDATE SET version = excluded.version;
