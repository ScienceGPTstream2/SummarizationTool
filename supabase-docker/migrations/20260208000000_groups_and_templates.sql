-- ============================================
-- Migration: Groups and Prompt Templates Workspace
-- Version: 002
-- Description: Adds groups, memberships, enhanced templates with versioning and permissions
-- ============================================

-- ============================================
-- GROUPS AND MEMBERSHIPS
-- ============================================

-- Groups table
CREATE TABLE IF NOT EXISTS public.groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User-group membership with roles
-- Roles: viewer (read-only), member (read+write), admin (manage members), owner (full control)
CREATE TABLE IF NOT EXISTS public.user_groups (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member' CHECK (role IN ('viewer', 'member', 'admin', 'owner')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, group_id)
);

-- ============================================
-- PROMPT TEMPLATES
-- ============================================

-- Enhanced prompt templates with scope, versioning, and immutability
CREATE TABLE IF NOT EXISTS public.prompt_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    study_type TEXT,
    
    -- Scope and ownership
    -- 'user': owned by individual, 'group': shared with group, 'global': system-wide
    scope TEXT NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'group', 'global')),
    owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    owner_group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    
    -- Template content (current version)
    system_prompt TEXT,
    entities JSONB NOT NULL DEFAULT '[]',  -- Array of {name, prompt} objects
    summary_prompt TEXT,
    variables JSONB DEFAULT '[]',  -- Array of {name, description, default} for placeholders
    
    -- Immutability control: if true, users must fork instead of edit
    is_immutable BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    tags TEXT[] DEFAULT '{}',
    is_default BOOLEAN DEFAULT FALSE,
    version INTEGER DEFAULT 1,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Scope validation constraints
    CONSTRAINT valid_scope_owner CHECK (
        (scope = 'user' AND owner_user_id IS NOT NULL AND owner_group_id IS NULL) OR
        (scope = 'group' AND owner_group_id IS NOT NULL) OR
        (scope = 'global' AND owner_user_id IS NULL AND owner_group_id IS NULL)
    )
);

-- ============================================
-- VERSION HISTORY
-- ============================================

-- Stores snapshots of template content for each version
CREATE TABLE IF NOT EXISTS public.template_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID REFERENCES public.prompt_templates(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    
    -- Snapshot of template content at this version
    system_prompt TEXT,
    entities JSONB NOT NULL,
    summary_prompt TEXT,
    variables JSONB,
    
    -- Audit information
    changed_by UUID REFERENCES auth.users(id),
    change_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(template_id, version)
);

-- ============================================
-- GRANULAR PERMISSIONS
-- ============================================

-- Per-user permission overrides for templates
-- Allows admins/owners to grant or revoke access for specific users
CREATE TABLE IF NOT EXISTS public.template_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID REFERENCES public.prompt_templates(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    can_read BOOLEAN DEFAULT TRUE,
    can_write BOOLEAN DEFAULT FALSE,
    granted_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(template_id, user_id)
);

-- ============================================
-- INDEXES
-- ============================================

-- Groups indexes
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON public.groups(created_by);
CREATE INDEX IF NOT EXISTS idx_groups_name ON public.groups(name);

-- User groups indexes
CREATE INDEX IF NOT EXISTS idx_user_groups_user_id ON public.user_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_user_groups_group_id ON public.user_groups(group_id);

