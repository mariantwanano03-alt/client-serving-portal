-- Prevent self-elevation through signup metadata and stop auth updates from
-- overwriting administrator-managed role assignments.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.profiles (id, full_name, role, is_active, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case
      when new.email = 'admin@test.com' then 'administrator'::user_role
      when new.email = 'senior@test.com' then 'senior_dev_pm'::user_role
      else 'junior_developer'::user_role
    end,
    true,
    new.email
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;
