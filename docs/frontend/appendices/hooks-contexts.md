# Hooks and Contexts

All custom React hooks and context providers in the frontend.

---

## Contexts

### `ThemeContext`

**File:** `contexts/ThemeContext.tsx`

Manages light/dark theme across the app.

**Behaviour:**
- On first load, reads `prefers-color-scheme` from the OS.
- Persists the reviewer's manual preference to `localStorage` under `summarization_theme`.
- Applies the theme by toggling a `dark` class on `document.documentElement` (Tailwind dark mode convention).

**Exported hook:**

```typescript
const { theme, toggleTheme } = useTheme();
// theme: "light" | "dark"
// toggleTheme: () => void
```

**Used in:** Navigation bar theme toggle button, present in all pages.

---

## Custom hooks

### `useTemplates`

**File:** `hooks/useTemplates.ts`

Manages all CRUD operations and filtering for prompt templates.

**Returns:**

```typescript
{
  templates: Template[];
  loading: boolean;
  error: string | null;
  filters: TemplateFilters;
  setFilters: (filters: TemplateFilters) => void;
  fetchTemplates: () => Promise<void>;
  createTemplate: (data: CreateTemplateRequest) => Promise<Template>;
  updateTemplate: (id: string, data: UpdateTemplateRequest) => Promise<Template>;
  deleteTemplate: (id: string) => Promise<void>;
  forkTemplate: (id: string) => Promise<Template>;
  setImmutable: (id: string, immutable: boolean) => Promise<void>;
  changeScope: (id: string, scope: TemplateScope, groupId?: string) => Promise<void>;
}
```

**`TemplateFilters`:**

```typescript
interface TemplateFilters {
  scope?: "user" | "group" | "global";
  study_type?: string;
  search?: string;
  tags?: string[];
  folder_id?: string | null;
}
```

Filters are passed as query parameters to `GET /api/templates`. The hook re-fetches whenever `filters` changes.

---

### `useTemplateVersions`

**File:** `hooks/useTemplates.ts` (same file, separate export)

Manages version history for a single template.

**Parameters:** `templateId: string`

**Returns:**

```typescript
{
  versions: TemplateVersion[];
  loading: boolean;
  error: string | null;
  fetchVersions: () => Promise<void>;
  revertToVersion: (version: number) => Promise<Template>;
}
```

`revertToVersion` calls `POST /api/templates/{id}/revert/{version}`, which creates a new version with the old content (non-destructive).

---

### `useGroups`

**File:** `hooks/useGroups.ts`

Manages group CRUD and member management.

**Returns:**

```typescript
{
  groups: Group[];
  loading: boolean;
  error: string | null;
  fetchGroups: () => Promise<void>;
  createGroup: (name: string, description?: string) => Promise<Group>;
  updateGroup: (id: string, name: string, description?: string) => Promise<Group>;
  deleteGroup: (id: string) => Promise<void>;
  addMember: (groupId: string, userId: string, role: GroupRole) => Promise<Member>;
  updateMemberRole: (groupId: string, userId: string, role: GroupRole) => Promise<Member>;
  removeMember: (groupId: string, userId: string) => Promise<void>;
  searchUsers: (query: string) => Promise<UserSearchResult[]>;
}
```

Member data is cached per group ID after the first fetch. `fetchGroups` clears the cache.

---

### `useFolders`

**File:** `hooks/useFolders.ts`

Manages template folder CRUD.

**Returns:**

```typescript
{
  folders: Folder[];
  loading: boolean;
  error: string | null;
  fetchFolders: (scope?: string, groupId?: string) => Promise<void>;
  createFolder: (name: string, scope: string, parentId?: string, groupId?: string) => Promise<Folder>;
  renameFolder: (id: string, name: string) => Promise<Folder>;
  deleteFolder: (id: string) => Promise<void>;
  clearFolders: () => void;
}
```

---

### `useSimplifiedPipeline`

**File:** `hooks/useSimplifiedPipeline.ts`

Orchestrates the full end-to-end pipeline for the Simplified Flow and Executive Mode pages. Manages stage progression, batched entity extraction, error recovery, and result download.

**Returns:**

```typescript
{
  state: PipelineState;
  results: FileResult[];
  run: (
    files: File[],
    studyType: string,
    entities: Entity[],
    summaryPrompt: string,
    options?: PipelineOptions
  ) => Promise<void>;
  reset: () => void;
  downloadResults: () => void;
  downloadSingleResult: (filename: string) => void;
}
```

**`PipelineState`:**

```typescript
interface PipelineState {
  status: "idle" | "running" | "complete" | "error";
  fileStatuses: Map<string, {
    stage: "queued" | "uploading" | "processing" | "extracting" | "summarizing" | "exporting" | "complete" | "error";
    progress: number;         // 0–100 within current stage
    error?: string;
  }>;
}
```

**`PipelineOptions`:**

```typescript
interface PipelineOptions {
  parser?: string;            // "azure" | "docling" | "auto"
  temperature?: number;
  modelConfig?: ModelConfig;
  batchSize?: number;         // entities per extraction batch; default 5
}
```

**Batching behaviour:** Entity extraction runs `batchSize` entities concurrently per file. Multiple files also run concurrently (up to the backend's semaphore limit). The hook tracks per-file progress and updates `fileStatuses` after each batch completes.
