-- Full data model according to the Client Serving Portal SRS (nano)
-- Extends the existing core tables with the complete relational model,
-- constraints, helper functions and row-level security policies.

-- ------------------------------------------------------------------
-- 0. Extend existing core tables to match the SRS class breakdown
-- ------------------------------------------------------------------
alter table profiles
  add column if not exists username text unique,
  add column if not exists surname text,
  add column if not exists failed_login_count integer not null default 0;

alter table clients
  add column if not exists primary_contact text,
  add column if not exists billing_details text;

alter table projects
  add column if not exists description text;

-- ------------------------------------------------------------------
-- 1. Roles, permissions and role-permission mapping (RBAC)
-- ------------------------------------------------------------------
create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text
);

create table if not exists role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  unique (role_id, permission_id)
);

-- ------------------------------------------------------------------
-- 2. Client contacts
-- ------------------------------------------------------------------
create table if not exists client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  role text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  constraint client_contact_name_not_blank check (length(trim(name)) > 0)
);

-- ------------------------------------------------------------------
-- 3. Project stage history
-- ------------------------------------------------------------------
create table if not exists project_stage_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  status text,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- 4. Discovery records and attachments
-- ------------------------------------------------------------------
create table if not exists discovery_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  meeting_date date,
  attendees text,
  summary text,
  notes text,
  transcript_ref text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null,
  owner_id uuid not null,
  file_name text not null,
  content_type text,
  size bigint,
  storage_ref text not null,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now(),
  constraint attachment_owner_type_not_blank check (length(trim(owner_type)) > 0),
  constraint attachment_file_name_not_blank check (length(trim(file_name)) > 0)
);

-- ------------------------------------------------------------------
-- 5. Requirements and versions
-- ------------------------------------------------------------------
create table if not exists requirements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  requirement_ref text not null,
  title text not null,
  description text,
  priority text,
  status text not null default 'draft',
  current_version_id uuid,
  created_at timestamptz not null default now(),
  unique (project_id, requirement_ref),
  constraint requirement_title_not_blank check (length(trim(title)) > 0),
  constraint requirement_ref_not_blank check (length(trim(requirement_ref)) > 0)
);

create table if not exists requirement_versions (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references requirements(id) on delete cascade,
  version_no integer not null,
  title text not null,
  description text,
  priority text,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now(),
  unique (requirement_id, version_no),
  constraint requirement_version_title_not_blank check (length(trim(title)) > 0)
);

alter table requirements
  add constraint requirements_current_version_fk
  foreign key (current_version_id) references requirement_versions(id);

-- ------------------------------------------------------------------
-- 6. Documents, revisions, reviews and approvals
-- ------------------------------------------------------------------
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  type text,
  title text not null,
  current_revision_id uuid,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  constraint document_title_not_blank check (length(trim(title)) > 0)
);

create table if not exists document_revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  revision_no integer not null,
  storage_ref text,
  ai_generated boolean not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  status text not null default 'draft',
  unique (document_id, revision_no)
);

alter table documents
  add constraint documents_current_revision_fk
  foreign key (current_revision_id) references document_revisions(id);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references document_revisions(id) on delete cascade,
  reviewer_id uuid references profiles(id),
  outcome text,
  comment text,
  review_date timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references document_revisions(id) on delete cascade,
  approver_id uuid references profiles(id),
  decision text,
  comment text,
  approval_date timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- 7. Quotations / proposals and line items
-- ------------------------------------------------------------------
create table if not exists quotations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  type text not null default 'quotation',
  title text not null,
  currency text not null default 'ZAR',
  validity_date date,
  status text not null default 'draft',
  current_revision_id uuid references document_revisions(id),
  created_at timestamptz not null default now(),
  constraint quotation_title_not_blank check (length(trim(title)) > 0),
  constraint quotation_type_not_blank check (length(trim(type)) > 0)
);

create table if not exists quotation_line_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references quotations(id) on delete cascade,
  description text not null,
  quantity numeric not null default 1,
  unit_amount numeric not null default 0,
  amount numeric not null default 0,
  tax_rate numeric not null default 0,
  constraint quotation_line_description_not_blank check (length(trim(description)) > 0)
);

-- ------------------------------------------------------------------
-- 8. Financial records: SLA, PO, deposit, payment confirmation
-- ------------------------------------------------------------------
create table if not exists slas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  terms text,
  start_date date,
  end_date date,
  document_ref text,
  created_at timestamptz not null default now()
);

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  po_number text not null,
  amount numeric not null default 0,
  currency text not null default 'ZAR',
  po_date date,
  document_ref text,
  created_at timestamptz not null default now(),
  constraint purchase_order_number_not_blank check (length(trim(po_number)) > 0)
);

