-- ==========================================================================
-- Client primary contact auto-sync
-- Adding, editing or removing a Client Contact keeps the client-level
-- "Primary Contact", "Email" and "Phone" fields in sync.
--
-- Semantics (sticky primary):
--   * The contact currently acting as primary keeps that role while it
--     still exists, so adding more contacts never silently reassigns it.
--   * When the current primary contact is removed, the earliest-added
--     remaining contact is promoted.
--   * When no contacts remain, the stale primary name is cleared (the
--     client-level email/phone keep their current values).
--   * The primary contact's email/phone fill the client-level fields
--     only where those do not already carry a value.
-- ==========================================================================

create or replace function public.sync_client_primary_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_current_name text;
  v_first_contact record;
  v_primary_contact record;
begin
  if tg_op = 'DELETE' then
    v_client_id := old.client_id;
  else
    v_client_id := new.client_id;
  end if;

  select primary_contact
    into v_current_name
    from public.clients
   where id = v_client_id;

  select name, email, phone
    into v_first_contact
    from public.client_contacts
   where client_id = v_client_id
   order by created_at asc, id asc
   limit 1;

  -- Keep the current primary contact while it still exists.
  if v_current_name is not null and v_first_contact.name is not null then
    select name, email, phone
      into v_primary_contact
      from public.client_contacts
     where client_id = v_client_id
       and name = v_current_name
     order by created_at asc, id asc
     limit 1;

    if not found then
      -- Primary was removed (or renamed): promote the earliest contact.
      v_primary_contact := v_first_contact;
    end if;
  else
    v_primary_contact := v_first_contact;
  end if;

  update public.clients
     set primary_contact = v_primary_contact.name,
         email = coalesce(v_primary_contact.email, clients.email),
         phone = coalesce(v_primary_contact.phone, clients.phone)
   where id = v_client_id;

  -- No contacts at all: clear the stale primary contact name.
  if v_first_contact.name is null then
    update public.clients
       set primary_contact = null
     where id = v_client_id;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_client_primary_contact_sync on public.client_contacts;
create trigger trg_client_primary_contact_sync
after insert or update or delete on public.client_contacts
for each row execute function public.sync_client_primary_contact();

-- Backfill (two passes):
--   Pass 1 keeps a client's existing primary contact if it still matches a
--   contact row; Pass 2 promotes the earliest contact where it does not.
with chosen as (
  select c.id as client_id, k.name, k.email, k.phone
    from public.clients c
    join lateral (
      select name, email, phone
        from public.client_contacts contacts
       where contacts.client_id = c.id
         and contacts.name = c.primary_contact
       order by contacts.created_at asc, contacts.id asc
       limit 1
    ) k on true
   where c.primary_contact is not null
)
update public.clients c
   set primary_contact = k.name,
       email = coalesce(k.email, c.email),
       phone = coalesce(k.phone, c.phone)
  from chosen k
 where c.id = k.client_id;

with earliest as (
  select c.id as client_id, e.name, e.email, e.phone
    from public.clients c
    join lateral (
      select name, email, phone
        from public.client_contacts contacts
       where contacts.client_id = c.id
       order by contacts.created_at asc, contacts.id asc
       limit 1
    ) e on true
)
update public.clients c
   set primary_contact = e.name,
       email = coalesce(e.email, c.email),
       phone = coalesce(e.phone, c.phone)
  from earliest e
 where c.id = e.client_id
   and (c.primary_contact is null
        or not exists (
          select 1 from public.client_contacts k
           where k.client_id = c.id and k.name = c.primary_contact
        ));
