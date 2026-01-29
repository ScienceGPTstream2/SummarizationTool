#!/bin/bash
#
# Supabase Docker Setup Script for SummarizationTool
#
# This script sets up the Supabase volumes directory on a fresh VM.
# Run this ONCE before the first `docker compose up`.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "SummarizationTool - Supabase Setup Script"
echo "============================================"
echo ""

# Check if volumes already exists with data
if [ -d "./volumes/db/data" ]; then
    echo "WARNING: volumes/db/data already exists!"
    echo "This suggests Supabase has already been initialized."
    echo "If you want to reset, run: ./reset.sh"
    exit 1
fi

# Step 1: Download Supabase Docker volumes from official repo
echo "===> Step 1: Downloading Supabase Docker volumes..."

SUPABASE_VERSION="master"  # Or pin to a specific tag like "v1.24.0"
TEMP_DIR=$(mktemp -d)

echo "Cloning Supabase docker directory (sparse checkout)..."
cd "$TEMP_DIR"
git init -q
git remote add origin https://github.com/supabase/supabase.git
git config core.sparseCheckout true
echo "docker/volumes/" >> .git/info/sparse-checkout
git pull --depth=1 origin "$SUPABASE_VERSION" -q

# Copy volumes to our project
echo "Copying Supabase volumes..."
cp -r docker/volumes/* "$SCRIPT_DIR/volumes/"

# Cleanup temp directory
cd "$SCRIPT_DIR"
rm -rf "$TEMP_DIR"

echo "✓ Supabase volumes downloaded"

# Step 2: Copy the app schema file
echo ""
echo "===> Step 2: Setting up application schema..."

# Create the app schema file
cat > ./volumes/db/init_app_schema.sql << 'EOSQL'
-- ============================================
-- SummarizationTool Application Schema
-- Run this after Supabase is up and running
-- ============================================

-- User preferences and settings
CREATE TABLE IF NOT EXISTS public.user_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    default_models TEXT[] DEFAULT '{}',
    default_temperature DECIMAL DEFAULT 0.0,
    default_study_type TEXT,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Custom prompt templates (user-customized versions)
CREATE TABLE IF NOT EXISTS public.user_prompt_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    study_type TEXT,
    entity_name TEXT NOT NULL,
    prompt_content TEXT NOT NULL,
    system_prompt TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name, entity_name)
);

-- Sessions (groups of work)
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT DEFAULT 'Untitled Session',
    status TEXT DEFAULT 'in_progress' CHECK (status IN ('draft', 'in_progress', 'completed')),
    last_step TEXT DEFAULT 'upload',
    configuration JSONB DEFAULT '{}',
    evaluation_config JSONB DEFAULT '{}',
    files_config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Documents (per-file tracking)
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- File identification
    file_hash TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT,
    
    -- Processing info
    processor_used TEXT CHECK (processor_used IS NULL OR processor_used IN ('docling', 'azure_doc_intelligence')),
    processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'error')),
    processing_error TEXT,
    processed_at TIMESTAMPTZ,
    
    -- Study type (per document)
    study_type TEXT,
    
    -- Paths to extracted content (stored on filesystem)
    extracted_text_path TEXT,
    annotated_output_path TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Extraction results (files × models)
CREATE TABLE IF NOT EXISTS public.extraction_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
    entity_name TEXT NOT NULL,
    model_id TEXT NOT NULL,
    extracted_text TEXT,
    bbox_references JSONB,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'error')),
    error_message TEXT,
    extracted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(document_id, entity_name, model_id)
);

-- Evaluation results (per extraction, per metric, per judge)
CREATE TABLE IF NOT EXISTS public.evaluation_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    extraction_result_id UUID REFERENCES public.extraction_results(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    judge_model TEXT,
    score DECIMAL,
    reasoning TEXT,
    human_score DECIMAL,
    ground_truth TEXT,
    evaluated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(extraction_result_id, metric, judge_model)
);

-- ============================================
-- Indexes for common queries
-- ============================================
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON public.sessions(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_session_id ON public.documents(session_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_file_hash ON public.documents(file_hash);

CREATE INDEX IF NOT EXISTS idx_extraction_results_session_id ON public.extraction_results(session_id);
CREATE INDEX IF NOT EXISTS idx_extraction_results_document_id ON public.extraction_results(document_id);
CREATE INDEX IF NOT EXISTS idx_extraction_results_model_id ON public.extraction_results(model_id);

CREATE INDEX IF NOT EXISTS idx_evaluation_results_extraction_id ON public.evaluation_results(extraction_result_id);

CREATE INDEX IF NOT EXISTS idx_user_prompt_templates_user_id ON public.user_prompt_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_user_prompt_templates_study_type ON public.user_prompt_templates(study_type);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_results ENABLE ROW LEVEL SECURITY;

-- Users can only access their own data
CREATE POLICY "Users can manage own preferences" ON public.user_preferences
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own templates" ON public.user_prompt_templates
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own sessions" ON public.sessions
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own documents" ON public.documents
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own extractions" ON public.extraction_results
    FOR ALL USING (
        session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid())
    );

CREATE POLICY "Users can manage own evaluations" ON public.evaluation_results
    FOR ALL USING (
        extraction_result_id IN (
            SELECT er.id FROM public.extraction_results er
            JOIN public.sessions s ON er.session_id = s.id
            WHERE s.user_id = auth.uid()
        )
    );

-- ============================================
-- Auto-update timestamps
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON public.user_preferences;
CREATE TRIGGER update_user_preferences_updated_at
    BEFORE UPDATE ON public.user_preferences
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_prompt_templates_updated_at ON public.user_prompt_templates;
CREATE TRIGGER update_user_prompt_templates_updated_at
    BEFORE UPDATE ON public.user_prompt_templates
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_sessions_updated_at ON public.sessions;
CREATE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_documents_updated_at ON public.documents;
CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EOSQL

echo "✓ Application schema created"

# Step 3: Setup .env file
echo ""
echo "===> Step 3: Setting up environment file..."

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "✓ Copied .env.example to .env"
        echo ""
        echo "IMPORTANT: Edit .env to set your secrets!"
        echo "  - Generate new JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY"
        echo "  - Set POSTGRES_PASSWORD"
        echo "  - Configure SITE_URL and API_EXTERNAL_URL"
    else
        echo "WARNING: No .env.example found. You need to create .env manually."
    fi
else
    echo "✓ .env already exists"
fi

# Step 4: Instructions
echo ""
echo "============================================"
echo "Setup Complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Edit .env file with your secrets (if not already done)"
echo ""
echo "2. Start Supabase:"
echo "   docker compose up -d"
echo ""
echo "3. Wait for all services to be healthy (about 30-60 seconds):"
echo "   docker compose ps"
echo ""
echo "4. Apply the application schema:"
echo "   docker exec -i supabase-db psql -U postgres -d postgres < ./volumes/db/init_app_schema.sql"
echo ""
echo "5. Access Supabase Studio:"
echo "   http://localhost:8000 (or your configured KONG_HTTP_PORT)"
echo ""
echo "============================================"