create table if not exists deposits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  amount numeric not null default 0,
  currency text not null default 'ZAR',
  due_date date,
  trigger text,
  status text not null default 'awaiting_payment',
  created_at timestamptz not null default now()
);

create table if not exists payment_confirmations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  deposit_id uuid references deposits(id),
  amount numeric not null default 0,
  payment_date date,
  reference text,
  confirmed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- 9. Readiness checks and items
-- ------------------------------------------------------------------
create table if not exists readiness_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  run_by uuid references profiles(id),
  run_at timestamptz not null default now(),
  result text
);

create table if not exists readiness_items (
  id uuid primary key default gen_random_uuid(),
  readiness_check_id uuid not null references readiness_checks(id) on delete cascade,
  criterion text not null,
  mandatory boolean not null default true,
  overridable boolean not null default false,
  result text not null default 'outstanding',
  override_reason text,
  overridden_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint readiness_item_criterion_not_blank check (length(trim(criterion)) > 0)
);

-- ------------------------------------------------------------------
-- 10. Assignment, handover and development link
-- ------------------------------------------------------------------
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  developer_user_id uuid references profiles(id),
  assigned_by uuid references profiles(id),
  assigned_at timestamptz not null default now()
);

create table if not exists handovers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  scope_summary text,
  notes text,
  prepared_by uuid references profiles(id),
  prepared_at timestamptz not null default now()
);

create table if not exists development_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  link_type text,
  url text not null,
  recorded_by uuid references profiles(id),
  recorded_at timestamptz not null default now(),
  verified boolean not null default false,
  verified_by uuid references profiles(id),
  verified_at timestamptz,
  constraint development_link_url_not_blank check (length(trim(url)) > 0)
);

-- ------------------------------------------------------------------
-- 11. AI requests, notifications and audit entries
-- ------------------------------------------------------------------
create table if not exists ai_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  capability text,
  provider text,
  requested_by uuid references profiles(id),
  requested_at timestamptz not null default now(),
  result_ref text
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references profiles(id),
  project_id uuid references projects(id),
  type text,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notification_message_not_blank check (length(trim(message)) > 0)
);

create table if not exists audit_entries (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now(),
  constraint audit_action_not_blank check (length(trim(action)) > 0),
  constraint audit_entity_type_not_blank check (length(trim(entity_type)) > 0)
);

-- ------------------------------------------------------------------
-- 12. Row-level security
-- ------------------------------------------------------------------
alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;
alter table client_contacts enable row level security;
alter table project_stage_history enable row level security;
alter table discovery_records enable row level security;
alter table attachments enable row level security;
alter table requirements enable row level security;
alter table requirement_versions enable row level security;
alter table documents enable row level security;
alter table document_revisions enable row level security;
alter table reviews enable row level security;
alter table approvals enable row level security;
alter table quotations enable row level security;
alter table quotation_line_items enable row level security;
alter table slas enable row level security;
alter table purchase_orders enable row level security;
alter table deposits enable row level security;
alter table payment_confirmations enable row level security;
alter table readiness_checks enable row level security;
alter table readiness_items enable row level security;
alter table assignments enable row level security;
alter table handovers enable row level security;
alter table development_links enable row level security;
alter table ai_requests enable row level security;
alter table notifications enable row level security;
alter table audit_entries enable row level security;

-- Update profile policy to require active users
drop policy if exists "Users can read their own profile" on profiles;
create policy "Users can read their own profile"
on profiles for select
to authenticated
using (id = auth.uid() and is_active);

create policy "Admins can manage profiles"
on profiles for all
to authenticated
using (current_user_role() = 'administrator')
with check (current_user_role() = 'administrator');

-- Roles / permissions: everyone reads, admins manage
create policy "Authenticated can read roles" on roles for select to authenticated using (true);
create policy "Admins manage roles" on roles for all to authenticated
  using (current_user_role() = 'administrator') with check (current_user_role() = 'administrator');

create policy "Authenticated can read permissions" on permissions for select to authenticated using (true);
create policy "Admins manage permissions" on permissions for all to authenticated
  using (current_user_role() = 'administrator') with check (current_user_role() = 'administrator');

create policy "Authenticated can read role_permissions" on role_permissions for select to authenticated using (true);
create policy "Admins manage role_permissions" on role_permissions for all to authenticated
  using (current_user_role() = 'administrator') with check (current_user_role() = 'administrator');

-- Generic staff-access policies for project-related tables
-- (Senior Developer / PM and Junior Developer may view; only Senior may write)

