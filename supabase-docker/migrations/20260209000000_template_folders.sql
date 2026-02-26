-- ============================================
-- TEMPLATE FOLDERS
-- ============================================
-- Adds a hierarchical folder structure for organizing templates
-- across all three scopes (user, group, global).

-- Folder table
CREATE TABLE IF NOT EXISTS public.template_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,

    -- Which scope this folder lives in
    scope TEXT NOT NULL CHECK (scope IN ('user', 'group', 'global')),

    -- Ownership mirrors prompt_templates ownership rules
    owner_user_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    owner_group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,

    -- NULL = root-level; non-NULL = subfolder of parent_id
    parent_id UUID REFERENCES public.template_folders(id) ON DELETE CASCADE,

    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_folder_scope_owner CHECK (
        (scope = 'user'   AND owner_user_id IS NOT NULL AND owner_group_id IS NULL) OR
        (scope = 'group'  AND owner_group_id IS NOT NULL) OR
        (scope = 'global' AND owner_user_id IS NULL AND owner_group_id IS NULL)
    )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_template_folders_scope       ON public.template_folders(scope);
CREATE INDEX IF NOT EXISTS idx_template_folders_parent      ON public.template_folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_template_folders_owner_user  ON public.template_folders(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_template_folders_owner_group ON public.template_folders(owner_group_id);

-- Add folder_id to existing prompt_templates
ALTER TABLE public.prompt_templates
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.template_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prompt_templates_folder ON public.prompt_templates(folder_id);
