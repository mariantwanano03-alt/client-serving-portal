-- ==========================================================================
-- Fix discovery_sessions RLS: allow any authenticated user to update transcript
-- ==========================================================================

-- Drop the senior-only update policy
DROP POLICY IF EXISTS "ds_update_senior_pm" ON discovery_sessions;

-- Allow any authenticated user to update discovery sessions (transcript, notes, etc.)
-- Approval actions (generation_status changes) are still gated by the API route
-- and frontend canApprove checks.
CREATE POLICY "ds_update_authenticated" ON discovery_sessions
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
