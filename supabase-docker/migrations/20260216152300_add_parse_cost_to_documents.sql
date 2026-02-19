-- Migration: add parse_cost column to documents for per-file processing cost tracking
-- Converted from supabase-docker/volumes/db/init/02_add_parse_cost_to_documents.sql
ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS parse_cost DECIMAL;
