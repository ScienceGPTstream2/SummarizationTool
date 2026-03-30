# SummarizationTool: Deep Architecture Report

*Prepared by: Claude Code (claude-sonnet-4-6) | Date: March 2026 | Branch: `fix/ctx-and-structured-output-errors`*

---

## Executive Summary

**SummarizationTool** is a full-stack scientific document processing platform designed to automate the extraction of structured data from research papers. Researchers upload PDFs, have them parsed by one of two OCR/layout engines, select a domain-specific extraction template, run extraction across one or more large language models simultaneously, evaluate the output quality, and export results to Word or Excel.

The system is built on a React + TypeScript frontend (Vite) and a Python FastAPI backend (port 8001), backed by Supabase PostgreSQL for persistence and Supabase Storage for file management. Document parsing is handled by either **Docling** (open-source, local) or **Azure Document Intelligence** (cloud OCR). LLM extraction supports five provider families: Azure OpenAI, Google Gemini, Anthropic Claude, Llama, and local MacBook inference. Evaluation is powered by the DeepEval library's G-Eval framework.

**Main strengths:**
- End-to-end pipeline from raw PDF to structured, scored, exported results
- Flexible multi-model fan-out allowing direct side-by-side model comparison
- Well-designed job-queue system for async evaluation with cancellation support
- Filesystem-based hash caching avoids redundant parsing of identical documents
- Domain-specific prompt templates with few-shot examples tailored to clinical research

**Main pain points:**
- Session metrics (costs, latencies) are held entirely in memory — lost on server restart
- Extraction templates are static TypeScript files, not database-backed — no UI for authoring
- No end-to-end structured logging or tracing; timeout events written to a flat text file
- Evaluation reconnection relies on `sessionStorage` — fragile across tab reloads
- MacBook local inference is serialized via a FIFO queue, creating a throughput bottleneck for multi-entity workloads
- Figure and table counts are in-memory only; not durable across restarts

**Immediate fixes available (high impact, low-medium effort):**
- Persist `CallMetric` records to Supabase at write time (eliminates data loss on restart)
- Add structured JSON logging via Python's `structlog` or similar
- Move templates to database with a UI editor
- Persist evaluation job state to Supabase to survive tab reloads

**Architecture direction:**
The system already performs a primitive form of retrieval-augmented generation: documents are parsed to Markdown, figures are injected as context, and that combined representation is given to an LLM with a structured prompt. The natural next step is to add a vector indexing layer between parsing and extraction — enabling semantic search, chunk-level retrieval, and cross-document synthesis. The pipeline structure already supports this; the gap is the absence of an embedding and retrieval layer.

[INSERT DIAGRAM 1 HERE]

---

## 1. Current Architecture Overview

### 1.1 Major System Components

The application is organized into six major layers:

```
Browser (React/TS/Vite)
    │ HTTPS REST
    ▼
FastAPI Server (port 8001, 64-thread-pool workers)
    ├── Auth (Supabase JWT)
    ├── Document Processing (Docling / Azure DI)
    ├── LLM Extraction (5 provider families)
    ├── Evaluation (DeepEval G-Eval, async job queue)
    └── Session / Cost Tracking (in-memory + Supabase)
         │
         ▼
Supabase (PostgreSQL + Auth + Storage)
```

There is no message queue, no background worker process, and no separate microservices. The FastAPI process is single-instance and handles all work synchronously within async coroutines and a 64-thread executor pool.

---

### 1.2 Frontend Responsibilities

**Technology:** React 18, TypeScript, Vite, Tailwind CSS, Radix UI / Shadcn, Supabase JS client

The frontend is a multi-step wizard. Navigation between steps is managed by a root `App.tsx` component that owns a central `documentData` state object passed down through the page hierarchy. There is no global state manager (no Redux, no Zustand) — state is lifted to App.tsx and prop-drilled.

**Pages / steps:**

| Component | Step | Responsibility |
|---|---|---|
| `LoginPage.tsx` | 0 | Supabase email/OAuth login |
| `UploadPage.tsx` | 1 | Multi-file PDF upload, parser selection, processing trigger |
| `ProcessingPage.tsx` | 2 | Document viewer (Markdown + bounding-box PDF overlay) |
| `EntityExtractionPage.tsx` | 3 | Template selection, model selection, extraction run, summary generation |
| `EvaluationPage.tsx` | 4 | Provider/metric selection, ground-truth input, async eval job polling |
| `BatchResultsPage.tsx` | — | Searchable evaluation results table (nested inside EvaluationPage) |
| `SessionMetrics.tsx` | — | Floating widget + modal showing cost/latency metrics |

**Export utilities** (`ExportUtils.tsx`, `utils/wordExport.ts`, `utils/excelExport.ts`) are standalone modules called from EntityExtractionPage and EvaluationPage.

---

### 1.3 Backend Responsibilities

**Technology:** Python 3.11+, FastAPI, Uvicorn, asyncio, Supabase-py

The backend is a monolith organized into `api/` (HTTP routing), `services/` (business logic), and `schemas/` (Pydantic models). Key cross-cutting concerns:

- **Authentication:** Every protected route uses `Depends(get_current_user)` from `backend/core/dependencies.py`, which validates Supabase JWTs via `supabase_auth_service.py`.
- **Request limits:** Global max body size is **25 MB** (set in `main.py`).
- **Thread pool:** The lifespan context in `main.py` sets a custom `ThreadPoolExecutor` with **64 workers** specifically to handle LLM provider calls dispatched via `asyncio.to_thread()`.
- **Middleware:** CORS is permissive (all origins) for local development. Request logging middleware logs 400+ as warnings and 500+ as errors with full tracebacks.

---

### 1.4 Document Ingestion and Parsing Layer

**Purpose:** Convert raw PDFs (and other supported formats) into a normalized Markdown representation with extracted figure and table metadata, bounding box coordinates, and page counts.

**Key files:**
- `backend/services/document/document_service.py` — orchestrator
- `backend/services/document/processors/docling/docling_service.py` — Docling integration
- `backend/services/document/processors/azure_doc_intelligence/azure_doc_intelligence_service.py` — Azure DI integration
- `backend/services/document/organized_file_service.py` — filesystem cache layer
- `backend/api/documents/router.py` — HTTP entry point

