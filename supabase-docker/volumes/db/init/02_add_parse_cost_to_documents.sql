-- Migration: add parse_cost column to documents for per-file processing cost tracking
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS parse_cost DECIMAL;