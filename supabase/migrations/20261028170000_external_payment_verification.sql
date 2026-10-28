-- --------------------------------------------------------------------------
-- Phase 3: External payment verification
--
-- Payments are no longer confirmed by a manual in-app button. A signed
-- accounting / payment-gateway webhook calls public.record_verified_payment()
-- with the service role. The function records the confirmation, marks the
-- deposit paid, and writes a system audit entry in one transaction.
-- --------------------------------------------------------------------------

-- External reference IDs let the webhook match a payment to a milestone even
-- when the sender does not know the internal deposit UUID.
alter table public.deposits
  add column if not exists external_reference text,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by_provider text;

alter table public.payment_confirmations
  add column if not exists provider text,
  add column if not exists external_reference text,
  add column if not exists external_event_id text,
  add column if not exists actor_type text not null default 'system',
  add column if not exists actor_label text,
  add column if not exists verified_at timestamptz not null default now(),
  add column if not exists payload jsonb;

-- Idempotency: one confirmation per provider event and per external reference.
create unique index if not exists payment_confirmations_provider_event_key
  on public.payment_confirmations (provider, external_event_id)
  where provider is not null and external_event_id is not null;

create unique index if not exists payment_confirmations_provider_reference_key
  on public.payment_confirmations (provider, external_reference)
  where provider is not null and external_reference is not null;

create unique index if not exists deposits_project_external_reference_key
  on public.deposits (project_id, external_reference)
  where external_reference is not null;

-- Authenticated users may read confirmations, but only the service role may
-- write them. Drop every legacy write policy so no developer can fake a
-- payment confirmation from the browser.
drop policy if exists "Senior can confirm payments" on public.payment_confirmations;
drop policy if exists "Senior can manage payment confirmations" on public.payment_confirmations;
drop policy if exists "Project approvers can manage payment confirmations" on public.payment_confirmations;

-- Keep the read paths explicit and idempotent.
drop policy if exists "Staff can view payment confirmations" on public.payment_confirmations;
create policy "Staff can view payment confirmations"
  on public.payment_confirmations for select to authenticated
  using (public.is_administrator() or public.can_approve_project(project_id));

drop policy if exists "Assigned developers can view payment confirmations" on public.payment_confirmations;
create policy "Assigned developers can view payment confirmations"
  on public.payment_confirmations for select to authenticated
  using (
    exists (
      select 1
      from public.assignments a
      where a.project_id = payment_confirmations.project_id
        and a.developer_user_id = auth.uid()
        and a.is_active
    )
  );

-- --------------------------------------------------------------------------
-- Atomic, idempotent payment recording. Executable only by the service role
-- (the webhook route), never by an authenticated browser session.
-- --------------------------------------------------------------------------
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

  -- Replaying the same provider event is a no-op.
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

  -- Replaying the same external reference under a different event id is also
  -- a no-op: the money has already been recorded.
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

  -- Resolve and lock the deposit. Senders may pass the internal deposit UUID
  -- or rely on the external reference stored on the milestone.
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

comment on function public.record_verified_payment(
  text, text, text, uuid, uuid, numeric, text, date, jsonb
) is 'Records an externally verified payment, marks its deposit paid, and writes a system audit entry. Service role only.';
