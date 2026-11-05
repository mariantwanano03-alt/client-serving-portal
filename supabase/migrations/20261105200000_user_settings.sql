-- ==========================================================================
-- User Settings Table
-- Stores per-user theme preference and notification preferences.
-- ==========================================================================

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'system',
  email_on_approval boolean not null default true,
  email_on_stage_change boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.user_settings enable row level security;

-- Users can read their own settings
create policy "Users can read own settings"
  on public.user_settings for select
  to authenticated
  using (auth.uid() = user_id);

-- Users can insert their own settings
create policy "Users can insert own settings"
  on public.user_settings for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Users can update their own settings
create policy "Users can update own settings"
  on public.user_settings for update
  to authenticated
  using (auth.uid() = user_id);
