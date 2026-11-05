-- ==========================================================================
-- Add external_reference and provider columns to payment_confirmations
-- for Sister System webhook integration
-- ==========================================================================

alter table public.payment_confirmations
  add column if not exists external_reference text,
  add column if not exists provider text;
