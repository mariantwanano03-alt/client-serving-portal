-- Tag requirement rows with the discovery session that created them so that
-- retrying an approve chain is idempotent at the row level.
ALTER TABLE requirements
  ADD COLUMN IF NOT EXISTS discovery_session_id uuid NULL
    REFERENCES discovery_sessions(id) ON DELETE SET NULL;

-- Index for the dedupe lookup path
CREATE INDEX IF NOT EXISTS idx_requirements_discovery_session
  ON requirements(discovery_session_id)
  WHERE discovery_session_id IS NOT NULL;
