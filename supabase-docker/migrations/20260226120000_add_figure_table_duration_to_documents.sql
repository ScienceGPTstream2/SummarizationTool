-- Add figure_count, table_count, and parse_duration_seconds to the documents table.
-- These fields are populated by the document processing pipeline (Docling / Azure DI)
-- and are used to produce the per-document section of the session metrics xlsx export.
-- They persist across session restores so the data is always available for reporting.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS figure_count           INTEGER,
  ADD COLUMN IF NOT EXISTS table_count            INTEGER,
  ADD COLUMN IF NOT EXISTS parse_duration_seconds FLOAT;
