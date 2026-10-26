-- Helper: the role of the person who is signed in
create function current_user_role()
returns user_role
language sql
security definer
set search_path = public
stable
as $$
  select role from profiles where id = auth.uid() and is_active
$$;

-- Senior Developer / PM and Junior Developer can view clients
create policy "Staff can view clients"
on clients for select
to authenticated
using (current_user_role() in ('senior_dev_pm', 'junior_developer'));

-- Only Senior Developer / PM can create clients
create policy "Senior can create clients"
on clients for insert
to authenticated
with check (current_user_role() = 'senior_dev_pm');

-- Only Senior Developer / PM can edit clients
create policy "Senior can edit clients"
on clients for update
to authenticated
using (current_user_role() = 'senior_dev_pm')
with check (current_user_role() = 'senior_dev_pm');