-- Supabase Storage Schema for SummarizationTool
-- This migration creates tables for global file deduplication and user-specific data

-- 1. Global files table (hash-based deduplication)
-- Files are stored globally - same file uploaded by different users points to same entry
CREATE TABLE IF NOT EXISTS public.global_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_hash VARCHAR(64) UNIQUE NOT NULL,  -- SHA-256 hash for deduplication
    original_filename TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) DEFAULT 'application/pdf',
    storage_path TEXT NOT NULL,  -- Local path to the file
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Processing info (nullable until processed)
    conversion_id UUID,
    processor_used VARCHAR(50),  -- 'azure_doc_intelligence' or 'docling'
    processed_at TIMESTAMPTZ,
    markdown_path TEXT,  -- Path to processed markdown
    metadata JSONB DEFAULT '{}'  -- Additional processing metadata
);

-- 2. User-file associations (junction table)
-- Tracks which users have access to which files
CREATE TABLE IF NOT EXISTS public.user_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES public.global_files(id) ON DELETE CASCADE,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
    nickname TEXT,  -- Optional user-defined name for the file
    notes TEXT,  -- Optional user notes about the file
    
    UNIQUE(user_id, file_id)
);

-- 3. User prompts table
-- Stores user's custom prompts for extraction/summarization
CREATE TABLE IF NOT EXISTS public.user_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    prompt_type VARCHAR(50) NOT NULL,  -- 'extraction', 'summary', 'paragraph_generator', etc.
    content TEXT NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. User preferences/settings
-- Stores user-specific settings and preferences
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    default_processor VARCHAR(50) DEFAULT 'azure_doc_intelligence',
    default_llm_model VARCHAR(100),
    preferences JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_global_files_hash ON public.global_files(file_hash);
CREATE INDEX IF NOT EXISTS idx_global_files_conversion ON public.global_files(conversion_id);
CREATE INDEX IF NOT EXISTS idx_user_files_user ON public.user_files(user_id);
CREATE INDEX IF NOT EXISTS idx_user_files_file ON public.user_files(file_id);
CREATE INDEX IF NOT EXISTS idx_user_prompts_user ON public.user_prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_prompts_type ON public.user_prompts(user_id, prompt_type);

-- Enable Row Level Security (RLS) for all tables
ALTER TABLE public.global_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- global_files: Anyone can read, but only service_role can insert/update
CREATE POLICY "Anyone can read global files" ON public.global_files
    FOR SELECT USING (true);

CREATE POLICY "Service role can manage global files" ON public.global_files
    FOR ALL USING (auth.role() = 'service_role');

-- user_files: Users can only see their own file associations
CREATE POLICY "Users can view own file associations" ON public.user_files
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own file associations" ON public.user_files
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own file associations" ON public.user_files
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own file associations" ON public.user_files
    FOR DELETE USING (auth.uid() = user_id);

-- user_prompts: Users can only manage their own prompts
CREATE POLICY "Users can view own prompts" ON public.user_prompts
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own prompts" ON public.user_prompts
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own prompts" ON public.user_prompts
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own prompts" ON public.user_prompts
    FOR DELETE USING (auth.uid() = user_id);

-- user_settings: Users can only manage their own settings
CREATE POLICY "Users can view own settings" ON public.user_settings
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings" ON public.user_settings
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings" ON public.user_settings
    FOR UPDATE USING (auth.uid() = user_id);

-- Service role bypass for all tables (for backend operations)
CREATE POLICY "Service role bypass global_files" ON public.global_files
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role bypass user_files" ON public.user_files
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role bypass user_prompts" ON public.user_prompts
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role bypass user_settings" ON public.user_settings
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Grant necessary permissions
GRANT ALL ON public.global_files TO authenticated;
GRANT ALL ON public.user_files TO authenticated;
GRANT ALL ON public.user_prompts TO authenticated;
GRANT ALL ON public.user_settings TO authenticated;

GRANT ALL ON public.global_files TO service_role;
GRANT ALL ON public.user_files TO service_role;
GRANT ALL ON public.user_prompts TO service_role;
GRANT ALL ON public.user_settings TO service_role;
