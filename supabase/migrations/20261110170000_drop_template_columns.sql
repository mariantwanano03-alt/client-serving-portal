-- Remove the speculative template feature.
-- Discovery is the single source of truth; no pre-meeting category label needed.
ALTER TABLE projects DROP COLUMN IF EXISTS template;
ALTER TABLE discovery_sessions DROP COLUMN IF EXISTS template;
