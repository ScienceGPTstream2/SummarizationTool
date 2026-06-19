# Science-GPT Frontend Technical Design

This directory documents the frontend of the Science-GPT Summarization Tool — a React single-page application that guides scientific reviewers through document upload, AI-powered entity extraction, and quality evaluation.

Read this page first for orientation, then follow the numbered module docs for detail on each page or feature area.

---

## Visual workflow map

The app has two entry paths: a **step-by-step advanced workflow** (the primary path) and a **simplified one-click flow** for users who want to skip the manual steps.

**Advanced workflow (linear):**

```
[Login] → [Upload] → [Processing] → [Study Config] → [Extraction] → [Evaluation]
   02          03           04              05               06             07
```

**Tool overlays (accessible from any step):**

```
[Chat]   [Session History]   [Templates]   [Groups]   [Executive Mode]   [Batch Results]
  09            10               11            12             13               14
```

Tool overlays remember the previous workflow step — clicking Back returns the reviewer to where they were.

**Visual architecture diagrams** are in [`../images/`](../images/).

---

## Tech stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Framework | React | 18.2.0 | UI rendering |
| Language | TypeScript | 5.2.2 | Type safety |
| Build tool | Vite | 5.1.4 | Dev server and production builds |
| Styling | Tailwind CSS | 3.4.1 | Utility-first CSS |
| Components | shadcn/ui (Radix UI) | — | Base UI components (buttons, dialogs, tables, etc.) |
| Auth | Better Auth | 1.5.6 | GitHub OAuth session management |
| PDF rendering | pdfjs-dist | 5.4.394 | In-browser PDF display with bounding box overlays |
| Word export | docx + markdown-docx | 9.5.1 / 1.5.1 | Export results as Word documents |
| Excel export | exceljs + xlsx | 4.4.0 / 0.18.5 | Export results as Excel workbooks |
| Charts | Recharts | 2.12.0 | Evaluation result visualizations |
| Animation | Framer Motion | 12.23.24 | Page and component transitions |
| Markdown | React Markdown + remark-gfm | 10.1.0 | Render LLM markdown responses |
| Notifications | Sonner | 1.4.0 | Toast messages |
| Telemetry | OpenTelemetry (OTLP) | — | Browser-side distributed tracing |

No external state management library (no Redux, Zustand, etc.). All state lives in `App.tsx` and local component state. See [01-app-shell.md](01-app-shell.md) for how that works.

---

## Page map

| # | Step / Page | Component file | Workflow role |
|---|---|---|---|
| — | App shell | `App.tsx` | Central state container and router |
| — | Login | `components/LoginPage.tsx` | Auth entry point |
| — | Auth callback | `components/AuthCallback.tsx` | OAuth redirect handler |
| 03 | Upload | `components/UploadPage.tsx` | Workflow step 1 — upload files, choose parser |
| 04 | Processing | `components/ProcessingPage.tsx` | Workflow step 2 — parse PDFs into text/figures/tables |
| 05 | Study config | `components/BatchStudySelectionPage.tsx` | Workflow step 3 — select study type, configure entities |
| 06 | Extraction | `components/EntityExtractionPage.tsx` | Workflow step 4 — run entity extraction with LLMs |
| 07 | Evaluation | `components/EvaluationPage.tsx` | Workflow step 5 — score extraction quality with G-Eval |
| 08 | Simplified flow | `components/SimplifiedFlowPage.tsx` | One-click end-to-end pipeline |
| 09 | Chat | `components/ChatPage.tsx` | Freeform document Q&A |
| 10 | Session history | `components/SessionHistoryPage.tsx` | Browse, restore, share previous sessions |
| 11 | Templates | `components/TemplateWorkspace/TemplateWorkspacePage.tsx` | Create and manage extraction template libraries |
| 12 | Groups | `components/GroupManagement/GroupManagementPage.tsx` | Create and manage user groups for sharing |
| 13 | Executive mode | `components/ExecutiveModePage.tsx` | Standalone executive summary generation |
| 14 | Batch results | `components/BatchResultsPage.tsx` | Tabular view of all results across files |

---

## Architecture overview

### State management

The app uses a single top-level state object called `DocumentData` in `App.tsx`. Every page reads from it on mount and reports updates back via an `onComplete()` callback. There is no global store or context for workflow state — it flows through props.

See [01-app-shell.md](01-app-shell.md) for the full `DocumentData` interface and callback pattern.

### Navigation

Navigation is controlled by a `currentStep` string in `App.tsx`, not a URL router. Clicking "Next" calls `setCurrentStep()` directly. The browser URL does not change between workflow steps.

