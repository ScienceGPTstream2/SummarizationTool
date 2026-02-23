-- Migration: add page_count to documents for deterministic parse cost recompute
-- Converted from supabase-docker/volumes/db/init/04_add_page_count_to_documents.sql
ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS page_count INTEGER;
