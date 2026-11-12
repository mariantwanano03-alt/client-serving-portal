-- Allow discovery sessions to exist without a client or project
ALTER TABLE discovery_sessions ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE discovery_sessions ALTER COLUMN client_id DROP NOT NULL;

-- Track who created the discovery session
ALTER TABLE discovery_sessions ADD COLUMN IF NOT EXISTS created_by uuid references profiles(id);
