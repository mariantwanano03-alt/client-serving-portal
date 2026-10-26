-- Seed roles and permissions for the Client Serving Portal

insert into public.roles (name, description) values
  ('Administrator', 'Manages internal user accounts, roles and authorized system settings.'),
  ('Senior Developer / Project Manager', 'Manages clients and projects and oversees approvals and handover.'),
  ('Junior Developer', 'Assists with requirements and handover preparation.')
on conflict (name) do nothing;

-- Basic permission codes derived from the SRS permissions matrix
insert into public.permissions (code, description) values
  ('users.manage', 'Manage internal user accounts'),
  ('roles.manage', 'Manage roles and permissions'),
  ('settings.manage', 'Manage authorised system settings'),
  ('audit.view', 'View audit history'),
  ('clients.create', 'Create client records'),
  ('clients.edit', 'Edit client records'),
  ('projects.create', 'Create projects'),
  ('projects.edit', 'Edit projects'),
  ('discovery.capture', 'Capture discovery information'),
  ('requirements.capture', 'Capture and edit draft requirements'),
  ('requirements.approve', 'Approve requirements'),
  ('quotations.manage', 'Create quotations and proposals'),
  ('quotations.approve', 'Approve quotations and proposals'),
  ('documents.manage', 'Create and edit document revisions'),
  ('documents.approve', 'Approve documents'),
  ('financials.manage', 'Record SLA, PO, deposits'),
  ('payments.confirm', 'Confirm payment received'),
  ('readiness.run', 'Run readiness checks'),
  ('readiness.override', 'Override overridable readiness criteria'),
  ('assignment.manage', 'Assign development responsibility'),
  ('handover.prepare', 'Prepare handover'),
  ('devlink.record', 'Record development-link information'),
  ('devlink.verify', 'Verify development link'),
  ('workflow.complete', 'Mark workflow complete'),
  ('ai.request', 'Request AI assistance')
on conflict (code) do nothing;
