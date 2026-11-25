-- Restore legitimate staff document writes that were removed together with the
-- broad "authenticated" policies. AI-generated documents are inserted as
-- approved; only the senior approval step applies to manually edited content.
-- Administrators remain read-only.

begin;

drop policy if exists "Staff can create approved documents" on public.documents;
create policy "Staff can create approved documents"
  on public.documents for insert to authenticated
  with check (
    current_user_role() in ('senior_dev_pm', 'junior_developer')
    and status = 'approved'
  );

drop policy if exists "Staff can update documents" on public.documents;
create policy "Staff can update documents"
  on public.documents for update to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'))
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));

drop policy if exists "Staff can create approved revisions" on public.document_revisions;
create policy "Staff can create approved revisions"
  on public.document_revisions for insert to authenticated
  with check (
    current_user_role() in ('senior_dev_pm', 'junior_developer')
    and status = 'approved'
  );

drop policy if exists "Staff can update revisions" on public.document_revisions;
create policy "Staff can update revisions"
  on public.document_revisions for update to authenticated
  using (current_user_role() in ('senior_dev_pm', 'junior_developer'))
  with check (current_user_role() in ('senior_dev_pm', 'junior_developer'));

commit;
