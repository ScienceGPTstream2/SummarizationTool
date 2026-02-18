-- Migration: add token usage and cost tracking columns to extraction_results
-- These columns exist in init_app_schema.sql but were not present when the DB
-- was first initialized. This migration adds them to the live database.
-- The IF NOT EXISTS clause makes this idempotent (safe to run multiple times).

ALTER TABLE public.extraction_results
    ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS completion_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
    ADD COLUMN IF NOT EXISTS cost DECIMAL;
