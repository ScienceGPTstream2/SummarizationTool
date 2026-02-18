-- Migration: add page_count to documents for deterministic parse cost recompute
-- page_count is needed to recompute parse_cost when it is NULL on history reload.
-- The IF NOT EXISTS clause makes this idempotent (safe to run multiple times).

ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS page_count INTEGER;
