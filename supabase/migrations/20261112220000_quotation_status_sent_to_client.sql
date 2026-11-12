-- Add 'sent_to_client' as a valid quotation status
ALTER TABLE quotations
  ADD CONSTRAINT quotation_status_valid
  CHECK (status IN ('draft', 'submitted', 'approved', 'sent_to_client', 'rejected'));
