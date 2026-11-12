-- Add the missing status column to clients table
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('provisional', 'active', 'archived'));
