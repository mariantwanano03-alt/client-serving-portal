-- Add developer_lead column to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS developer_lead uuid REFERENCES profiles(id);
