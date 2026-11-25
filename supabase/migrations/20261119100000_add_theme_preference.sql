-- Add theme_preference column to profiles table
-- This stores user's light/dark theme preference for persistence across sessions

alter table profiles
  add column if not exists theme_preference text not null default 'light'
    check (theme_preference in ('light', 'dark'));

-- Update existing profiles to have the default theme preference
update profiles set theme_preference = 'light' where theme_preference is null;

-- Allow each signed-in user to persist their own theme preference.
drop policy if exists "Users can update own theme preference" on profiles;
create policy "Users can update own theme preference"
  on profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