**What enters:** A PDF file (binary), a `processor` choice (`AUTO`, `DOCLING`, `AZURE_DOC_INTELLIGENCE`), and a session/batch context.

**What leaves:**
- `document.md` — full Markdown of the document
- `raw_analysis.json` — raw parser output with bounding boxes for every paragraph, table, figure, and section
- `metadata.json` — parse duration, page count, figure count, table count
- (Figures saved as image files in organized storage)

**Transformations:**
1. File is hashed (SHA-256); hash becomes the `conversion_id`
2. Filesystem cache checked: `backend/files/global/<hash>/<processor>/` — if found, return immediately
3. If not cached, call chosen processor (Docling or Azure DI)
4. Normalize output: Docling returns `parse_duration_seconds`; Azure DI returns `conversion_time`
5. Store all artifacts to filesystem cache
6. Record per-doc metrics via `cost_tracker.record_call()`

**Auto-selection logic (`_auto_select_processor`):** Defaults to Azure DI if credentials are configured; falls back to Docling if not. There is no content-based selection logic currently.

**Concurrency constraint (Docling):** Docling holds a serialization lock during document conversion — only one Docling job runs at a time per server process. This is `vram_guard.py`'s responsibility (managing VRAM allocation). Azure DI is stateless and fully parallel.

**Edge cases:**
- If both processors fail, the document returns an error; the user sees a per-file error badge in `UploadPage.tsx`
- The cache is content-addressed; the same PDF uploaded twice by different users hits the same cache entry
- Figure files are stored relative to the organized file path; if the organized storage root moves, references break

[INSERT DIAGRAM 2 HERE]

---

### 1.5 LLM Extraction Layer

**Purpose:** For each entity defined in the extraction template, call an LLM with the document's Markdown (plus injected figures) and the entity's prompt, and return structured output.

**Key files:**
- `backend/api/extractions/router.py` — HTTP entry point, semaphore, fan-out
- `backend/services/llm/llm_service.py` — provider router, timeout wrapper
- `backend/services/llm/azure.py`, `gemini.py`, `anthropic.py`, `llama.py`, `macbook.py` — provider adapters
- `backend/config/pricing.json` — per-token cost lookup table

**What enters:** `markdown` text, `extraction_prompt`, `model_type`, model config (deployment, endpoint, API key, etc.), `max_tokens` (default 16,096), `temperature` (default 0.0), optional `system_message`, `session_id`.

**What leaves (per entity):**
```json
{
  "name": "Study Author(s)",
  "extracted": "Smith J, Jones A (2023)",
  "meta": {
    "prompt_tokens": 4200,
    "completion_tokens": 85,
    "duration": 3.14,
    "cost": 0.00042,
    "model": "gpt-4o",
    "deployment": "prod-gpt4o"
  },
  "references": [{"page": 1, "text": "...", "bbox": {...}}],
  "answer": null
}
```

**Concurrency:** An `asyncio.Semaphore(48)` gates all concurrent LLM calls in the extraction router. For cloud providers, entities are dispatched with `asyncio.gather()` — fully parallel up to the semaphore limit. For MacBook models, the `macbook_queue.py` FIFO queue forces sequential execution regardless of semaphore.

**Timeouts per provider:**

| Provider | Timeout |
|---|---|
| Azure OpenAI | 120s |
| Gemini | 120s |
| Anthropic | 120s |
| Llama | 300s |
| MacBook | 1,900s |

**Cost estimation:** After each successful call, `cost_tracker.estimate_call_cost(provider, model, prompt_tokens, completion_tokens)` reads `pricing.json` (keyed by model name) to compute per-call cost. This is stored in-memory in `CostTracker` (per session) and also injected into the extraction result's `meta.cost` field.

**Reference/bounding-box injection:** After extraction, `router.py` calls bounding box matching logic to align extracted text references back to page coordinates in `raw_analysis.json`. These `references` arrays are returned to the frontend for PDF overlay display.

[INSERT DIAGRAM 3 HERE]

---

### 1.6 Prompt Template System

**Purpose:** Define what entities to extract and how, using domain-specific prompts with few-shot examples.

**Key files:**
- `templates/level-1-epidemiology.ts`
- `templates/level-1-in-vivo.ts`
- `templates/level-2-in-vivo.ts`
- `templates/clinical-trial.ts`
- `templates/case-study.ts`
- `templates/observational.ts`
- `templates/review.ts`
- `templates/meta-analysis.ts`
- `templates/general-level-1-epidemiology-adam-v1.ts`
- Plus `*-noshot.ts` zero-shot variants

**Template structure (TypeScript):**
```typescript
export const level1EpidemiologyTemplate = {
  studyType: "level-1-epidemiology",
  displayName: "Level 1 – Epidemiology",
  summaryPrompt: "...",   // Instructions for combining extracted entities into a paragraph
  entities: [
    {
      name: "Study Author(s)",
      prompt: `Extract the study authors.
               Input: Smith J et al. (2023). Output: Smith J, et al.
               Input: Not mentioned. Output: Not Reported`
    },
    // ... ~10–15 entities per template
  ]
}
```

**How templates are selected:** In `EntityExtractionPage.tsx`, the user selects a study type from a dropdown. The matching template module is imported and its `entities` array is loaded into component state. The `summaryPrompt` is passed to the paragraph-generation call after all entities are extracted.

**Constraint:** Templates are static TypeScript modules compiled into the frontend bundle. There is no backend template registry, no database storage, and no UI for editing templates. Changes require a code edit and a frontend rebuild.

**Zero-shot variants:** Each template has a `*-noshot.ts` variant with few-shot examples removed. These are available via a separate selection in the dropdown.

[INSERT DIAGRAM 4 HERE]

---

### 1.7 Evaluation Logic

**Purpose:** Score extracted entity values against ground truth or against document-grounded expectations using LLM-as-judge (G-Eval).

**Key files:**
- `backend/services/evaluation/evaluation_service.py` — metric factories, combined eval, batch eval
- `backend/services/evaluation/job_queue.py` — async job lifecycle, concurrency, persistence
- `backend/api/evaluations/jobs.py` — HTTP entry point for job submission and polling
- `backend/services/evaluation/adapters/` — DeepEval-compatible wrappers for Azure, Vertex, Anthropic

