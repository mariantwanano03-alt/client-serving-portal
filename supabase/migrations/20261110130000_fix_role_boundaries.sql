-- Fix RLS policies: allow administrator + junior_developer to view and create clients/projects
-- Also adds template column to projects

-- Clients: view
DROP POLICY IF EXISTS "Staff can view clients" ON clients;
CREATE POLICY "Staff can view clients" ON clients FOR SELECT TO authenticated
  USING (current_user_role() IN ('senior_dev_pm', 'junior_developer', 'administrator'));

-- Clients: insert
DROP POLICY IF EXISTS "Senior can create clients" ON clients;
CREATE POLICY "Staff can create clients" ON clients FOR INSERT TO authenticated
  WITH CHECK (current_user_role() IN ('senior_dev_pm', 'junior_developer', 'administrator'));

-- Projects: view
DROP POLICY IF EXISTS "Staff can view projects" ON projects;
CREATE POLICY "Staff can view projects" ON projects FOR SELECT TO authenticated
  USING (current_user_role() IN ('senior_dev_pm', 'junior_developer', 'administrator'));

-- Projects: insert
DROP POLICY IF EXISTS "Senior can create projects" ON projects;
CREATE POLICY "Staff can create projects" ON projects FOR INSERT TO authenticated
  WITH CHECK (current_user_role() IN ('senior_dev_pm', 'junior_developer', 'administrator'));

-- Add template column to projects (which template the project uses)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS template text NULL;
