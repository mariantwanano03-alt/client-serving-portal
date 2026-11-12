-- Add project_id column to audit_entries for project-scoped audit tracking
ALTER TABLE audit_entries ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);