**Metrics:**

| Metric | Ground Truth Required | Description |
|---|---|---|
| Correctness | Yes | Facts in extracted output match ground truth |
| Completeness | Yes | All key information from ground truth is present |
| Relevance | No | Output is focused and on-topic |
| Safety | No | No PII, bias, or toxicity |

**Evaluation job lifecycle:**
1. Frontend POSTs `{tasks[], providers[], metrics[], threshold}` to `/api/evaluations/jobs`
2. Backend computes Cartesian product: `tasks × providers` → flat list of atomic work units (`EvalTask × ProviderConfig`)
3. Job is registered; `job_id` returned immediately with status `"pending"`
4. Background async task `_process_job()` launches all work units concurrently
5. Frontend polls `GET /api/evaluations/jobs/{job_id}` until status is `"completed"` or `"cancelled"`
6. Results persisted to Supabase via `session_service.add_evaluation_result_fast()` per task

**Concurrency model:**
- `GLOBAL_LLM_CONCURRENCY = 30` — shared semaphore across all jobs
- Per-provider API semaphores in adapters: Azure=25, Vertex=25, Anthropic=8
- Per-job concurrency: `max(1, GLOBAL // active_running_jobs)` — dynamically computed
- `asyncio.wait_for(eval_call, timeout=60.0)` wraps every atomic eval

**Combined evaluation optimization:** Rather than making one LLM call per metric, `_evaluate_combined()` in `evaluation_service.py` builds a single prompt containing all metric evaluation blocks and parses the JSON response in one call. This gives roughly 4× throughput improvement for 4-metric evaluations. If JSON parsing fails (truncation, malformed output), it falls back to per-metric `a_measure()` calls.

**Cancellation:** Two mechanisms exist in parallel:
- `cancel_job(job_id)` sets `job.cancelled = True` and cancels all live `asyncio.Task` handles
- `cancel_session(session_id)` adds `session_id` to a global `CANCELLED_SESSIONS` set checked at the start of each mini-batch in `evaluate_multiple_extractions()`

---

### 1.8 Session and State Management

**Purpose:** Persist user sessions, document metadata, extraction results, and evaluation results across browser reloads.

**Key files:**
- `backend/api/sessions/router.py` — session CRUD
- `backend/services/database/supabase_db_service.py` — Supabase PostgreSQL client
- `components/SessionHistoryPage.tsx` — session restore UI

**What is persisted to Supabase PostgreSQL:**
- `sessions` table: session ID, user ID, name, configuration JSON, aggregated cost/latency totals
- `documents` table: per-document parse cost, page count, processor used, file hash
- `extractions` table: per-entity extracted text, model, token usage, file hash
- `evaluations` table: per-task evaluation scores, metrics, provider, cost

**What is in-memory only (lost on restart):**
- `CallMetric` records in `CostTracker` (per-call details: tokens, latency, per-model breakdowns)
- Figure and table counts (from `metadata.json` at runtime)
- Active `EvalJob` objects in `_JOBS` dict (evaluation job queue)

**Session restoration:** `SessionHistoryPage.tsx` lists past sessions from Supabase. When a user restores a session, `documentData.uploadedFiles` is populated with stored metadata and the extraction step is re-entered with previously extracted entities visible. Sessions older than 1 hour with completed/cancelled evaluation jobs are evicted from the in-memory job dict by a cleanup loop.

---

### 1.9 Cost Tracking and Metrics

**Purpose:** Track per-call token counts, latency, and estimated cost in real time during a session.

**Key files:**
- `backend/services/telemetry/cost_tracker.py` — `CallMetric`, `SessionMetrics`, `CostTracker` classes
- `backend/api/server/router.py` — `GET /api/server/session-metrics`, `DELETE`, `POST /api/server/benchmark/clear`
- `backend/config/pricing.json` — per-model pricing lookup
- `components/SessionMetrics.tsx` — frontend widget and modal

**Data flow:** Every successful LLM call (extraction or evaluation) calls `cost_tracker.record_call(provider, model, prompt_tokens, completion_tokens, duration)`. The tracker aggregates per-provider and per-model totals in memory. The `GET /api/server/session-metrics` endpoint serializes the entire in-memory state for the frontend widget.

**Limitation:** Because `CostTracker` is a module-level singleton with no persistence, all metrics disappear when the FastAPI process restarts. Aggregated totals (total_cost, total_latency) are separately written to the `sessions` DB table by the session service, but individual `CallMetric` records are not.

---

### 1.10 Export Pipeline

**Purpose:** Convert extraction and evaluation results into downloadable office documents.

**Key files:**
- `components/ExportUtils.tsx` — Word document generation from extraction results
- `utils/wordExport.ts` — Word document generation from evaluation results
- `utils/excelExport.ts` — Excel export of all results

**Word export (extractions):** Uses the `docx` and `markdown-docx` npm libraries. The document includes a pipeline configuration table, per-entity subsections with the extraction prompt and result (Markdown rendered to OOXML), metadata tables, and an optional final summary paragraph. If `selectedModel` is provided, only that model's extractions are included.

**Word export (evaluation):** Generates an executive summary section, methodology section, detailed results per entity per provider, and auto-generated recommendations for low-scoring entities.

**Excel export:** Uses `ExcelJS` to generate a multi-sheet workbook: one row per (file × entity × model) with token counts, costs, and all metric scores. An optional second sheet contains session-level provider breakdowns.

All exports are generated entirely client-side as `Blob` objects and downloaded via `URL.createObjectURL()`. No backend endpoint is involved.

---

### 1.11 File Responsibility Map

