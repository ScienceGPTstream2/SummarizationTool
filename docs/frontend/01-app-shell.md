# App Shell

> *`App.tsx` is the spine of the entire frontend. It owns all workflow state, controls which page is visible, persists sessions across browser reloads, and guards against accidental navigation away from in-progress work. Every page component is a child of App.tsx — pages read their inputs from it and report their outputs back to it via callbacks.*

## 1. Overview

`App.tsx` (~2100 lines) does four things:

1. **Owns `DocumentData`** — the single object that accumulates everything a reviewer has done in a session: uploaded files, processing results, entity configs, extraction results, evaluation results.
2. **Controls navigation** — a `currentStep` string determines which page renders. There is no URL router; the browser address bar does not change between steps.
3. **Persists state** — saves `currentStep` and `sessionId` to `localStorage` so a reload restores where the reviewer left off.
4. **Guards navigation** — prevents accidental navigation away from a step with in-flight API calls or unsaved results.

---

## 2. The `DocumentData` interface

`DocumentData` is the central data structure. It is passed as a prop to every page and updated via the `onComplete()` callback pattern.

```typescript
interface DocumentData {
  // --- Upload step ---
  file: File | null;                    // Primary uploaded file (single-file path)
  fileId?: string;                      // SHA-256 hash of the primary file
  uploadResult?: any;                   // Raw response from POST /api/upload
  parser: string;                       // Selected processor: "azure" | "docling" | "auto"
  uploadedFiles?: UploadedFile[];       // All uploaded files (multi-file path)

  // --- Processing step ---
  extractedText: string;                // Processed markdown from primary file
  annotatedOutput: string;              // Enhanced markdown (with figure summaries injected)

  // --- Study config step ---
  studyType: string;                    // "toxicology" | "epidemiology" | "custom"
  summaryPrompt?: string;               // System prompt for paragraph summary generation
  selectedModel: string;                // Primary model identifier
  selectedModels?: string[];            // All selected models (multi-model extraction)
  temperature?: number;                 // Model temperature setting
  entities: Entity[];                   // Entity definitions + their extraction results

  // --- Extraction step (populated per entity) ---
  // Entity.extracted, Entity.answer, Entity.references,
  // Entity.extractionsByModel, Entity.duration, etc.
  // See Entity interface in appendices/types-interfaces.md

  // --- Session ---
  sessionId?: string;                   // ID of the saved AppSession in the DB

  // --- Config ---
  filesConfig?: FilesConfig;            // Per-file parser and model settings
  evaluationConfig?: EvaluationConfig;  // Evaluation metric and model settings
}
```

`UploadedFile` extends the single-file fields to support multi-document sessions. Each entry carries its own `fileId`, `extractedText`, `entities`, and so on.

---

## 3. Routing and navigation

### Step identifiers

Navigation is driven by a `currentStep` string, not a URL path. The full set:

| Step ID | Page rendered | Role |
|---|---|---|
| `login` | `LoginPage` | Auth entry point |
| `auth_callback` | `AuthCallback` | OAuth redirect handler |
| `upload` | `UploadPage` | Workflow step 1 |
| `processing` | `ProcessingPage` | Workflow step 2 |
| `study_selection` | `BatchStudySelectionPage` | Workflow step 3 |
| `extraction` | `EntityExtractionPage` | Workflow step 4 |
| `evaluation` | `EvaluationPage` | Workflow step 5 |
| `simplified` | `SimplifiedFlowPage` | One-click pipeline |
| `chat` | `ChatPage` | Document Q&A |
| `executive` | `ExecutiveModePage` | Executive summary |
| `history` | `SessionHistoryPage` | Session browser |
| `templates` | `TemplateWorkspacePage` | Template manager |
| `groups` | `GroupManagementPage` | Group manager |

### Tool overlay navigation

Tool overlays (`chat`, `executive`, `history`, `templates`, `groups`) can be opened from any workflow step. When the reviewer enters an overlay, App.tsx saves the current step in `previousWorkflowStep`. The overlay's Back button calls `setCurrentStep(previousWorkflowStep)` to return exactly where they were.

### Completed steps

App.tsx derives a `completedSteps` set from the contents of `DocumentData`:

- `upload` is complete when `documentData.uploadedFiles` or `documentData.fileId` is populated.
- `processing` is complete when `documentData.extractedText` is non-empty.
- `study_selection` is complete when `documentData.entities` has at least one entry.
- `extraction` is complete when any entity has an `extracted` or `answer` value.
- `evaluation` is complete when any entity has `evaluationResults`.

Reviewers can only navigate forward to the next step or backward to a completed step. Skipping ahead is blocked.

---

## 4. The `onComplete()` callback pattern

Pages do not write to global state directly. Instead, each page receives an `onComplete` prop:

```typescript
// Example: UploadPage reports its results back to App.tsx
onComplete: (updates: Partial<DocumentData>) => void
```

When a page finishes its work, it calls `onComplete({ uploadedFiles: [...], parser: "azure" })`. App.tsx merges this into `documentData` with a shallow merge (top-level keys only) and advances `currentStep` to the next step.

Pages also receive:

| Prop | Type | Purpose |
|---|---|---|
| `documentData` | `DocumentData` | Read-only access to current workflow state |
| `onComplete` | `(updates) => void` | Report results and advance to next step |
| `onInvalidateDownstream` | `(fromStep) => void` | Mark later steps as stale |
| `onInFlightChange` | `(bool) => void` | Signal that an API call is in progress (blocks navigation) |
| `onNavigate` | `(step) => void` | Navigate to a specific step (used by overlays) |

---

## 5. Downstream invalidation

When a reviewer modifies an early step — for example, re-uploading a file on the Upload page — the work done in later steps may no longer be valid. App.tsx tracks this with a `staleDownstream` flag.

When `onInvalidateDownstream("processing")` is called:
- `extractedText`, `annotatedOutput`, entities, extraction results, and evaluation results are cleared from `documentData`.
- The user sees a visual banner: "Results invalidated — re-run to update."
- Navigation to downstream steps is still permitted (for inspection), but the stale indicator makes clear the results are outdated.

---

## 6. Session persistence

On every meaningful state change, App.tsx writes two values to `localStorage`:

```
summarization_current_step   →  "extraction"
summarization_session_id     →  "abc123"
```

On app load, if both values are present:

1. App.tsx calls `GET /api/sessions/{sessionId}/restore-view`.
2. The response re-hydrates `documentData` with the full session state.
3. `currentStep` is restored to the saved step.
4. The reviewer continues exactly where they left off.

If the restore call fails (session deleted, token expired), App.tsx clears localStorage and starts a fresh session at `upload`.

---

## 7. Navigation guards

Two guards prevent accidental data loss:

**In-flight guard** (`onInFlightChange`): When a page signals that an API call is in progress, App.tsx disables the step navigation bar. Clicking another step shows a confirmation dialog: "An extraction is in progress. Leave anyway?"

**Unsaved changes guard** (`rerunConfirm`): When a reviewer tries to navigate backward from a step with results (e.g., going back from Extraction to Study Config), App.tsx shows: "Going back will clear your extraction results. Continue?" The reviewer must confirm before the state is cleared.

---

## 8. Authentication flow in App.tsx

On mount, App.tsx calls `getSession()` from `authUtils.ts`. If no session exists, it redirects to `login`. If a session exists, it fetches user info and proceeds to restore state from localStorage or start at `upload`.

The session check is non-blocking — the app renders a loading spinner while `getSession()` is in flight and never flashes unauthenticated content to the user.