-- client_contacts
create policy "Staff can view client contacts" on client_contacts for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can manage client contacts" on client_contacts for all to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');

-- project_stage_history
create policy "Staff can view stage history" on project_stage_history for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can manage stage history" on project_stage_history for all to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');

-- discovery_records
create policy "Staff can view discovery" on discovery_records for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Staff can create discovery" on discovery_records for insert to authenticated
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can update discovery" on discovery_records for update to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');
create policy "Senior can delete discovery" on discovery_records for delete to authenticated
  using (current_user_role() = 'senior_dev_pm');

-- attachments
create policy "Staff can view attachments" on attachments for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Staff can upload attachments" on attachments for insert to authenticated
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can delete attachments" on attachments for delete to authenticated
  using (current_user_role() = 'senior_dev_pm');

-- requirements
create policy "Staff can view requirements" on requirements for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Staff can create requirements" on requirements for insert to authenticated
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can update requirements" on requirements for update to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');
create policy "Senior can delete requirements" on requirements for delete to authenticated
  using (current_user_role() = 'senior_dev_pm');

-- requirement_versions
create policy "Staff can view requirement versions" on requirement_versions for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Staff can create requirement versions" on requirement_versions for insert to authenticated
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));

-- documents
create policy "Staff can view documents" on documents for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Staff can create documents" on documents for insert to authenticated
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can update documents" on documents for update to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');
create policy "Senior can delete documents" on documents for delete to authenticated
  using (current_user_role() = 'senior_dev_pm');

-- document_revisions
create policy "Staff can view revisions" on document_revisions for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Staff can create revisions" on document_revisions for insert to authenticated
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));

-- reviews
create policy "Staff can view reviews" on reviews for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Staff can create reviews" on reviews for insert to authenticated
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));

-- approvals
create policy "Staff can view approvals" on approvals for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can create approvals" on approvals for insert to authenticated
  with check (current_user_role() = 'senior_dev_pm');

-- quotations
create policy "Staff can view quotations" on quotations for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can manage quotations" on quotations for all to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');

-- quotation_line_items
create policy "Staff can view quotation lines" on quotation_line_items for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can manage quotation lines" on quotation_line_items for all to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');

-- slas
create policy "Staff can view slas" on slas for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can manage slas" on slas for all to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');

-- purchase_orders
create policy "Staff can view purchase orders" on purchase_orders for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can manage purchase orders" on purchase_orders for all to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');

-- deposits
create policy "Staff can view deposits" on deposits for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can manage deposits" on deposits for all to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');

-- payment_confirmations
create policy "Staff can view payment confirmations" on payment_confirmations for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can confirm payments" on payment_confirmations for insert to authenticated
  with check (current_user_role() = 'senior_dev_pm');
create policy "Senior can manage payment confirmations" on payment_confirmations for update to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');

-- readiness_checks
create policy "Staff can view readiness checks" on readiness_checks for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior or system can run readiness" on readiness_checks for insert to authenticated
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));

-- readiness_items
create policy "Staff can view readiness items" on readiness_items for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can manage readiness items" on readiness_items for all to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');

-- assignments
create policy "Staff can view assignments" on assignments for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can manage assignments" on assignments for all to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');

-- handovers
create policy "Staff can view handovers" on handovers for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Staff can create handovers" on handovers for insert to authenticated
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can update handovers" on handovers for update to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');

-- development_links
create policy "Staff can view development links" on development_links for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Staff can record development links" on development_links for insert to authenticated
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Senior can verify development links" on development_links for update to authenticated
  using (current_user_role() = 'senior_dev_pm') with check (current_user_role() = 'senior_dev_pm');

-- ai_requests
create policy "Staff can view ai requests" on ai_requests for select to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'));
create policy "Staff can create ai requests" on ai_requests for insert to authenticated
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));

-- notifications
create policy "Users can view own notifications" on notifications for select to authenticated
  using (recipient_user_id = auth.uid() or current_user_role() = 'administrator');
create policy "System can create notifications" on notifications for insert to authenticated
  with check (true);
create policy "Users can mark own notifications read" on notifications for update to authenticated
  using (recipient_user_id = auth.uid()) with check (recipient_user_id = auth.uid());

-- audit_entries
create policy "Admins can view all audit entries" on audit_entries for select to authenticated
  using (current_user_role() = 'administrator');
create policy "Senior can view project audit entries" on audit_entries for select to authenticated
  using (current_user_role() = 'senior_dev_pm');
create policy "System can create audit entries" on audit_entries for insert to authenticated
  with check (true);