### Authentication

Every API call uses `authenticatedFetch()` from `utils/authUtils.ts`, which automatically attaches a `Authorization: Bearer {token}` header and retries once on 401. Sessions are established via GitHub OAuth through the Better Auth sidecar.

See [02-auth.md](02-auth.md) for the full auth flow.

### Session persistence

When a reviewer closes the browser mid-workflow, the app saves `currentStep` and `sessionId` to `localStorage` and auto-restores on next load by calling `/api/sessions/{id}/restore-view`.

---

## Directory structure

```
frontend/
├── App.tsx                              Main routing + central state (~2100 lines)
├── main.tsx                             React entry point
├── index.html                           HTML template
├── vite.config.ts                       Build config
├── tailwind.config.js                   Tailwind config
├── package.json                         Dependencies
│
├── components/                          All React components
│   ├── LoginPage.tsx
│   ├── AuthCallback.tsx
│   ├── UploadPage.tsx
│   ├── ProcessingPage.tsx
│   ├── BatchStudySelectionPage.tsx
│   ├── EntityExtractionPage.tsx         (~4300 lines, largest component)
│   ├── EvaluationPage.tsx               (~5000 lines)
│   ├── SimplifiedFlowPage.tsx
│   ├── ChatPage.tsx
│   ├── SessionHistoryPage.tsx
│   ├── ExecutiveModePage.tsx
│   ├── BatchResultsPage.tsx
│   ├── TemplateWorkspace/
│   │   ├── TemplateWorkspacePage.tsx
│   │   ├── TemplateList.tsx
│   │   ├── TemplateEditor.tsx
│   │   ├── TemplateVersionHistory.tsx
│   │   └── FolderCard.tsx
│   ├── GroupManagement/
│   │   └── GroupManagementPage.tsx
│   └── ui/                              shadcn/ui base components (50+)
│
├── hooks/                               Custom React hooks
│   ├── useTemplates.ts
│   ├── useGroups.ts
│   ├── useFolders.ts
│   └── useSimplifiedPipeline.ts
│
├── contexts/
│   └── ThemeContext.tsx                 Light/dark theme
│
├── utils/
│   ├── authUtils.ts                     Auth, token management, authenticated fetch
│   ├── session.ts                       Session ID tracking
│   ├── modelSelection.ts               Model picker logic
│   ├── wordExport.ts                    Word document generation
│   ├── excelExport.ts                   Excel export
│   └── executiveSummaryExport.ts        Executive summary export
│
└── types/
    └── session.ts                       Shared TypeScript types
```

---

## Module docs

| Document | What it covers |
|---|---|
| [01-app-shell.md](01-app-shell.md) | `App.tsx` — `DocumentData`, routing, session persistence, navigation guards |
| [02-auth.md](02-auth.md) | Login, OAuth callback, `authUtils.ts` — token management, authenticated fetch |
| [03-upload.md](03-upload.md) | Upload page — file upload, deduplication, parser selection |
| [04-processing.md](04-processing.md) | Processing page — document parsing, figures, tables, PDF viewer |
| [05-study-config.md](05-study-config.md) | Study config page — study type, entity definitions, template loading |
| [06-extraction.md](06-extraction.md) | Extraction page — entity extraction, multi-model comparison, PDF reference highlighting |
| [07-evaluation.md](07-evaluation.md) | Evaluation page — G-Eval scoring, background jobs, result visualization |
| [08-simplified-flow.md](08-simplified-flow.md) | Simplified flow — one-click pipeline, `useSimplifiedPipeline` hook |
| [09-chat.md](09-chat.md) | Chat page — document Q&A, multi-document context |
| [10-session-history.md](10-session-history.md) | Session history — browse, restore, share, delete sessions |
| [11-templates.md](11-templates.md) | Template workspace — CRUD, versioning, scopes, folders |
| [12-groups.md](12-groups.md) | Group management — create groups, manage membership and roles |
| [13-executive-mode.md](13-executive-mode.md) | Executive mode — standalone summary generation |
| [14-batch-results.md](14-batch-results.md) | Batch results — tabular view, search, export |

## Appendices

| Document | What it covers |
|---|---|
| [appendices/component-index.md](appendices/component-index.md) | All shared components with usage notes |
| [appendices/hooks-contexts.md](appendices/hooks-contexts.md) | All custom hooks and `ThemeContext` with exported APIs |
| [appendices/types-interfaces.md](appendices/types-interfaces.md) | Key TypeScript interfaces (`DocumentData`, `Template`, `Group`, etc.) |
