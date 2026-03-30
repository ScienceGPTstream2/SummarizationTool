# Diagram Generation Prompts

*These prompts are designed to be pasted directly into an image-generation LLM (GPT-4o image gen, DALL-E 3, Midjourney, Eraser.io, or a diagram-specific tool). Each prompt is self-contained. Generate them in order — they are referenced by number throughout the architecture report.*

---

## Diagram 1

### Title
Full System Architecture — Layered Overview

### Purpose
Show every major component of the system and how they relate to each other, from the user's browser to Supabase. Non-technical stakeholders should immediately understand the system's scope.

### Placement in report
Executive Summary — first visual anchor for the entire report.

### Visual type
Layered architecture diagram (top-to-bottom)

### Image-generation prompt

Create a professional, clean, top-to-bottom layered architecture diagram suitable for a formal technical report. Use a light background with subtle gray layer bands. Use readable sans-serif labels. All arrows should have directional arrowheads and brief labels.

**Layer 1 — User (top):**
Draw a browser icon labeled "Researcher's Browser." Below it, show the React/TypeScript/Vite frontend as a single rounded rectangle labeled "React Frontend (Vite + TypeScript)." Inside this rectangle, show six labeled sub-boxes arranged horizontally: "Upload & Parse," "Document Viewer," "Entity Extraction," "Evaluation," "Results & Export," "Session Metrics."

**Layer 2 — API Boundary (middle):**
Draw a horizontal dashed line labeled "REST API over HTTPS." Below it, draw a vertical rectangle labeled "FastAPI Server (Python, port 8001, 64-thread pool, 25MB max request)." Inside it, list eight labeled sub-boxes arranged in a 2×4 grid: "Auth (Supabase JWT)," "Documents API," "Extractions API," "Evaluations API," "Sessions API," "Templates API," "Groups API," "Server Metrics API."

**Layer 3 — Services (below API):**
Draw a horizontal band labeled "Business Logic / Services." Show five colored boxes: "Document Service (Docling | Azure DI)" in blue, "LLM Service (Azure | Gemini | Anthropic | Llama | MacBook)" in green, "Evaluation Service (DeepEval G-Eval)" in purple, "Session Service" in orange, "Cost Tracker (in-memory)" in yellow.

**Layer 4 — External Systems (bottom):**
Draw three external system boxes: "Supabase (PostgreSQL + Auth + Storage)" in dark blue, "Azure Document Intelligence (cloud OCR)" in light blue, "LLM Providers (Azure OpenAI | Gemini | Anthropic | Llama | local MacBook)" in green.

Draw arrows: Frontend ↔ FastAPI (bidirectional, labeled "REST"). FastAPI Services → Supabase (labeled "persist"). Document Service → Azure DI (labeled "parse PDF"). LLM Service → LLM Providers (labeled "extract / evaluate"). Cost Tracker → Supabase (dashed, labeled "aggregated totals only — detailed records in-memory").

Add a small red annotation box labeled "⚠ In-memory only" pointing to the Cost Tracker box. Keep all labels readable at report print size. No 3D effects.

---

## Diagram 2

### Title
Document Ingestion and Parsing Pipeline

### Purpose
Trace the path a PDF takes from upload to parsed Markdown artifact, including the two processor paths and the filesystem cache layer.

### Placement in report
Section 1.4 (Document Ingestion and Parsing Layer) and Section 2 (Data Flow).

### Visual type
Left-to-right pipeline diagram with conditional branch

### Image-generation prompt

Create a professional left-to-right pipeline diagram for a technical report. White background, clean nodes, directional arrows with labels, readable sans-serif font. Nodes should be rounded rectangles. Decision diamonds should be clearly distinct.

**Pipeline nodes in order (left to right):**

1. **"PDF Upload"** — box with upload icon. Label: "POST /api/upload (FormData, ≤25MB)"
2. **"SHA-256 Hash"** — box. Label: "File hashed → conversion_id"
3. **Diamond: "Cache Hit?"** — decision. "backend/files/global/<hash>/<processor>/"
4. **"Return Cached Artifacts"** — box on the "YES" branch going right. Label: "Returns in <100ms. Includes document.md, metadata.json, raw_analysis.json."
5. On the "NO" branch going down then right, show a **diamond: "Processor Choice?"**
6. Two branches from that diamond:
   - **"Azure Document Intelligence"** (blue box). Label: "Cloud OCR. Returns layout + bboxes + figures. Parallel jobs. Latency: 8–20s/doc."
   - **"Docling"** (orange box). Label: "Local open-source OCR. Serialized (VRAM lock). Latency: 30–60s/doc."
