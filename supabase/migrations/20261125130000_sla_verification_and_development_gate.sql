-- ============================================================================
-- Client Serving Portal — verified SLA readiness and development gate
-- ============================================================================
-- No data is inserted by this migration. It hardens the sister-system table
-- and enforces the development gate at the database layer. The portal API
-- performs the same checks through lib/development-readiness.ts before it
-- attempts any stage change.

-- The sister system writes through service_role. Anonymous clients must never
-- be able to read or alter signed-document records directly.
drop policy if exists "anon_all_signed_documents" on signed_documents;

create or replace function public.development_readiness_satisfied(p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requirements boolean := false;
  v_commercial boolean := false;
  v_sla boolean := false;
  v_financial boolean := false;
begin
  select exists (
    select 1
    from documents
    where project_id = p_project_id
      and status = 'approved'
      and (
        type ilike '%requirement%'
        or upper(coalesce(type, '')) in ('PRD', 'SRS')
      )
  ) into v_requirements;

  select exists (
    select 1
    from documents
    where project_id = p_project_id
      and status = 'approved'
      and (type ilike '%quotation%' or type ilike '%proposal%')
  ) into v_commercial;

  with sla_documents as (
    select id
    from documents
    where project_id = p_project_id
      and (type ilike '%sla%' or type ilike '%service level agreement%')
  ),
  sla_revisions as (
    select dr.id
    from document_revisions dr
    where dr.document_id in (select id from sla_documents)
  ),
  candidates as (
    select
      sd.*,
      coalesce(sd.external_pulled_at, sd.updated_at, sd.created_at) as activity_at,
      regexp_replace(lower(trim(coalesce(sd.external_status, ''))), '[\s-]+', '_', 'g') as status_key
    from signed_documents sd
    where sd.project_id = p_project_id
      and (
        sd.source_document_id in (select id from sla_documents)
        or sd.revision_id in (select id from sla_revisions)
      )
  ),
  latest as (
    select *
    from candidates
    order by activity_at desc, coalesce(updated_at, created_at) desc
    limit 1
  )
  select count(*) > 0
     and bool_and(
       status_key in (
         'signed', 'completed', 'fully_signed', 'signature_complete',
         'signature_completed', 'agreement_signed', 'executed'
       )
       and external_pulled_at is not null
     )
  into v_sla
  from latest;

  with active_deposits as (
    select *
    from pts_deposit_overview
    where project_id = p_project_id
      and upper(coalesce(requirement_status, 'ACTIVE')) not in ('CANCELLED', 'VOID')
  ),
  purchase_orders_for_project as (
    select *
    from purchase_orders
    where project_id = p_project_id
  )
  select
    coalesce(bool_and(
      (
        lower(coalesce(status, '')) in ('confirmed', 'closed', 'paid', 'completed')
        or coalesce(outstanding_cents, 0) <= 0
      )
      and coalesce(awaiting_confirmation, false) = false
    ), true)
    and (
      not exists (select 1 from purchase_orders_for_project)
      or exists (
        select 1
        from purchase_orders_for_project
        where coalesce(amount, 0) > 0
      )
    )
  into v_financial
  from active_deposits;

  return v_requirements and v_commercial and v_sla and v_financial;
end;
$$;

-- The readiness function is used by trusted server code and by the trigger.
-- Anonymous and signed-in clients must not be able to call it directly.
revoke all on function public.development_readiness_satisfied(uuid) from public, anon, authenticated;
grant execute on function public.development_readiness_satisfied(uuid) to service_role;

create or replace function public.enforce_development_readiness()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(NEW.stage, '')) like '%development%'
     and (TG_OP = 'INSERT' or OLD.stage is distinct from NEW.stage)
     and not public.development_readiness_satisfied(NEW.id) then
    raise exception 'Development is locked until all mandatory prerequisites are complete.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_enforce_development_readiness on projects;
create trigger trg_enforce_development_readiness
  before insert or update of stage on projects
  for each row execute function public.enforce_development_readiness();
