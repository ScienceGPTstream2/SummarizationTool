-- ============================================
-- Migration: Session Sharing (Group-Scoped)
-- Description: Adds columns to sessions table for sharing sessions with user groups.
--              A session can be shared to one group at a time.
-- ============================================

-- Add sharing columns to the existing sessions table
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS shared_with_group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS shared_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ;

-- Index for efficient lookup of shared sessions by group
CREATE INDEX IF NOT EXISTS idx_sessions_shared_group ON public.sessions(shared_with_group_id)
    WHERE shared_with_group_id IS NOT NULL;

-- Index for looking up who shared what
CREATE INDEX IF NOT EXISTS idx_sessions_shared_by ON public.sessions(shared_by)
    WHERE shared_by IS NOT NULL;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON COLUMN public.sessions.shared_with_group_id IS 'The group this session is shared with. NULL means not shared.';
COMMENT ON COLUMN public.sessions.shared_by IS 'The user who shared this session.';
COMMENT ON COLUMN public.sessions.shared_at IS 'Timestamp of when the session was shared.';
