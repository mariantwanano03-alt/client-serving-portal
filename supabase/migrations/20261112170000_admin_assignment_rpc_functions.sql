-- Create RPC functions for project assignment management
-- These functions are called by the Admin console to manage project staffing
DROP FUNCTION IF EXISTS assign_project_lead(uuid, uuid);
DROP FUNCTION IF EXISTS assign_project_developer(uuid, uuid);
-- assign_project_lead: Assign or transfer project lead with approval authority
CREATE OR REPLACE FUNCTION assign_project_lead(p_project_id uuid, p_user_id uuid)
RETURNS void AS $$
BEGIN
  -- Revoke existing lead's approval authority
  UPDATE assignments 
  SET approval_authority = false 
  WHERE project_id = p_project_id 
    AND assignment_role = 'lead' 
    AND is_active = true;
  
  -- Check if user already has an assignment on this project
  IF EXISTS (SELECT 1 FROM assignments WHERE project_id = p_project_id AND developer_user_id = p_user_id AND is_active = true) THEN
    -- Update existing assignment to lead with approval authority
    UPDATE assignments 
    SET assignment_role = 'lead', 
        approval_authority = true, 
        is_active = true,
        assigned_at = now()
    WHERE project_id = p_project_id 
      AND developer_user_id = p_user_id;
  ELSE
    -- Insert new lead assignment
    INSERT INTO assignments (project_id, developer_user_id, assignment_role, approval_authority, is_active, assigned_by, assigned_at)
    VALUES (p_project_id, p_user_id, 'lead', true, true, 
            (SELECT id FROM profiles WHERE id = auth.uid() LIMIT 1), 
            now());
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- assign_project_developer: Assign a developer to a project
CREATE OR REPLACE FUNCTION assign_project_developer(p_project_id uuid, p_user_id uuid)
RETURNS void AS $$
BEGIN
  -- Check if user already has an assignment on this project
  IF EXISTS (SELECT 1 FROM assignments WHERE project_id = p_project_id AND developer_user_id = p_user_id AND is_active = true) THEN
    -- Update existing assignment
    UPDATE assignments 
    SET assignment_role = 'developer', 
        approval_authority = false, 
        is_active = true,
        assigned_at = now()
    WHERE project_id = p_project_id 
      AND developer_user_id = p_user_id;
  ELSE
    -- Insert new developer assignment
    INSERT INTO assignments (project_id, developer_user_id, assignment_role, approval_authority, is_active, assigned_by, assigned_at)
    VALUES (p_project_id, p_user_id, 'developer', false, true, 
            (SELECT id FROM profiles WHERE id = auth.uid() LIMIT 1), 
            now());
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- set_project_approval_authority: Toggle approval authority on an assignment
CREATE OR REPLACE FUNCTION set_project_approval_authority(p_assignment_id uuid, p_enabled boolean)
RETURNS void AS $$
BEGIN
  UPDATE assignments 
  SET approval_authority = p_enabled
  WHERE id = p_assignment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- remove_project_assignment: Remove/deactivate an assignment
CREATE OR REPLACE FUNCTION remove_project_assignment(p_assignment_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE assignments 
  SET is_active = false, 
      revoked_at = now()
  WHERE id = p_assignment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
