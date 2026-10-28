-- --------------------------------------------------------------------------
-- Preserve the audit meaning of payment confirmations created before the
-- external webhook existed. They were recorded by a signed-in user, not by a
-- payment provider, so they must not be presented as system-verified payments.
-- --------------------------------------------------------------------------

update public.payment_confirmations
   set actor_type = 'legacy_manual',
       actor_label = coalesce(actor_label, 'legacy_manual_confirmation'),
       verified_at = created_at
 where provider is null
   and external_reference is null
   and confirmed_by is not null
   and actor_type = 'system';
