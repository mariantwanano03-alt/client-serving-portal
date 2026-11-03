-- 1. Unlink the current revision from the document so it can be deleted
UPDATE documents
SET current_revision_id = NULL
WHERE title LIKE 'AI Generated Quotation%' 
   OR title LIKE 'Quotation - %';

-- 2. Now delete the revisions
DELETE FROM document_revisions 
WHERE document_id IN (
  SELECT id FROM documents 
  WHERE title LIKE 'AI Generated Quotation%' 
     OR title LIKE 'Quotation - %'
);

-- 3. Finally, delete the document itself
DELETE FROM documents 
WHERE title LIKE 'AI Generated Quotation%' 
   OR title LIKE 'Quotation - %';