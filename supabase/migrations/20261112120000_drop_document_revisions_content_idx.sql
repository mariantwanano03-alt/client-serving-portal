-- Drop the btree index on document_revisions.content
-- Btree indexes on text columns have a maximum key size of ~8191 bytes.
-- AI-generated document content can exceed this limit, causing INSERT failures:
--   "index row requires 8200 bytes, maximum size is 8191"
-- Full-text search on content is not supported by btree anyway, so this
-- index provides no practical benefit and blocks large document generation.
DROP INDEX IF EXISTS document_revisions_content_idx;
