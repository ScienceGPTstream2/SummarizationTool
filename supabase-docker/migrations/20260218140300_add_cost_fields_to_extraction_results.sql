-- Migration: add token usage and cost tracking columns to extraction_results
-- Converted from supabase-docker/volumes/db/init/03_add_cost_fields_to_extraction_results.sql
ALTER TABLE public.extraction_results
    ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS completion_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
    ADD COLUMN IF NOT EXISTS cost DECIMAL;
