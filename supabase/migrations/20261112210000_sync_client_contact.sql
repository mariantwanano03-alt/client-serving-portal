-- Sync client email/phone from newly inserted contacts
CREATE OR REPLACE FUNCTION sync_client_primary_contact()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE clients
  SET
    email = COALESCE(NULLIF(email, ''), NEW.email),
    phone = COALESCE(NULLIF(phone, ''), NEW.phone)
  WHERE id = NEW.client_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_client_contact ON client_contacts;
CREATE TRIGGER trigger_sync_client_contact
AFTER INSERT ON client_contacts
FOR EACH ROW
EXECUTE FUNCTION sync_client_primary_contact();
