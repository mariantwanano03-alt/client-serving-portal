-- Allow administrators to view all clients in the Admin console
DROP POLICY IF EXISTS "Staff can view clients" ON clients;
CREATE POLICY "Staff can view clients" ON clients
  FOR SELECT
  TO authenticated
  USING (current_user_role() IN ('administrator', 'senior_dev_pm', 'junior_developer'));
