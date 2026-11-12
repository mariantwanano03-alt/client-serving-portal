-- Add missing columns to assignments table for admin project assignment
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS assignment_role text DEFAULT 'developer';
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS approval_authority boolean DEFAULT false;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- Update existing rows to have sensible defaults
UPDATE assignments SET assignment_role = 'developer' WHERE assignment_role IS NULL;
UPDATE assignments SET approval_authority = false WHERE approval_authority IS NULL;
UPDATE assignments SET is_active = true WHERE is_active IS NULL;

-- Fix RLS policies - add administrator to assignments
DROP POLICY IF EXISTS "Staff can view assignments" ON assignments;
CREATE POLICY "Staff can view assignments" ON assignments
  FOR SELECT
  TO authenticated
  USING (current_user_role() IN ('administrator', 'senior_dev_pm', 'junior_developer'));

DROP POLICY IF EXISTS "Senior can manage assignments" ON assignments;
CREATE POLICY "Senior can manage assignments" ON assignments
  FOR ALL
  TO authenticated
  USING (current_user_role() IN ('administrator', 'senior_dev_pm'))
  WITH CHECK (current_user_role() IN ('administrator', 'senior_dev_pm'));

DROP POLICY IF EXISTS "Senior can insert assignments" ON assignments;
CREATE POLICY "Senior can insert assignments" ON assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (current_user_role() IN ('administrator', 'senior_dev_pm'));

-- Fix projects RLS - add administrator to edit/update
DROP POLICY IF EXISTS "Senior can edit projects" ON projects;
CREATE POLICY "Senior can edit projects" ON projects
  FOR UPDATE
  TO authenticated
  USING (current_user_role() IN ('administrator', 'senior_dev_pm'))
  WITH CHECK (current_user_role() IN ('administrator', 'senior_dev_pm'));
