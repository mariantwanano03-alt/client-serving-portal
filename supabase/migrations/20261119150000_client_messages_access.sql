-- Client messages: make the existing support_tickets store usable as a
-- lightweight client -> developer conversation channel.
--
-- Design notes:
--   * Reuses `support_tickets`, which already stores real client-submitted text
--     tied to a project and client. No duplicate message table is created.
--   * Adds only the minimum columns needed for sender attribution, threading
--     and internal-vs-client messages.
--   * Reuses `attachments` (owner_type = 'support_ticket') for file attachments.
--   * Reuses `pts_user_scopes` for the existing client -> client/project scope.
--   * Senior = any project (matches the existing app model where seniors manage
--     all projects). Junior = only projects with an ACTIVE assignment.
--   * Clients see only their own, non-internal messages. Administrators are
--     deliberately excluded (oversight-only role).
--   * No UPDATE/DELETE policies: messages are append-only.

begin;

-- ---------------------------------------------------------------------------
-- 1. Guard the pre-existing client scope table (added outside repo migrations)
-- ---------------------------------------------------------------------------
create table if not exists public.pts_user_scopes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.pts_user_scopes enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Extend support_tickets into a conversation/message store
-- ---------------------------------------------------------------------------
alter table public.support_tickets
  add column if not exists sender_user_id uuid references public.profiles(id),
  add column if not exists sender_role text not null default 'client',
  add column if not exists thread_id uuid,
  add column if not exists is_internal boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- Every pre-existing ticket becomes its own conversation.
update public.support_tickets set thread_id = id where thread_id is null;
alter table public.support_tickets alter column thread_id set not null;

create index if not exists support_tickets_thread_idx on public.support_tickets(thread_id);
create index if not exists support_tickets_project_idx on public.support_tickets(project_id);
create index if not exists support_tickets_client_idx on public.support_tickets(client_id);

-- ---------------------------------------------------------------------------
-- 3. Per-user read receipts (unread counts / mark-as-read on conversation open)
-- ---------------------------------------------------------------------------
create table if not exists public.support_ticket_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, ticket_id)
);
alter table public.support_ticket_reads enable row level security;
grant select, insert, update, delete on public.support_ticket_reads to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reusable, SECURITY DEFINER access helpers (avoid RLS recursion)
-- ---------------------------------------------------------------------------
create or replace function public.can_access_message_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case public.current_user_role()
      when 'senior_dev_pm' then true
      when 'junior_developer' then exists (
        select 1 from public.assignments a
        where a.project_id = p_project_id
          and a.developer_user_id = auth.uid()
          and coalesce(a.is_active, true)
      )
      else false
    end,
    false
  );
$$;

create or replace function public.client_can_access_message(p_client_id uuid, p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'client', false)
    and exists (
      select 1 from public.pts_user_scopes s
      where s.user_id = auth.uid()
        and (s.client_id = p_client_id or s.project_id = p_project_id)
    );
$$;

revoke all on function public.can_access_message_project(uuid) from public;
grant execute on function public.can_access_message_project(uuid) to authenticated;
revoke all on function public.client_can_access_message(uuid, uuid) from public;
grant execute on function public.client_can_access_message(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS policies on support_tickets (append-only; no UPDATE/DELETE)
-- ---------------------------------------------------------------------------
alter table public.support_tickets enable row level security;

drop policy if exists "Staff can view project messages" on public.support_tickets;
create policy "Staff can view project messages"
  on public.support_tickets for select to authenticated
  using (
    public.current_user_role() in ('senior_dev_pm', 'junior_developer')
    and public.can_access_message_project(project_id)
  );

drop policy if exists "Clients can view own messages" on public.support_tickets;
create policy "Clients can view own messages"
  on public.support_tickets for select to authenticated
  using (
    public.current_user_role() = 'client'
    and not is_internal
    and public.client_can_access_message(client_id, project_id)
  );

drop policy if exists "Clients can send messages" on public.support_tickets;
create policy "Clients can send messages"
  on public.support_tickets for insert to authenticated
  with check (
    public.current_user_role() = 'client'
    and not is_internal
    and coalesce(sender_user_id, auth.uid()) = auth.uid()
    and public.client_can_access_message(client_id, project_id)
  );

drop policy if exists "Staff can send project messages" on public.support_tickets;
create policy "Staff can send project messages"
  on public.support_tickets for insert to authenticated
  with check (
    public.current_user_role() in ('senior_dev_pm', 'junior_developer')
    and public.can_access_message_project(project_id)
    and sender_user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- 6. RLS on read receipts: own rows only, and only for messages they can see.
--    The subquery respects support_tickets SELECT RLS, so a junior cannot mark
--    an unassigned project's messages as read.
-- ---------------------------------------------------------------------------
drop policy if exists "Users manage own message receipts" on public.support_ticket_reads;
create policy "Users manage own message receipts"
  on public.support_ticket_reads for all to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.support_tickets t where t.id = ticket_id)
  )
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.support_tickets t where t.id = ticket_id)
  );

commit;