| File | Role | Orchestration Hub? |
|---|---|---|
| `backend/main.py` | App factory, middleware, router registration, thread pool sizing | Yes — entry point |
| `backend/api/documents/router.py` | Document upload, processing dispatch, cache lookup, metric recording | Yes — parse pipeline entry |
| `backend/api/extractions/router.py` | Entity extraction dispatch, concurrency gating, cost injection, bbox matching | Yes — extraction hub |
| `backend/api/evaluations/jobs.py` | Job submission, polling endpoint | Yes — async eval entry |
| `backend/services/document/document_service.py` | Processor auto-select, cache check, orchestrate parse | Yes |
| `backend/services/llm/llm_service.py` | Route by model_type, apply timeouts, record metrics | Yes — LLM hub |
| `backend/services/evaluation/evaluation_service.py` | Build metrics, run combined eval, manage cancellation | Yes |
| `backend/services/evaluation/job_queue.py` | Job lifecycle, concurrency, retry, persistence dispatch | Yes |
| `backend/services/telemetry/cost_tracker.py` | In-memory call aggregation | Shared singleton |
| `components/EntityExtractionPage.tsx` | Multi-model state, session creation, extraction loop, summary gen | Yes — frontend extraction hub |
| `components/EvaluationPage.tsx` | Job submission, polling, reconnection, results display | Yes — frontend eval hub |
| `App.tsx` | Step routing, documentData owner | Yes — frontend root |
| `templates/*.ts` | Static entity definitions with few-shot prompts | Data only |
| `backend/config/pricing.json` | LLM cost lookup table | Data only |

---

## 2. Detailed Data Flow and API Mechanics

### 2.1 The Full Upload-to-Export Pipeline

```
[User] → Upload PDF(s)
    → POST /api/upload (FormData)
    ← { file_id, filename }

[User] → Click "Process"
    → POST /api/documents/process/file/{fileId} { processor: "azure_doc_intelligence" }
    ← { conversion_id, processor_used, markdown_path, figures_count, tables_count }

[User] → Select template → Select models → Click "Extract All"
    → POST /api/entities/extract (for each entity × model, semaphore 48)
    ← { extracted_entities: [{name, extracted, meta, references, answer}] }

[User] → (Optional) Enter ground truths → Click "Start Evaluation"
    → POST /api/evaluations/jobs { tasks[], providers[], metrics[], threshold }
    ← { job_id, total, status: "pending" }
    → GET /api/evaluations/jobs/{job_id}  (polled every 2s)
    ← { status, progress, results[] }

[User] → Click "Export"
    (client-side only: Blob generation, no backend call)
```

### 2.2 Document Processing: Request and Response Detail

**Request to `/api/documents/process/file/{fileId}`:**
```json
{
  "processor": "azure_doc_intelligence",
  "batch_number": 1
}
```

**Response:**
```json
{
  "conversion_id": "sha256hash...",
  "processor_used": "azure_doc_intelligence",
  "processor_fallback": false,
  "fallback_reason": null,
  "markdown_path": "/files/global/<hash>/azure_doc_intelligence/document.md",
  "figures_count": 4,
  "tables_count": 2,
  "page_count": 18,
  "parse_duration_seconds": 12.4
}
```

The `conversion_id` is the SHA-256 hash of the file content. All subsequent calls reference this ID. If the cache already holds the artifact, the response is returned in milliseconds with no parsing.

### 2.3 Extraction: Request and Response Detail

**Request to `/api/entities/extract`** (one call per entity, fanned out concurrently from frontend):
```json
{
  "file_hash": "sha256hash...",
  "prompt": "Extract the study authors. Input: Smith J... Output: Smith J, et al.",
  "system_prompt": "You are a scientific data extractor...",
  "model": "azure",
  "deployment": "prod-gpt4o",
  "endpoint": "https://...",
  "api_key": "...",
  "max_tokens": 16096,
  "temperature": 0.0,
  "references": true
}
```

**Response:**
```json
{
  "name": "Study Author(s)",
  "extracted": "Smith J, Jones A (2023)",
  "meta": {
    "prompt_tokens": 4250,
    "completion_tokens": 12,
    "duration": 2.83,
    "cost": 0.000427,
    "model": "gpt-4o",
    "deployment": "prod-gpt4o"
  },
  "references": [
    {
      "page": 1,
      "text": "Smith J, Jones A.",
      "bbox": {"x": 0.12, "y": 0.08, "width": 0.3, "height": 0.02}
    }
  ],
  "answer": null
}
```

The `answer` field is populated when structured output mode is active (JSON schema enforcement via the provider). When not active, `extracted` contains the raw LLM response as a string.

### 2.4 Evaluation Job: Request and Response Detail

**Request to `POST /api/evaluations/jobs`:**
```json
{
  "session_id": "sess_abc123",
  "tasks": [
    {
      "entity_name": "Study Author(s)",
      "source_model": "gpt-4o",
      "actual_output": "Smith J, Jones A (2023)",
      "extraction_prompt": "Extract the study authors...",
      "expected_output": "Smith J, Jones A (2023)",
      "file_hash": "sha256hash...",
      "file_id": "file_001"
    }
  ],
  "providers": [
    {
      "provider_id": "azure-gpt4o",
      "provider": "azure_openai",
      "model_name": "gpt-4o",
      "deployment": "prod-gpt4o",
      "endpoint": "https://..."
    }
  ],
  "metrics": ["correctness", "completeness", "relevance", "safety"],
  "threshold": 0.7
}
```

**Immediate response:**
```json
{
  "job_id": "job_xyz789",
  "total": 4,
  "status": "pending"
}
```

**Poll response (`GET /api/evaluations/jobs/{job_id}`):**
```json
{
  "job_id": "job_xyz789",
  "status": "running",
  "progress": 0,
  "total": 1,
  "results": [],
  "errors": []
}
```

**Completed response:**
```json
{
  "job_id": "job_xyz789",
  "status": "completed",
  "progress": 1,
  "total": 1,
  "results": [
    {
      "entity_name": "Study Author(s)",
      "source_model": "gpt-4o",
      "file_id": "file_001",
      "provider_id": "azure-gpt4o",
      "aggregate_score": 0.95,
      "all_passed": true,
      "evaluation_time": 4.2,
      "evaluation_cost": 0.0012,
      "metrics": [
        {"metric_name": "correctness", "score": 1.0, "threshold": 0.7, "success": true, "reason": "..."},
        {"metric_name": "completeness", "score": 0.9, "threshold": 0.7, "success": true, "reason": "..."},
        {"metric_name": "relevance", "score": 0.95, "threshold": 0.7, "success": true, "reason": "..."},
        {"metric_name": "safety", "score": 1.0, "threshold": 0.7, "success": true, "reason": "..."}
      ]
    }
  ],
  "errors": []
}
```

### 2.5 Multi-Provider Extraction Fan-Out

