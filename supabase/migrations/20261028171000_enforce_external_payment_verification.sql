-- --------------------------------------------------------------------------
-- Phase 3 hardening: browser sessions cannot mark a deposit paid directly.
-- Only public.record_verified_payment() (service role / webhook) may perform
-- the paid transition, using a transaction-local flag that PostgREST clients
-- cannot set themselves.
-- --------------------------------------------------------------------------

create or replace function public.enforce_external_payment_verification()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'paid'
     and old.status is distinct from 'paid'
     and coalesce(current_setting('app.external_payment_verification', true), '') <> 'on'
  then
    raise exception 'payment_status_requires_external_verification'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_external_payment_verification on public.deposits;
create trigger enforce_external_payment_verification
  before update of status on public.deposits
  for each row
  execute function public.enforce_external_payment_verification();

-- Re-create the recording function with the trusted transaction flag set for
-- the paid transition. The function remains executable by service_role only.
create or replace function public.record_verified_payment(
  p_provider text,
  p_event_id text,
  p_external_reference text,
  p_project_id uuid,
  p_deposit_id uuid,
  p_amount numeric,
  p_currency text,
  p_payment_date date,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deposit public.deposits;
  v_existing public.payment_confirmations;
  v_confirmation_id uuid;
begin
  if p_provider is null or length(trim(p_provider)) = 0 then
    raise exception 'provider_required' using errcode = '22023';
  end if;

  if p_event_id is null or length(trim(p_event_id)) = 0 then
    raise exception 'event_id_required' using errcode = '22023';
  end if;

  if p_external_reference is null or length(trim(p_external_reference)) = 0 then
    raise exception 'external_reference_required' using errcode = '22023';
  end if;

  if p_project_id is null then
    raise exception 'project_id_required' using errcode = '22023';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  if p_currency is null or length(trim(p_currency)) <> 3 then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;

  select *
    into v_existing
    from public.payment_confirmations
   where provider = p_provider
     and external_event_id = p_event_id
   limit 1;

  if found then
    return jsonb_build_object(
      'status', 'duplicate',
      'confirmation_id', v_existing.id,
      'deposit_id', v_existing.deposit_id
    );
  end if;

  select *
    into v_existing
    from public.payment_confirmations
   where provider = p_provider
     and external_reference = p_external_reference
   limit 1;

  if found then
    return jsonb_build_object(
      'status', 'duplicate',
      'confirmation_id', v_existing.id,
      'deposit_id', v_existing.deposit_id
    );
  end if;

  if p_deposit_id is not null then
    select *
      into v_deposit
      from public.deposits
     where id = p_deposit_id
     for update;
  else
    select *
      into v_deposit
      from public.deposits
     where project_id = p_project_id
       and external_reference = p_external_reference
     for update;
  end if;

  if not found then
    raise exception 'deposit_not_found' using errcode = 'P0002';
  end if;

  if v_deposit.project_id <> p_project_id then
    raise exception 'deposit_project_mismatch' using errcode = '22023';
  end if;

  begin
    insert into public.payment_confirmations (
      project_id,
      deposit_id,
      amount,
      payment_date,
      reference,
      confirmed_by,
      provider,
      external_reference,
      external_event_id,
      actor_type,
      actor_label,
      verified_at,
      payload
    )
    values (
      p_project_id,
      v_deposit.id,
      p_amount,
      p_payment_date,
      p_external_reference,
      null,
      p_provider,
      p_external_reference,
      p_event_id,
      'system',
      p_provider,
      now(),
      coalesce(p_payload, '{}'::jsonb)
    )
    returning id into v_confirmation_id;
  exception when unique_violation then
    select *
      into v_existing
      from public.payment_confirmations
     where provider = p_provider
       and (
         external_event_id = p_event_id
         or external_reference = p_external_reference
       )
     limit 1;

    return jsonb_build_object(
      'status', 'duplicate',
      'confirmation_id', v_existing.id,
      'deposit_id', v_existing.deposit_id
    );
  end;

  perform set_config('app.external_payment_verification', 'on', true);

  update public.deposits
     set status = 'paid',
         external_reference = coalesce(public.deposits.external_reference, p_external_reference),
         verified_at = now(),
         verified_by_provider = p_provider
   where id = v_deposit.id;

  insert into public.audit_entries (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    after_value
  )
  values (
    null,
    'payment.externally_verified',
    'payment_confirmation',
    v_confirmation_id,
    jsonb_build_object(
      'provider', p_provider,
      'event_id', p_event_id,
      'external_reference', p_external_reference,
      'amount', p_amount,
      'currency', p_currency,
      'project_id', p_project_id,
      'deposit_id', v_deposit.id,
      'actor_type', 'system'
    )
  );

  return jsonb_build_object(
    'status', 'recorded',
    'confirmation_id', v_confirmation_id,
    'deposit_id', v_deposit.id
  );
end;
$$;

revoke all on function public.record_verified_payment(
  text, text, text, uuid, uuid, numeric, text, date, jsonb
) from public;
revoke all on function public.record_verified_payment(
  text, text, text, uuid, uuid, numeric, text, date, jsonb
) from anon;
revoke all on function public.record_verified_payment(
  text, text, text, uuid, uuid, numeric, text, date, jsonb
) from authenticated;
grant execute on function public.record_verified_payment(
  text, text, text, uuid, uuid, numeric, text, date, jsonb
) to service_role;