-- Prompt templates indexes
CREATE INDEX IF NOT EXISTS idx_prompt_templates_scope ON public.prompt_templates(scope);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_owner_user ON public.prompt_templates(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_owner_group ON public.prompt_templates(owner_group_id);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_study_type ON public.prompt_templates(study_type);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_tags ON public.prompt_templates USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_created_by ON public.prompt_templates(created_by);

-- Template versions indexes
CREATE INDEX IF NOT EXISTS idx_template_versions_template_id ON public.template_versions(template_id);
CREATE INDEX IF NOT EXISTS idx_template_versions_version ON public.template_versions(template_id, version);

-- Template permissions indexes
CREATE INDEX IF NOT EXISTS idx_template_permissions_template ON public.template_permissions(template_id);
CREATE INDEX IF NOT EXISTS idx_template_permissions_user ON public.template_permissions(user_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_permissions ENABLE ROW LEVEL SECURITY;

-- Groups: members can view, admins/owners can modify
DROP POLICY IF EXISTS "Users can view groups they belong to" ON public.groups;
CREATE POLICY "Users can view groups they belong to" ON public.groups
    FOR SELECT USING (
        id IN (SELECT group_id FROM public.user_groups WHERE user_id = auth.uid())
        OR created_by = auth.uid()
    );

DROP POLICY IF EXISTS "Users can create groups" ON public.groups;
CREATE POLICY "Users can create groups" ON public.groups
    FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Group admins can update groups" ON public.groups;
CREATE POLICY "Group admins can update groups" ON public.groups
    FOR UPDATE USING (
        id IN (SELECT group_id FROM public.user_groups 
               WHERE user_id = auth.uid() AND role IN ('admin', 'owner'))
    );

DROP POLICY IF EXISTS "Group owners can delete groups" ON public.groups;
CREATE POLICY "Group owners can delete groups" ON public.groups
    FOR DELETE USING (
        id IN (SELECT group_id FROM public.user_groups 
               WHERE user_id = auth.uid() AND role = 'owner')
    );

-- User groups: visible to members, manageable by admins
DROP POLICY IF EXISTS "Users can view group memberships" ON public.user_groups;
CREATE POLICY "Users can view group memberships" ON public.user_groups
    FOR SELECT USING (
        user_id = auth.uid() 
        OR group_id IN (SELECT group_id FROM public.user_groups WHERE user_id = auth.uid())
    );

DROP POLICY IF EXISTS "Group admins can manage memberships" ON public.user_groups;
CREATE POLICY "Group admins can manage memberships" ON public.user_groups
    FOR ALL USING (
        group_id IN (SELECT group_id FROM public.user_groups 
                     WHERE user_id = auth.uid() AND role IN ('admin', 'owner'))
    );

-- Templates: complex visibility with permission overrides
DROP POLICY IF EXISTS "Users can view accessible templates" ON public.prompt_templates;
CREATE POLICY "Users can view accessible templates" ON public.prompt_templates
    FOR SELECT USING (
        -- Global templates visible to all
        scope = 'global' 
        -- User's own templates
        OR (scope = 'user' AND owner_user_id = auth.uid())
        -- Group templates for group members
        OR (scope = 'group' AND owner_group_id IN (
            SELECT group_id FROM public.user_groups WHERE user_id = auth.uid()
        ))
        -- Per-user read permission override
        OR id IN (
            SELECT template_id FROM public.template_permissions 
            WHERE user_id = auth.uid() AND can_read = TRUE
        )
    );

DROP POLICY IF EXISTS "Users can create templates" ON public.prompt_templates;
CREATE POLICY "Users can create templates" ON public.prompt_templates
    FOR INSERT WITH CHECK (
        created_by = auth.uid()
        AND (
            (scope = 'user' AND owner_user_id = auth.uid())
            OR (scope = 'group' AND owner_group_id IN (
                SELECT group_id FROM public.user_groups 
                WHERE user_id = auth.uid() AND role IN ('member', 'admin', 'owner')
            ))
        )
    );

DROP POLICY IF EXISTS "Users can update templates they have access to" ON public.prompt_templates;
CREATE POLICY "Users can update templates they have access to" ON public.prompt_templates
    FOR UPDATE USING (
        -- Cannot update immutable templates
        is_immutable = FALSE
        AND (
            -- User's own templates
            (scope = 'user' AND owner_user_id = auth.uid())
            -- Group templates for members
            OR (scope = 'group' AND owner_group_id IN (
                SELECT group_id FROM public.user_groups 
                WHERE user_id = auth.uid() AND role IN ('member', 'admin', 'owner')
            ))
            -- Per-user write permission override
            OR id IN (
                SELECT template_id FROM public.template_permissions 
                WHERE user_id = auth.uid() AND can_write = TRUE
            )
        )
    );

DROP POLICY IF EXISTS "Template owners can delete" ON public.prompt_templates;
CREATE POLICY "Template owners can delete" ON public.prompt_templates
    FOR DELETE USING (
        (scope = 'user' AND owner_user_id = auth.uid())
        OR (scope = 'group' AND owner_group_id IN (
            SELECT group_id FROM public.user_groups 
            WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
        ))
    );

-- Template versions: same visibility as parent template
DROP POLICY IF EXISTS "Users can view template versions" ON public.template_versions;
CREATE POLICY "Users can view template versions" ON public.template_versions
    FOR SELECT USING (
        template_id IN (SELECT id FROM public.prompt_templates)
    );

DROP POLICY IF EXISTS "Users can create template versions" ON public.template_versions;
CREATE POLICY "Users can create template versions" ON public.template_versions
    FOR INSERT WITH CHECK (
        changed_by = auth.uid()
        AND template_id IN (
            SELECT id FROM public.prompt_templates 
            WHERE is_immutable = FALSE
        )
    );

-- Template permissions: manageable by template owners
DROP POLICY IF EXISTS "Users can view template permissions" ON public.template_permissions;
CREATE POLICY "Users can view template permissions" ON public.template_permissions
    FOR SELECT USING (
        user_id = auth.uid()
        OR granted_by = auth.uid()
        OR template_id IN (
            SELECT id FROM public.prompt_templates WHERE owner_user_id = auth.uid()
        )
        OR template_id IN (
            SELECT id FROM public.prompt_templates WHERE owner_group_id IN (
                SELECT group_id FROM public.user_groups 
                WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
            )
        )
    );

DROP POLICY IF EXISTS "Template owners can manage permissions" ON public.template_permissions;
CREATE POLICY "Template owners can manage permissions" ON public.template_permissions
    FOR ALL USING (
        granted_by = auth.uid()
        OR template_id IN (
            SELECT id FROM public.prompt_templates WHERE owner_user_id = auth.uid()
        )
        OR template_id IN (
            SELECT id FROM public.prompt_templates WHERE owner_group_id IN (
                SELECT group_id FROM public.user_groups 
                WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
            )
        )
    );

-- ============================================
-- AUTO-UPDATE TIMESTAMPS
-- ============================================

-- Trigger function (reuse if exists from init_app_schema.sql)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Groups timestamp trigger
DROP TRIGGER IF EXISTS update_groups_updated_at ON public.groups;
CREATE TRIGGER update_groups_updated_at
    BEFORE UPDATE ON public.groups
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Prompt templates timestamp trigger
DROP TRIGGER IF EXISTS update_prompt_templates_updated_at ON public.prompt_templates;
CREATE TRIGGER update_prompt_templates_updated_at
    BEFORE UPDATE ON public.prompt_templates
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to check if user can edit a template
CREATE OR REPLACE FUNCTION public.can_edit_template(template_id UUID, user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    template RECORD;
    membership RECORD;
    permission RECORD;
BEGIN
    -- Get template
    SELECT * INTO template FROM public.prompt_templates WHERE id = template_id;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    
    -- Check immutability
    IF template.is_immutable THEN RETURN FALSE; END IF;
    
    -- Check per-user override (explicit deny)
    SELECT * INTO permission FROM public.template_permissions 
    WHERE template_permissions.template_id = can_edit_template.template_id 
    AND template_permissions.user_id = can_edit_template.user_id;
    IF FOUND AND permission.can_write = FALSE THEN RETURN FALSE; END IF;
    IF FOUND AND permission.can_write = TRUE THEN RETURN TRUE; END IF;
    
    -- Check scope-based permissions
    IF template.scope = 'user' THEN
        RETURN template.owner_user_id = user_id;
    ELSIF template.scope = 'group' THEN
        SELECT * INTO membership FROM public.user_groups 
        WHERE user_groups.group_id = template.owner_group_id 
        AND user_groups.user_id = can_edit_template.user_id;
        RETURN FOUND AND membership.role IN ('member', 'admin', 'owner');
    ELSIF template.scope = 'global' THEN
        RETURN FALSE;  -- Global templates are admin-only (via service role)
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create a new version when template is updated
CREATE OR REPLACE FUNCTION public.create_template_version()
RETURNS TRIGGER AS $$
BEGIN
    -- Only create version if content changed
    IF OLD.entities IS DISTINCT FROM NEW.entities 
       OR OLD.system_prompt IS DISTINCT FROM NEW.system_prompt
       OR OLD.summary_prompt IS DISTINCT FROM NEW.summary_prompt
       OR OLD.variables IS DISTINCT FROM NEW.variables THEN
        
        -- Increment version
        NEW.version := OLD.version + 1;
        
        -- Store the old version
        INSERT INTO public.template_versions (
            template_id, version, system_prompt, entities, 
            summary_prompt, variables, changed_by
        ) VALUES (
            OLD.id, OLD.version, OLD.system_prompt, OLD.entities,
            OLD.summary_prompt, OLD.variables, auth.uid()
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create versions
DROP TRIGGER IF EXISTS create_template_version_trigger ON public.prompt_templates;
CREATE TRIGGER create_template_version_trigger
    BEFORE UPDATE ON public.prompt_templates
    FOR EACH ROW EXECUTE FUNCTION public.create_template_version();

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

-- Grant access to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prompt_templates TO authenticated;
GRANT SELECT, INSERT ON public.template_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_permissions TO authenticated;

-- Grant access to anon for reading global templates
GRANT SELECT ON public.prompt_templates TO anon;

-- Service role has full access (bypasses RLS)
GRANT ALL ON public.groups TO service_role;
GRANT ALL ON public.user_groups TO service_role;
GRANT ALL ON public.prompt_templates TO service_role;
GRANT ALL ON public.template_versions TO service_role;
GRANT ALL ON public.template_permissions TO service_role;