When a user selects multiple models (e.g., GPT-4o + Claude Sonnet + Gemini 2.5 Pro), the frontend dispatches concurrent extraction calls for the same entity to all selected models simultaneously. Each model's result is stored in `entity.extractionsByModel[modelId]`. The semaphore in `router.py` gates the total concurrency at 48; with 3 models × 15 entities = 45 concurrent calls, this fits within the limit.

The frontend's `EntityExtractionPage.tsx` builds a `fileModelTemperatures` map and tracks `extractingEntities` as a Set. When all entities are done for all models for a given file, that file's status transitions to `"completed"`.

Cost tracking in `cost_tracker.py` accumulates across all model calls. The frontend's `SessionMetrics` widget reflects the running total in real time (refreshed on demand).

### 2.6 Caching Mechanics

The parsing cache is content-addressed:
- `conversion_id` = SHA-256 of the raw file bytes
- Artifacts stored at `backend/files/global/<conversion_id>/<processor>/`
- Cache hit returns without calling any processor
- Cache miss triggers the full parse pipeline, then writes to disk

This means two different users uploading the same PDF will share the same cached parse result. There is no cache invalidation mechanism (no TTL, no manual purge outside of the benchmark clear endpoint). Cache entries are permanent until manually deleted.

### 2.7 Failure Paths and Retry Behavior

| Layer | Failure Type | Behavior |
|---|---|---|
| Upload | File too large (>25MB) | 413 from FastAPI middleware; frontend shows error badge |
| Parsing | Processor unavailable | Auto-fallback to Docling; `processor_fallback: true` in response |
| Parsing | Both processors fail | 500 error; frontend shows per-file error state |
| Extraction | LLM timeout | Timeout logged to `output/timeout_logs/timeout_log.txt`; `extracted: "Error: timeout"` in result |
| Extraction | Provider error | Returned in `extracted` as `"Error: <message>"`; other entities continue |
| Evaluation | LLM timeout (60s) | Recorded in `job.errors` with `error_type: "timeout"`; job continues |
| Evaluation | Rate limit | Classified as `"rate_limit"`, recorded in errors; MAX_ATTEMPTS=1 so no retry currently |
| Evaluation | Job cancelled | All `asyncio.Task` handles cancelled; status set to `"cancelled"` |
| Export | Markdown→DOCX parse failure | Falls back to plain text paragraph; no user-visible error |

---

## 3. User Stories Mapped to Backend Reality

### User Story 1: Full Extraction Workflow

#### What the user sees on the frontend
The researcher drags three PDFs onto the upload zone, selects "Azure Document Intelligence" as the parser, clicks "Process All," waits for three green checkmarks, navigates to the extraction step, picks the "Level 1 – Epidemiology" template, selects GPT-4o as the model, clicks "Extract All," watches per-entity progress bars, reviews results, and clicks "Export to Word."

#### What actually happens behind the scenes

1. **Upload:** `UploadPage.tsx` calls `POST /api/upload` (FormData, one request per file). Backend saves to `backend/uploads/`. Returns `{file_id}`. Frontend stores `file_id` per file.

2. **Processing:** For each file, `POST /api/documents/process/file/{fileId}` is called concurrently (batch). Backend hashes the file, checks filesystem cache, calls Azure DI if cache miss, writes `document.md` + `raw_analysis.json` + `metadata.json` to `backend/files/global/<hash>/azure_doc_intelligence/`. Returns `conversion_id`, figure/table counts, parse duration. Frontend transitions file status to "Processed."

3. **Template load:** User picks "Level 1 – Epidemiology" → `level1EpidemiologyTemplate.entities` array (15 entities) is loaded into `EntityExtractionPage`'s `entities` state.

4. **Extraction:** User clicks "Extract All." For each file × each entity, frontend calls `POST /api/entities/extract`. All calls are dispatched concurrently (via `Promise.all` in the frontend, gated by Semaphore 48 on the backend). Backend fetches `document.md`, builds `enhanced_markdown` (markdown + figure context), calls `LLMService.extract_entities_from_markdown()`, records cost, matches bounding boxes, returns result.

5. **Results stored:** Frontend stores result in `entity.extractionsByModel["gpt-4o"]`. After all 15 entities complete, file status becomes "completed." Session is created in Supabase via `POST /api/sessions` on first extraction; each entity result saved via `POST /api/sessions/{id}/extractions`.

6. **Export:** User clicks "Export to Word." `generateWordDocument()` in `ExportUtils.tsx` runs entirely client-side. Produces a `.docx` Blob and triggers download.

#### Exact system path

```
UploadPage.tsx:handleUpload()
  → POST /api/upload
  → backend/api/documents/router.py
  → document_service.convert_document_to_markdown()
  → azure_doc_intelligence_service.convert()
  → filesystem cache write
  → response

EntityExtractionPage.tsx:handleExtractAll()
  → concurrent POST /api/entities/extract × 15
  → backend/api/extractions/router.py (Semaphore 48)
  → llm_service.extract_entities_from_markdown()
  → azure.py:call()
  → Azure OpenAI API
  → bounding box matcher
  → cost_tracker.record_call()
  → response

ExportUtils.tsx:generateWordDocument()
  → docx library
  → Blob
  → URL.createObjectURL()
  → browser download
```

#### API and payload breakdown

See §2.2 and §2.3 above for exact shapes.

#### What information is preserved and what is lost

| Stage | Preserved | Lost |
|---|---|---|
| Upload | File bytes, file_id | Nothing |
| Parsing | Markdown, bounding boxes, figures, page/figure/table counts | Original PDF layout fidelity (markdown is approximation) |
| Extraction | Entity text, token counts, cost, bounding box references, model | Raw LLM reasoning chain |
| Export | All of the above in Word format | Per-model comparison data (single model exported at a time) |

#### Performance, failure, and reliability

- **Parsing latency:** Azure DI typically 8–20s per document. Docling is slower (30–60s) and serialized.
- **Extraction latency:** With 15 entities all dispatched concurrently, wall-clock time ≈ slowest single entity call (~3–8s for GPT-4o).
- **Failure risk:** If the FastAPI server restarts mid-extraction, in-progress requests are dropped; the frontend shows timeout errors. There is no request replay mechanism.

