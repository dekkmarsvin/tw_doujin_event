-- Keep each rejected submission available to its reviewer and audit history.
DROP INDEX circle_claims_account_circle_idx;
CREATE UNIQUE INDEX circle_claims_account_circle_idx ON circle_claims(event_id, circle_id, account_id)
  WHERE status <> 'rejected';
