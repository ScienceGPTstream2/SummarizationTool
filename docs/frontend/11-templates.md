# Template Workspace

> *Templates are reusable sets of entity definitions and prompts. Instead of manually re-entering the same 20 extraction fields every time, a reviewer saves them as a template once and loads it in seconds on the Study Config page. The Template Workspace is where those templates are created, edited, versioned, and shared — either privately, with a group, or globally across all users.*

**Files:** `components/TemplateWorkspace/TemplateWorkspacePage.tsx`, `TemplateList.tsx`, `TemplateEditor.tsx`, `TemplateVersionHistory.tsx`, `FolderCard.tsx`

**Hook:** `hooks/useTemplates.ts`, `hooks/useFolders.ts`

---

## 1. UI sections

| Section | Purpose |
|---|---|
| Folder sidebar | Hierarchical folder tree for organising templates |
| Template list | Filterable list of templates with scope badges (personal / group / global) |
| Search + filters | Filter by study type, scope, tags, or free-text name search |
| Template editor | Form: name, description, study type, entities, system prompt, summary prompt, tags |
| Entity list editor | Add, reorder, and edit entity name + prompt within a template |
| Version history panel | Timestamped list of previous versions with a Revert button |
| Fork button | Copy any accessible template to your personal scope |
| Scope selector | Change template visibility: personal → group → global |
| Immutable toggle | Lock a template against further edits (admin/owner only) |
| Permission editor | Grant explicit read/edit access to specific users |

---

## 2. Template scopes

| Scope | Who can see it | Who can edit it |
|---|---|---|
| `user` (personal) | Owner only | Owner only |
| `group` | All members of the linked group | Group admins and owner |
| `global` | All users | System admins only |

Built-in study type templates (toxicology, epidemiology) are `global` and `immutable` — they can be read and forked but not edited.

---

## 3. Creating and editing a template

```
Reviewer clicks "New Template"
  │
  ▼
TemplateEditor opens (blank form)
  │
  ▼
Reviewer fills in name, study type, entities, prompts
  │
  ▼
POST /api/templates
  Body: { name, study_type, scope, entities, system_prompt, summary_prompt, tags }
  Returns: Template
  │
  ▼
Template appears in list under "My Templates"
```

Editing an existing template:

```
Reviewer clicks "Edit" on a template
  │
  ▼
TemplateEditor opens with current values
  │
  ▼
Reviewer makes changes + saves
  │
  ▼
PUT /api/templates/{id}
  │
  ▼
Backend saves a TemplateVersion snapshot of the previous content
  Template.version increments
```

Every save creates a version snapshot automatically — the reviewer never has to manually checkpoint.

---

## 4. Version history and revert

```
Reviewer opens version history panel
  │
  ▼
GET /api/templates/{id}/versions
  Returns: [{ version, created_at, entities, system_prompt, ... }]
  │
  ▼
Reviewer clicks "Revert to v3"
  │
  ▼
POST /api/templates/{id}/revert/3
  │
  ▼
Backend creates a new version (v5) with v3's content
  (reverting does not delete the intermediate versions)
```

---

## 5. Forking a template

Forking creates a personal copy of any template the reviewer can see, regardless of scope.

```
POST /api/templates/{id}/fork
  Returns: new Template with scope="user", owner=reviewer
```

The fork is independent — changes to the fork do not affect the original, and vice versa.

---

## 6. Folder organisation

Templates can be placed in folders. Folders are scoped the same way as templates (user / group / global) and can be nested.

```
GET /api/templates/folders?scope=user
POST /api/templates/folders  →  create folder
PATCH /api/templates/folders/{id}  →  rename
DELETE /api/templates/folders/{id}  →  delete (only if empty)
```

Dragging a template into a folder calls `PUT /api/templates/{id}` with the updated `folder_id`.

---

## 7. State (via `useTemplates` hook)

```typescript
const {
  templates,          // Template[] — current filtered list
  loading,
  error,
  filters,            // { scope, study_type, search, tags }
  setFilters,
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  forkTemplate,
  setImmutable,
  changeScope,
} = useTemplates();
```

The hook fetches templates on mount and re-fetches after any mutation. Filtering happens server-side via query parameters.

---

## 8. API calls

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/templates` | List accessible templates |
| `POST` | `/api/templates` | Create template |
| `GET` | `/api/templates/{id}` | Fetch one template |
| `PUT` | `/api/templates/{id}` | Update template (creates version snapshot) |
| `DELETE` | `/api/templates/{id}` | Delete template |
| `POST` | `/api/templates/{id}/fork` | Fork to personal scope |
| `PUT` | `/api/templates/{id}/scope` | Change scope |
| `PUT` | `/api/templates/{id}/immutable` | Set immutability |
| `GET` | `/api/templates/{id}/versions` | Version history |
| `POST` | `/api/templates/{id}/revert/{v}` | Revert to version |
| `GET/POST` | `/api/templates/folders` | List / create folders |
| `PATCH` | `/api/templates/folders/{id}` | Rename folder |
| `DELETE` | `/api/templates/folders/{id}` | Delete folder |
