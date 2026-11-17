-- Senior Developer / PM and Junior Developer can view projects
create policy "Staff can view projects"
on projects for select
to authenticated
using (current_user_role() in ('senior_dev_pm', 'junior_developer'));

-- Only Senior Developer / PM can create projects
create policy "Senior can create projects"
on projects for insert
to authenticated
with check (current_user_role() = 'senior_dev_pm');

-- Only Senior Developer / PM can edit projects
create policy "Senior can edit projects"
on projects for update
to authenticated
using (current_user_role() = 'senior_dev_pm')
with check (current_user_role() = 'senior_dev_pm');