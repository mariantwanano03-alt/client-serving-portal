-- Clients must have a real code and name
alter table clients
  add constraint client_code_not_blank check (length(trim(client_code)) > 0),
  add constraint client_name_not_blank check (length(trim(name)) > 0);

-- Projects must have a real reference and name
alter table projects
  add constraint project_reference_not_blank check (length(trim(project_reference)) > 0),
  add constraint project_name_not_blank check (length(trim(name)) > 0);