-- ==========================================================================
-- TASK 5 — Outbox for Sister System integration
-- ==========================================================================
-- Queue of approved deliverables (Quotation / SLA) awaiting push to the
-- external "Sister System".

create table if not exists public.outbox_messages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  destination text not null default 'sister_system',
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.outbox_messages enable row level security;

drop policy if exists "Admins can manage outbox messages" on public.outbox_messages;
create policy "Admins can manage outbox messages"
  on public.outbox_messages for all
  to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

drop policy if exists "Senior can view outbox messages" on public.outbox_messages;
create policy "Senior can view outbox messages"
  on public.outbox_messages for select
  to authenticated
  using (public.current_user_role() = 'senior_dev_pm');
