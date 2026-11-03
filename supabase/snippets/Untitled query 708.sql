-- 1. Unlink current revisions from all documents
UPDATE documents SET current_revision_id = NULL;

-- 2. Wipe Approvals & Revisions
DELETE FROM approvals;
DELETE FROM document_revisions;

-- 3. Wipe Documents
DELETE FROM documents;

-- 4. Wipe Discovery Records
DELETE FROM discovery_records;

-- 5. Wipe Requirements
DELETE FROM requirements;

-- 6. Wipe Commercials (Delete Confirmations FIRST, then Deposits)
DELETE FROM payment_confirmations;
DELETE FROM deposits;
DELETE FROM quotation_line_items;
DELETE FROM quotations;
DELETE FROM purchase_orders;

-- 7. Wipe Readiness & Handovers
DELETE FROM readiness_items;
DELETE FROM readiness_checks;
DELETE FROM handovers;
DELETE FROM development_links;

-- 8. Wipe Assignments & Audit Trails
DELETE FROM assignments;
DELETE FROM audit_entries;

-- 9. Wipe Projects and Clients
DELETE FROM projects;
DELETE FROM clients;