7. Both branches converge at **"Normalize Output"** — box. Label: "parse_duration_seconds (Docling) or conversion_time (Azure DI). Extract page/figure/table counts."
8. **"Write to Cache"** — box. Label: "Writes document.md, raw_analysis.json, metadata.json to filesystem."
9. **"Record Metrics"** — box. Label: "cost_tracker.record_call(). Documents table in Supabase."
10. **"Return to Frontend"** — box. Label: "conversion_id, processor_used, figures_count, tables_count, parse_duration_seconds"

Add a small note below Docling: "⚠ Only one Docling job at a time (VRAM guard serialization lock)."
Add a note on the cache: "Content-addressed: same PDF = same hash = same cache entry regardless of user."
Color-code: Azure path = light blue, Docling path = light orange, cache path = light green.

---

## Diagram 3

### Title
Multi-Model Extraction Fan-Out

### Purpose
Show how a single user action ("Extract All") fans out to dozens of simultaneous LLM calls, how results are aggregated, and where the concurrency limits apply.

### Placement in report
Section 1.5 (LLM Extraction Layer), Section 2.5 (Multi-Provider Fan-Out), and User Story 3.

### Visual type
Swimlane diagram with parallel execution lanes

### Image-generation prompt

Create a professional swimlane diagram for a technical report. The diagram should flow left to right. Use a white background with light gray horizontal bands for each lane. All arrows should have directional arrowheads.

**Swimlanes (top to bottom):**

**Lane 1 — User / Frontend (React):**
Show three nodes: "Select Template (15 entities)" → "Select Models (GPT-4o, Claude, Gemini)" → "Click Extract All" → "Dispatch 45 Concurrent Requests (3 models × 15 entities)"

**Lane 2 — FastAPI Extraction Router:**
Show: "Receive requests" → "Semaphore(48) gate (max 48 concurrent LLM calls)" → "Fetch document.md + figures" → "Build enhanced_markdown" → "Dispatch to LLM Service"

**Lane 3 — LLM Providers (show three vertical columns inside this lane):**
Draw three parallel vertical boxes: "Azure OpenAI (GPT-4o, 120s timeout)" | "Anthropic Claude (Sonnet 4.5, 120s timeout)" | "Google Gemini (2.5 Pro, 120s timeout)". Each receives extraction calls concurrently. Each returns "{extracted, meta, tokens, cost}."

**Lane 4 — Post-Processing:**
Show: "Bounding box matching (raw_analysis.json)" → "Cost injection (pricing.json)" → "Persist to Supabase (sessions/{id}/extractions)"

**Lane 5 — Frontend State Update:**
Show: "Store in entity.extractionsByModel[modelId]" → "Render per-model columns in UI" → "Update Session Metrics widget"

Add vertical dashed lines between the "Dispatch" and "Return" steps in Lane 2 to represent parallelism. Label the parallelism zone: "Wall-clock time ≈ slowest single entity call (~3–8s)."
Add a red annotation box pointing at the Semaphore: "⚠ MacBook models bypass this — FIFO queue, sequential only."

---

## Diagram 4

### Title
Prompt Template Selection and Injection Flow

### Purpose
Show how a user choosing a study type maps to specific entity prompts, how those prompts are combined with document content, and how they reach the LLM.

### Placement in report
Section 1.6 (Prompt Template System) and Section 2 (Data Flow).

### Visual type
Annotated flowchart (top-to-bottom)

### Image-generation prompt

Create a professional annotated flowchart for a technical report. Top-to-bottom layout. White background. Nodes are rounded rectangles. Data/file nodes are parallelograms. Use readable sans-serif labels. Keep annotations in small italic text near relevant nodes.

**Flow (top to bottom):**

1. **"User selects Study Type"** (rounded rect). Label: "e.g., 'Level 1 – Epidemiology'"
2. **"Frontend loads template module"** (rounded rect). Label: "templates/level-1-epidemiology.ts → entity array of 15 items"
3. **"Each entity has:"** (parallelogram). Two bullet points: "name: 'Study Author(s)'" and "prompt: 'Extract the study authors. Input: Smith J... Output: Smith J, et al.'"
4. **"User clicks Extract"** (rounded rect).
5. **"Backend fetches document artifacts"** (rounded rect). Branches into two items: "document.md (full Markdown text)" and "figures metadata (from metadata.json)."
6. **"Build enhanced_markdown"** (rounded rect). Label: "Combine: {document.md} + '--- FIGURES ---' + {figure list}. ~4,000–20,000 tokens total."
7. **"Assemble LLM prompt"** (parallelogram). Show structure:
   - System message: "You are a scientific data extractor..."
   - User message: "{enhanced_markdown}\n\n{entity.prompt}"