**Suggested diagram placement:** [INSERT DIAGRAM 2 HERE] (parsing pipeline), [INSERT DIAGRAM 3 HERE] (extraction fan-out)

---

### User Story 2: Extraction Without Evaluation

#### What the user sees on the frontend
The researcher processes a single document, runs extraction, reviews results, and exports directly to Word — skipping the evaluation step entirely.

#### What actually changes in the system path

Evaluation is entirely optional. The `EvaluationPage.tsx` is only reached if the user explicitly navigates to it. When skipped:

- No `POST /api/evaluations/jobs` call is ever made
- No evaluation records are written to Supabase
- The `EvaluationPage`'s ground-truth state is never populated
- The `BatchResultsPage` never renders
- Export from `EntityExtractionPage.tsx` contains only extraction data (no metric scores)

The Supabase `extractions` table is still written to (via `POST /api/sessions/{id}/extractions`). Session aggregated cost/latency are still written to the `sessions` table. The only omission is the `evaluations` table entries.

**Cost difference:** Evaluation using GPT-4o for 4 metrics on 15 entities typically costs 5–15× more than the extraction itself (G-Eval requires multi-turn LLM calls per metric per entity). Skipping evaluation is the default cost-saving path.

#### Information preserved vs. lost

The extraction results are fully preserved in Supabase and recoverable from `SessionHistoryPage.tsx`. The absence of evaluation means there is no quality signal — the user cannot tell which extractions are correct vs. hallucinated without manual review.

**Suggested diagram placement:** [INSERT DIAGRAM 5 HERE]

---

### User Story 3: Multi-Model Comparison

#### What the user sees on the frontend
The researcher selects three models simultaneously (GPT-4o, Claude Sonnet 4.5, Gemini 2.5 Pro) before clicking "Extract All." The results pane shows a column per model for each entity. They can compare answers side by side and decide which model performs best before running formal evaluation.

#### What actually happens behind the scenes

1. `EntityExtractionPage.tsx` maintains `selectedModels: string[]` (array, not scalar).
2. When "Extract All" is clicked, for each file × each entity × each model, a `POST /api/entities/extract` call is dispatched.
3. With 3 models × 15 entities = 45 concurrent extraction calls, all dispatched simultaneously (subject to Semaphore 48).
4. Each result is stored under `entity.extractionsByModel[modelId]`.
5. The UI renders a tab or column per model in the extraction results pane.
6. Cost tracker accumulates costs for all 45 calls.

#### Session persistence of multi-model results

When saving to Supabase via `POST /api/sessions/{id}/extractions`, each (entity × model) result is persisted as a separate row in the `extractions` table. On session restore, the frontend reconstructs `extractionsByModel` from the stored rows.

#### Cost implication

3 models × 15 entities = 45 LLM calls. With a mid-length research paper (~4,000 tokens prompt), this is approximately 180,000 prompt tokens. At GPT-4o rates (~$2.50/M input), that's ~$0.45 just for Azure extraction. Add Gemini and Claude and total cost per document approaches $1.00–$1.50.

#### Failure resilience

If one provider returns errors (e.g., Anthropic rate limit), only that model's cells show `"Error: ..."`. The other two models' results are unaffected.

**Suggested diagram placement:** [INSERT DIAGRAM 3 HERE]

---

## 4. Immediate Improvements

### 4.1 Speed and Performance

**Issue: MacBook extraction is fully serialized**
- **Where:** `backend/services/llm/macbook_queue.py` — FIFO queue enforces sequential execution
- **Why it matters:** A 15-entity extraction across a MacBook model takes 15× longer than the first entity alone.
- **Fix:** Allow limited parallelism (2–3 concurrent MacBook calls) if VRAM allows. `vram_guard.py` already handles VRAM management for Docling; a similar guard for MacBook concurrency (configurable via `macbook_model_policy.json`) would cap simultaneous requests without full serialization.
- **Effort:** Medium | **Priority:** Medium

**Issue: Multi-model extraction creates N×M HTTP round trips**
- **Where:** `components/EntityExtractionPage.tsx` — each entity × model is a separate HTTP call
- **Why it matters:** With 3 models × 15 entities, that's 45 requests, each with full headers and TLS overhead.
- **Fix:** Add a backend batch-extraction endpoint accepting a list of `(entity, model)` pairs and dispatching internally.
- **Effort:** Medium | **Priority:** Medium

---

### 4.2 Reliability

**Issue: In-memory cost metrics lost on server restart**
- **Where:** `backend/services/telemetry/cost_tracker.py` — `CostTracker` is a module-level singleton with no persistence
- **Why it matters:** Every server restart wipes the per-call breakdown visible in `SessionMetrics`.
- **Fix:** Write each `CallMetric` to Supabase immediately via an async fire-and-forget insert.
- **Effort:** Low | **Priority:** High

**Issue: Evaluation job state is purely in-memory**
- **Where:** `backend/services/evaluation/job_queue.py` — `_JOBS: Dict[str, EvalJob]` with 1-hour TTL
- **Why it matters:** Server restart during a long evaluation run loses all progress.
- **Fix:** Persist `EvalJob` snapshots to Supabase at each task completion.
- **Effort:** High | **Priority:** Medium

**Issue: Evaluation retry count is effectively 0**
- **Where:** `backend/services/evaluation/job_queue.py:_run_single_eval()` — `MAX_ATTEMPTS = 1`
- **Why it matters:** Transient provider errors permanently fail evaluation tasks.
- **Fix:** Increase `MAX_ATTEMPTS` to 3 for rate-limit and transient errors. The back-off delay logic already exists (`[15s, 45s]` for rate limits) — just increase the attempt count.
- **Effort:** Low | **Priority:** High

---

### 4.3 Observability

