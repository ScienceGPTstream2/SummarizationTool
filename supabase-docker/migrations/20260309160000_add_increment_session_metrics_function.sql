-- Migration: Add atomic session metrics increment function
-- Replaces read-then-write pattern (2 queries) with a single UPDATE.
-- Prevents lost updates when many concurrent extraction calls all increment
-- the same session's cost/latency/calls simultaneously.

CREATE OR REPLACE FUNCTION public.increment_session_metrics(
    p_session_id UUID,
    p_cost NUMERIC DEFAULT 0,
    p_latency NUMERIC DEFAULT 0
)
RETURNS VOID AS $$
BEGIN
    UPDATE public.sessions
    SET
        total_cost    = COALESCE(total_cost, 0)    + p_cost,
        total_latency = COALESCE(total_latency, 0) + p_latency,
        total_calls   = COALESCE(total_calls, 0)   + 1
    WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
