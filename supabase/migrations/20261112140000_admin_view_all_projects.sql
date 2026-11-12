-- Allow administrators to view all projects in the Admin console
DROP POLICY IF EXISTS "Staff can view projects" ON projects;
CREATE POLICY "Staff can view projects" ON projects
  FOR SELECT
  TO authenticated
  USING (current_user_role() IN ('administrator', 'senior_dev_pm', 'junior_developer'));
