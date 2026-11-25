-- #569: approval publishes within the request, so the publication jobs and
-- their lease are no longer written. Apply only after the code from #576 is
-- deployed; older deployments that still write them fail closed. Dropping a
-- table drops its indexes.

DROP TABLE IF EXISTS organizer_publication_lease;
DROP TABLE IF EXISTS organizer_publication_jobs;