**Issue: Timeout events written to a flat text file**
- **Where:** `backend/api/extractions/router.py` and `backend/services/llm/llm_service.py` write to `backend/output/timeout_logs/timeout_log.txt`
- **Why it matters:** Flat file logs are not queryable, not correlated with session IDs, and invisible from the frontend.
- **Fix:** Replace with structured JSON logging (e.g., Python's `structlog`) and emit to stdout. Add `session_id`, `model`, `entity_name` to every timeout event.
- **Effort:** Low | **Priority:** High

**Issue: No distributed tracing or request correlation**
- **Where:** `backend/core/logging_config.py`, `backend/core/middleware.py`
- **Why it matters:** Correlating a frontend action to a backend log line requires manual timestamp matching.
- **Fix:** Add a `X-Request-Id` header in middleware, propagate through service calls, include in all log lines.
- **Effort:** Low | **Priority:** Medium

---

### 4.4 UX Clarity

**Issue: No real-time progress during extraction**
- **Where:** `components/EntityExtractionPage.tsx` — `fileProcessingStatus` tracks entity index but the UI shows only a spinner
- **Why it matters:** With 15 entities across 3 models, the user waits ~30s with no feedback.
- **Fix:** Show a per-entity progress list during extraction. The state already exists in `extractingEntities` and `completedEntities` sets — just render them.
- **Effort:** Low | **Priority:** High

**Issue: Evaluation reconnection relies on sessionStorage**
- **Where:** `components/EvaluationPage.tsx` — `sessionStorage.setItem("evalActiveJob", jobId)`
- **Why it matters:** `sessionStorage` is tab-specific. Closing and reopening the tab loses the job reference.
- **Fix:** Store the active job ID in `localStorage` and validate against the backend on page load.
- **Effort:** Low | **Priority:** Medium

---

### 4.5 Data Modeling

**Issue: Figure and table counts not durably stored**
- **Where:** Counts come from `metadata.json` in the filesystem cache, not from the Supabase `documents` table at query time
- **Why it matters:** If the cache is cleared, counts are lost until documents are re-processed.
- **Fix:** Write figure_count and table_count to the `documents` table during the initial parse.
- **Effort:** Low | **Priority:** Medium

---

### 4.6 Template Architecture

**Issue: Extraction templates are static TypeScript files**
- **Where:** `templates/*.ts` — compiled into the frontend bundle at build time
- **Why it matters:** Adding or editing a template requires a code change and a frontend rebuild.
- **Fix:** Move templates to the database (`templates` table, which already exists per `backend/api/templates/router.py`). Add a template editor UI in `TemplateWorkspace/`. The infrastructure is already partially built in `backend/services/templates/template_service.py`.
- **Effort:** Medium | **Priority:** High

---

## 5. Future Direction: Toward a Fuller RAG Architecture

### 5.1 What Already Resembles RAG

The current system already performs the key steps of a retrieval pipeline:

1. **Ingestion:** PDFs are parsed into Markdown with structural metadata (bounding boxes, figure coordinates, section headings)
2. **Context construction:** `enhanced_markdown` in `extractions/router.py` injects figure data alongside document text — a form of multi-modal context augmentation
3. **Prompted retrieval:** Extraction prompts are structured queries ("Extract the primary outcome measure...") against a document corpus
4. **Structured output:** Results are entity-normalized, not free-form

The difference from a full RAG system is that the "retrieval" step is whole-document injection rather than semantic chunk selection.

### 5.2 What Is Missing

| RAG Component | Current State | Gap |
|---|---|---|
| **Chunking** | None — whole document sent | Need semantic or structural chunk boundaries |
| **Embeddings** | None | Need a vector embedding step post-parsing |
| **Vector store** | None | Need pgvector (already in Supabase/Postgres) or a dedicated store |
| **Retrieval** | None — full doc injected | Need similarity search to select relevant chunks per entity prompt |
| **Metadata filtering** | None | Need section labels, page numbers as retrieval filters |
| **Provenance** | Bounding box references exist | Need chunk-level source attribution at retrieval time |
| **Cross-document synthesis** | None | Need multi-document retrieval for meta-analysis templates |
| **Re-ranking** | None | Optionally: cross-encoder re-ranking after retrieval |

### 5.3 What Architectural Changes Would Be Needed

**Step 1 — Indexing layer (post-parse):**
After `document.md` and `raw_analysis.json` are written to the filesystem cache, a new `indexing_service.py` would:
- Split the Markdown into chunks (structural: by section heading, or fixed token windows with overlap)
- Embed each chunk using an embedding model (Azure OpenAI `text-embedding-3-small`, Gemini `text-embedding-004`, or local)
- Store `(chunk_id, document_id, chunk_text, chunk_embedding, metadata)` in pgvector (Supabase supports this via the `pgvector` extension)

**Step 2 — Retrieval step (pre-extraction):**
Before calling the LLM in `llm_service.extract_entities_from_markdown()`, a `retrieval_service.py` would:
- Embed the entity prompt
- Query pgvector for top-K most similar chunks from the target document(s)
- Return ranked chunks with source metadata (page, section, bounding box)

**Step 3 — Context assembly (replace whole-doc injection):**
The `enhanced_markdown` currently constructed in `extractions/router.py` would be replaced by the top-K retrieved chunks, formatted with source provenance labels.

**Step 4 — Multi-document RAG (for meta-analysis):**
The `meta-analysis.ts` template already implies cross-document synthesis. With a vector store, retrieval can span multiple documents simultaneously.

### 5.4 Grounding and Provenance

The current bounding-box reference system (`bbox_normalizer.py`, `bounding_box_matcher.py`) is a primitive provenance mechanism. In a full RAG system, this extends naturally: each chunk stores its source section and page range, retrieved chunks carry source metadata into the LLM context, and the frontend can highlight source passages in the PDF viewer (`PDFBoundingBoxViewer` already supports this).

### 5.5 Evaluation and Human-in-the-Loop

The existing G-Eval framework is directly compatible with a RAG architecture. Additional opportunities:
- **Retrieval evaluation:** Context recall and context precision metrics (are the right chunks being retrieved?)
- **SME review:** The existing ground-truth input UI in `EvaluationPage.tsx` already provides human-in-the-loop. This could extend to chunk-level annotation — domain experts mark which chunks are relevant for each entity type, creating a labeled retrieval training dataset
- **Feedback loop:** Low-scoring entities could trigger automatic re-extraction with a wider retrieval window

### 5.6 Migration Path

```
Phase 1 (Now):    Fix §4 issues — persistence, retries, template DB, logging
Phase 2 (Near):   Add pgvector to Supabase; build chunking & indexing service;
                  index existing parsed documents
Phase 3 (Mid):    Add retrieval service; replace whole-doc injection with
                  retrieved-chunk injection; A/B test quality vs. current
Phase 4 (Future): Multi-document retrieval for meta-analysis templates;
                  retrieval evaluation metrics; SME annotation interface
Phase 5 (Long):   Full RAG with feedback loop, re-ranking, and provenance UI
```

[INSERT DIAGRAM 7 HERE]

---

## 6. Appendix

### 6.1 Endpoint Inventory

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/upload` | Yes | Upload file |
| POST | `/api/documents/process/file/{fileId}` | Yes | Process document |
| GET | `/api/documents/{fileId}` | Yes | Get document metadata |
| DELETE | `/api/files/{fileId}` | Yes | Delete uploaded file |
| POST | `/api/entities/extract` | Yes | Extract single entity |
| POST | `/api/entities/extract-paragraph` | Yes | Generate summary paragraph |
| POST | `/api/sessions` | Yes | Create session |
| GET | `/api/sessions` | Yes | List sessions |
| GET | `/api/sessions/{id}` | Yes | Get session |
| DELETE | `/api/sessions/{id}` | Yes | Delete session |
| POST | `/api/sessions/{id}/extractions` | Yes | Save extraction result |
| POST | `/api/evaluations/jobs` | Yes | Submit evaluation job |
| GET | `/api/evaluations/jobs/{job_id}` | Yes | Poll job status |
| POST | `/api/evaluations/jobs/{job_id}/cancel` | Yes | Cancel job |
| POST | `/api/evaluations/evaluate` | Yes | Single evaluation |
| POST | `/api/evaluations/evaluate/batch` | Yes | Batch evaluation |
| POST | `/api/evaluations/cancel` | Yes | Cancel by session |
| GET | `/api/evaluations/results` | Yes | List eval results |
| GET | `/api/server/session-metrics` | Yes | Get in-memory metrics |
| DELETE | `/api/server/session-metrics` | Yes | Clear metrics |
| POST | `/api/server/benchmark/clear` | Yes | Clear benchmark cache |
| GET | `/api/models` | Yes | List available Azure models |
| GET/POST/PUT/DELETE | `/api/templates/...` | Yes | Template CRUD |
| GET/POST/PUT/DELETE | `/api/groups/...` | Yes | Group CRUD |

### 6.2 Provider Inventory

| Provider Key | Technology | Timeout | Concurrency Limit |
|---|---|---|---|
| `azure` | Azure OpenAI (GPT-4o, GPT-4o-mini, etc.) | 120s | Adapter semaphore: 25 |
| `gemini` | Google Gemini (2.5 Pro, 2.5 Flash Lite) | 120s | Adapter semaphore: 25 |
| `anthropic` | Anthropic Claude (Sonnet 4.5, Opus) | 120s | Adapter semaphore: 8 |
| `llama` | Llama API (cloud-hosted) | 300s | Shared with extraction sem 48 |
| `azure-llama` | Llama via Azure AI | 120s | Adapter semaphore: 25 |
| `macbook` | Local MacBook LLM (Ollama / similar) | 1,900s | FIFO queue (1 at a time) |

### 6.3 Template Inventory

| File | Display Name | Entity Count | Domain |
|---|---|---|---|
| `level-0-epidemiology-metadata.ts` | Level 0 – Metadata | ~5 | Epidemiology |
| `level-1-epidemiology.ts` | Level 1 – Epidemiology | ~15 | Epidemiology |
| `level-1-in-vivo.ts` | Level 1 – In Vivo | ~15 | Animal studies |
| `level-2-in-vivo.ts` | Level 2 – In Vivo | ~20 | Animal studies (deep) |
| `clinical-trial.ts` | Clinical Trial | ~15 | RCTs |
| `case-study.ts` | Case Study | ~12 | Case reports |
| `observational.ts` | Observational | ~14 | Cohort/cross-sectional |
| `review.ts` | Review | ~10 | Literature reviews |
| `meta-analysis.ts` | Meta-Analysis | ~12 | Meta-analyses |
| `general-level-1-epidemiology-adam-v1.ts` | General Epi (Adam v1) | ~15 | Custom epidemiology variant |
| `*-noshot.ts` variants | Zero-shot versions | Same as parent | Same as parent |

### 6.4 Glossary

| Term | Definition |
|---|---|
| **Conversion ID** | SHA-256 hash of file bytes; used as the unique identifier for all cached artifacts |
| **Entity** | A named data field to extract (e.g., "Study Author(s)", "Primary Outcome") with an associated extraction prompt |
| **Template** | A named collection of entities with a summary prompt, grouped by study type |
| **G-Eval** | LLM-as-judge evaluation framework from DeepEval; scores extracted outputs on configurable criteria |
| **Combined eval** | Optimization in `evaluation_service.py` that scores all metrics in a single LLM call rather than N calls |
| **EvalTask** | An atomic unit of evaluation work: one (entity, model) pair to evaluate |
| **ProviderConfig** | Configuration for one evaluation provider/model (endpoint, deployment, credentials) |
| **CostTracker** | In-memory singleton that accumulates per-call token and cost metrics for a session |
| **Enhanced Markdown** | Document Markdown plus injected figure context block sent to LLM for extraction |
| **VRAM Guard** | Docling-specific VRAM management module that serializes Docling jobs to prevent OOM errors |
| **Batch metrics** | Wall-clock latency for processing a group of documents together, tracked for benchmarking |
| **Bounding box** | Page-coordinate rectangle linking extracted text back to its source location in the PDF |

### 6.5 Assumptions and Uncertainties

- **Needs confirmation:** The exact Supabase schema (table definitions, foreign keys) was inferred from service files but not directly inspected from migration files.
- **Needs confirmation:** The exact Azure DI API version used and whether structured output mode is always active or conditional.
- **Needs confirmation:** Whether `paragraph_evaluation.py` and `paragraphgenerator.py` in `backend/api/` are actively used or legacy code.
- **Assumption:** `backend/api/groups/router.py` and `backend/api/files/router.py` handle multi-user collaboration features not encountered in the main extraction flow.
- **Assumption:** The `figma/` directory in components is a UI kit reference, not an active integration.
- **Observed:** The `eval-debug` branch (recently merged) adjusted concurrency and retry settings — the current `MAX_ATTEMPTS=1` may reflect a deliberate debugging state rather than a final design decision.
