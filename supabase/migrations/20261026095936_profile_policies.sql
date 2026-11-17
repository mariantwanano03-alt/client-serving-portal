-- A signed-in user can read only their own profile row
create policy "Users can read their own profile"
on profiles for select
to authenticated
using (id = auth.uid());