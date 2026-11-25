-- The three roles from the SRS
create type user_role as enum ('administrator', 'senior_dev_pm', 'junior_developer');

-- One profile per signed-in user, linked to Supabase's built-in users
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role user_role not null default 'junior_developer',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Clients, each with a unique code
create table clients (
  id uuid primary key default gen_random_uuid(),
  client_code text not null unique,
  name text not null,
  email text,
  phone text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Projects, each belonging to one client with a unique reference
create table projects (
  id uuid primary key default gen_random_uuid(),
  project_reference text not null unique,
  client_id uuid not null references clients(id),
  name text not null,
  stage text not null default 'create_project',
  status text not null default 'draft',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Allow all authenticated users to insert clients
create policy "Allow authenticated insert clients"
  on clients for insert
  to authenticated
  with check (true);

-- Allow all authenticated users to insert projects
create policy "Allow authenticated insert projects"
  on projects for insert
  to authenticated
  with check (true);

-- Lock the tables down until we add access rules for each role
alter table profiles enable row level security;
alter table clients enable row level security;
alter table projects enable row level security;