8. **"Send to LLM provider"** (rounded rect). Label: "POST to Azure / Gemini / Anthropic API. Temperature: 0.0. max_tokens: 16,096."
9. **"Receive raw response"** (parallelogram). Label: "String or structured JSON depending on model mode."
10. **"Return to frontend"** (rounded rect). Label: "entity.extracted = response text."

Add annotation beside step 3: "⚠ Templates are static TypeScript files — no UI editor, requires code change to modify."
Add annotation beside step 6: "Whole-document injection. Context window limit is a risk for long papers (>30 pages)."
Add annotation beside step 8: "Zero-shot prompts available via *-noshot.ts variants."

---

## Diagram 5

### Title
Evaluation Job Queue — Async Execution and Lifecycle

### Purpose
Show how evaluation jobs are created, dispatched, monitored, and completed, including the concurrency model and cancellation paths.

### Placement in report
Section 1.7 (Evaluation Logic), Section 2.4 (Evaluation Job Detail), and User Story 1.

### Visual type
Sequence diagram with state machine inset

### Image-generation prompt

Create a professional two-part diagram for a technical report. White background, readable sans-serif labels.

**Part A (left, 60% of width) — Sequence Diagram:**
Draw vertical lifelines for: "Frontend (EvaluationPage.tsx)," "FastAPI /api/evaluations/jobs," "job_queue.py (background)," "LLM Provider APIs," "Supabase DB."

Show the following sequence:
1. Frontend → FastAPI: "POST /api/evaluations/jobs {tasks[], providers[], metrics[], threshold}"
2. FastAPI → job_queue: "create_job() + submit_job()"
3. FastAPI → Frontend: "200 {job_id, total, status: pending} (immediate)"
4. job_queue → job_queue: "compute tasks × providers = N work units"
5. job_queue → LLM Provider APIs: "N concurrent eval calls (Global Semaphore 30)"
6. (Loop) Frontend → FastAPI: "GET /api/evaluations/jobs/{id} (every 2s)"
7. FastAPI → Frontend: "{status: running, progress: X/N}"
8. LLM Provider APIs → job_queue: "Return metric scores"
9. job_queue → Supabase DB: "add_evaluation_result_fast() per task"
10. job_queue → FastAPI: "status: completed"
11. FastAPI → Frontend: "{status: completed, results[]}"

Show a cancel path as a dashed arrow: Frontend → FastAPI: "POST /api/evaluations/jobs/{id}/cancel" → job_queue: "cancel all asyncio.Task handles."

**Part B (right, 40% of width) — State Machine:**
Draw EvalJob states as circles connected by arrows:
- "pending" → "running" (label: "job started")
- "running" → "completed" (label: "all tasks done")
- "running" → "cancelled" (label: "cancel request")
- "running" → "failed" (label: "unhandled exception")

Inside "running" state, show small annotation: "Per-job semaphore = max(1, 30 // active_jobs)"

Add a note at bottom: "Job TTL: 1 hour. Eviction by _cleanup_loop() every 10 minutes. ⚠ Jobs not persisted to DB — lost on server restart."

---

## Diagram 6

### Title
Session and State Lifecycle

### Purpose
Show what state lives where — frontend React state, sessionStorage, Supabase DB, in-memory backend, filesystem cache — and what survives a page reload vs. a server restart.

### Placement in report
Section 1.8 (Session and State Management) and Section 4 (Immediate Improvements).

### Visual type
Annotated layered diagram (survival zones)

### Image-generation prompt

Create a professional annotated layered diagram for a technical report. Left-to-right layout with four vertical columns representing storage tiers. White background. Color-code each column differently. Use readable sans-serif labels. Draw horizontal arrows between columns where data flows.

**Column 1 — "React Component State" (light blue):**
List items stacked vertically:
- documentData (files, entities, extractions)
- extractingEntities Set
- fileProcessingStatus
- evaluation job ID (sessionStorage only)

Label at top: **"Lost on page reload"**

**Column 2 — "In-Memory Backend" (light yellow):**
List items stacked vertically:
- CostTracker (CallMetric records)
- EvalJob dict (_JOBS)
- CANCELLED_SESSIONS set
- Active asyncio tasks

Label at top: **"Lost on server restart ⚠"**

