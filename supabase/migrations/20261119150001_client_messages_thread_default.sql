-- Allow newly inserted messages to omit thread_id; a fresh conversation is
-- created automatically. Replies can pass an explicit thread_id to join one.
begin;

alter table public.support_tickets
  alter column thread_id set default gen_random_uuid();

commit;