**Column 3 — "Filesystem Cache" (light green):**
List items stacked vertically:
- document.md (per conversion_id)
- raw_analysis.json
- metadata.json
- Figure image files

Label at top: **"Survives restarts. Content-addressed."**

**Column 4 — "Supabase PostgreSQL" (light purple):**
List items stacked vertically:
- sessions (aggregated cost, latency)
- documents (parse cost, page count, processor)
- extractions (entity text, model, tokens)
- evaluations (metric scores, provider)
- users / auth

Label at top: **"Fully durable. ✓"**

Draw horizontal arrows:
- React State → In-Memory Backend: "API calls during session"
- In-Memory Backend → Supabase: "write on extraction/eval complete" (solid arrow); "⚠ CallMetric details NOT written" (dashed red arrow)
- Filesystem Cache ← In-Memory Backend: "written on first parse; read on cache hit"
- Supabase → React State: "session restore on page load"

Add a red box at the bottom: "Key reliability gap: CostTracker and EvalJob state lost on restart. Fix: persist both to Supabase."

---

## Diagram 7

### Title
Current vs. Future Architecture: Evolution Toward RAG

### Purpose
Show side-by-side what the system does today vs. what a full RAG architecture would look like, making the migration path intuitive for non-technical stakeholders.

### Placement in report
Section 5 (Future Direction: Toward a Fuller RAG Architecture).

### Visual type
Side-by-side comparative pipeline diagram

### Image-generation prompt

Create a professional side-by-side comparative pipeline diagram for a technical report. White background. Left panel labeled "Current Architecture" with a blue header. Right panel labeled "Future RAG Architecture" with a green header. Both panels use top-to-bottom flow. Use rounded rectangles for process steps, parallelograms for data artifacts, and matching colors where steps are shared.

**Left panel — Current Architecture:**
Steps (top to bottom):
1. "PDF Upload" (gray)
2. "Parse → Markdown + Bounding Boxes" (blue) — note: "Docling or Azure DI"
3. "Whole-document context injection" (blue) — note: "entire document.md + figures sent to LLM"
4. "Entity Extraction (per entity prompt)" (green)
5. "Results → Supabase" (purple)
6. "(Optional) Evaluation via G-Eval" (orange)
7. "Export to Word / Excel" (gray)

Draw a red annotation bracket on step 3: "⚠ Context window risk for long documents. Expensive for multi-entity extraction."

**Right panel — Future RAG Architecture:**
Steps (top to bottom):
1. "PDF Upload" (gray) — same as current
2. "Parse → Markdown + Bounding Boxes" (blue) — same as current
3. "NEW: Chunking & Embedding" (green, highlighted with border) — note: "Split by section heading or token window. Embed with text-embedding-3-small. Store in pgvector (Supabase)."
4. "NEW: Semantic Retrieval" (green, highlighted) — note: "Embed entity prompt → query pgvector → return top-K relevant chunks with source metadata."
5. "Focused context injection" (blue) — note: "Only retrieved chunks sent to LLM. Provenance labels included."
6. "Entity Extraction (per entity prompt)" (green) — same as current
7. "NEW: Retrieval Evaluation (context recall/precision)" (orange, highlighted)
8. "Results → Supabase" (purple) — same as current
9. "(Optional) G-Eval + SME Annotation" (orange)
10. "Export to Word / Excel" (gray) — same as current

Draw green annotation brackets on steps 3, 4, 7: "New in RAG version."
Draw an arrow from the right panel's pgvector box back up to step 4 labeled "Cross-document retrieval (meta-analysis)."

Below both panels, add a migration timeline bar:
"Phase 1: Fix reliability issues → Phase 2: Add pgvector + indexing → Phase 3: Retrieval-first extraction → Phase 4: Multi-doc RAG + SME loop"

---

## Diagram Set Summary

These seven diagrams cover the full narrative arc of the system at four levels of granularity:

1. **Diagrams 1 & 6** give the "what exists where" structural view — scope and persistence boundaries.
2. **Diagrams 2 & 4** trace the two most opaque parts of the pipeline: how a PDF becomes structured text, and how a user choice becomes an LLM call.
3. **Diagram 3** visualizes the system's most commercially differentiating feature: simultaneous multi-model extraction fan-out.
4. **Diagram 5** makes the async evaluation job queue — the system's most complex engineering piece — intuitive to non-engineers.
5. **Diagram 7** closes the presentation with forward momentum: here is where you are, here is where you can go, here is the path.

Together they support a coherent narrative: "We have a strong foundation, we know its limits, and we have a clear path to the next architecture."
