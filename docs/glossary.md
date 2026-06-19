# Glossary

Definitions for project-specific terms, Azure service names, and technical tools used throughout Science-GPT. Terms appear in alphabetical order.

---

## Azure services

**Azure Blob Storage**
Microsoft's cloud object storage service. Science-GPT uses it to store uploaded files and all processed artifacts (markdown, figures, tables) under hash-addressed paths like `global/{file_hash}/processed/{processor}/`. In local development, [Azurite](#azurite) emulates it. See [backend doc 05](backend/05-document-processing.md).

**Azure Container Apps (ACA)**
Azure's serverless container hosting platform. In production, the backend, auth sidecar, and frontend each run as separate ACA services. ACA handles scaling, health checks, and internal networking between the services. See the [deployment plan](superpowers/plans/dockerize-and-deploy.md).

**Azure Container Registry (ACR)**
Azure's private Docker image registry. The GitHub Actions CI/CD pipeline builds Docker images and pushes them to ACR; ACA then pulls from ACR to deploy updated containers.

**Azure Document Intelligence**
Azure's OCR and document understanding service (previously called Form Recognizer). It is one of two document processors available in Science-GPT. It produces structured markdown, extracts tables as HTML, extracts figures as PNG images, and returns bounding-box coordinates for every piece of content. Requires an Azure subscription and credentials in `secrets.toml`. See [backend doc 05](backend/05-document-processing.md).

**Azure OpenAI Service**
Azure's hosted version of OpenAI models (GPT-4o, GPT-4.1, etc.). It is separate from OpenAI's direct API — it requires an Azure deployment name and endpoint in addition to an API key, and is configured under the `azure` provider in `secrets.toml`. See [backend doc 06](backend/06-llm-layer.md).

**Azure Postgres Flexible Server**
Azure's managed PostgreSQL offering. Used as the production database for all application data (sessions, documents, extractions, evaluations, templates, groups). In local development, a plain Postgres container from `docker-compose.yml` is used instead.

**Azure Static Web Apps**
Azure's hosting service for static frontend assets. The React/Vite frontend is built to static HTML/JS/CSS and deployed here in production. Static Web Apps handles global CDN distribution and custom domain configuration.

**Azurite**
A local emulator for Azure Blob Storage that runs as a Docker container. Used in `docker-compose.yml` for local development so engineers don't need an Azure subscription to run the full stack. Data stored in Azurite does not persist to the cloud.

---

## Other tools and frameworks

**Alembic**
A Python database migration tool built for SQLAlchemy. All schema changes to the PostgreSQL database are written as Alembic migration scripts in `backend/alembic/`. Migrations must be applied (`alembic upgrade head`) before the backend can start in a new environment.

**Better Auth**
An open-source authentication library. In Science-GPT it runs as a separate Node.js sidecar service alongside the FastAPI backend. It handles the GitHub OAuth flow, manages session cookies, and stores auth records (users, sessions, accounts) in PostgreSQL. The FastAPI backend proxies all `/api/auth/*` requests to the sidecar. See [backend doc 11](backend/11-auth-security-observability.md) and [frontend doc 02](frontend/02-auth.md).

**DeepEval**
A Python library for evaluating LLM outputs. Science-GPT's evaluation system uses DeepEval's `GEval` metric class to implement the LLM-as-a-judge scoring pattern. The library is installed as a backend dependency and is not exposed directly to the frontend. See [backend doc 08](backend/08-evaluation-flow.md).

**Docling**
An open-source document parsing library (alternative to Azure Document Intelligence). It converts PDFs to markdown, extracts tables, and identifies figures. It can run locally on a GPU for fast processing or connect to a remote Docling server. Unlike Azure DI, Docling has no per-document cost and no external API dependency, but requires more compute resources. See [backend doc 05](backend/05-document-processing.md).

**FastAPI**
The Python async web framework used for the backend API. It handles all HTTP routing, dependency injection (including auth), request validation via Pydantic, and auto-generated OpenAPI documentation at `/docs`. See [backend doc 01](backend/01-architecture.md).

**G-Eval**
An LLM evaluation technique where a separate LLM (the "judge") scores another LLM's output using chain-of-thought reasoning. Science-GPT uses G-Eval through the DeepEval library for four built-in metrics: correctness, completeness, relevance, and safety. The key property of G-Eval is that the judge's scoring criteria can be expressed in plain language, making it easy to add custom metrics. See [backend doc 08](backend/08-evaluation-flow.md) and [frontend doc 07](frontend/07-evaluation.md).

**Gunicorn**
A Python WSGI/ASGI server. In production, the FastAPI backend runs under Gunicorn with Uvicorn workers. One worker process is used per container replica — this is intentional to avoid duplicating heavyweight parser state (Docling models, Azure clients) across multiple processes. See [backend doc 11](backend/11-auth-security-observability.md).

**LGTM stack**
The observability stack: **L**oki (log aggregation), **G**rafana (dashboards), **T**empo (distributed tracing), **M**imir/Prometheus (metrics). Runs as a separate set of Docker containers defined in the `logging/` directory. See [logging README](../logging/README.md).

**OpenTelemetry / OTLP**
A vendor-neutral standard for distributed tracing and telemetry. The backend emits traces in OTLP format to Tempo; the frontend emits browser traces through the `/api/telemetry/traces` proxy endpoint. See [backend doc 11](backend/11-auth-security-observability.md).

**Pydantic**
A Python data validation library. Every FastAPI request body and response body is defined as a Pydantic model — this gives automatic input validation, type coercion, and JSON serialisation. See [backend doc 04](backend/04-schemas.md).

**shadcn/ui**
A React component library built on Radix UI primitives. Provides all base UI components: buttons, dialogs, dropdowns, tables, cards, etc. Components are copied into the project under `frontend/components/ui/` rather than installed as a dependency, so they can be customised directly.

**SQLAlchemy**
A Python ORM (Object-Relational Mapper). All database reads and writes in the backend go through SQLAlchemy model classes defined in `backend/models/`. SQLAlchemy translates Python operations into SQL queries. See [backend doc 03](backend/03-data-models.md).

**Vite**
The build tool and development server for the React frontend. In development it serves the app with hot module replacement; in production it compiles and bundles the TypeScript and React code to static assets for deployment to Azure Static Web Apps.

---

## Project-specific terms

**AppSession**
A saved reviewer workflow session — one record of a reviewer's work: which documents they uploaded, which entities they extracted, and which evaluation results they received. Stored in the `app_sessions` database table. This is different from [AuthSession](#authsession). See [backend doc 09](backend/09-session-sharing-groups.md) and [frontend doc 10](frontend/10-session-history.md).

**AuthSession**
A Better Auth session record — the server-side token that proves a user is logged in. Stored in the `sessions` database table (managed by the Better Auth sidecar). This is different from [AppSession](#appsession). See [backend doc 11](backend/11-auth-security-observability.md).

**Bounding box / bounding region**
The pixel coordinates on a PDF page where a piece of text, figure, or table is located. Both Azure Document Intelligence and Docling return bounding boxes for the content they extract. Science-GPT uses these coordinates to highlight source evidence in the PDF viewer when a reviewer wants to verify an extracted answer. See [backend doc 05](backend/05-document-processing.md).

**DocumentData**
The central TypeScript object in `App.tsx` that holds all in-progress workflow state. It is passed as a prop to every page and updated via `onComplete()` callbacks. See [frontend doc 01](frontend/01-app-shell.md) and the [types reference](frontend/appendices/types-interfaces.md).

**Entity**
A single field a reviewer wants to extract from a document. Each entity has a name (e.g. "Test material") and a prompt (the question or instruction sent to the LLM). A study template is a collection of entities. See [frontend doc 05](frontend/05-study-config.md).

**Evaluation (LLM-as-a-judge)**
The process of scoring an extraction result using a separate LLM call. The judge LLM receives the extraction answer, the entity prompt, and optionally a ground-truth expected answer, then assigns a numeric score (0–1) per metric with reasoning. This is distinct from human evaluation (where a reviewer manually scores the output). See [backend doc 08](backend/08-evaluation-flow.md).

**Extraction result**
The output of one entity extraction: the LLM's answer, source references, token counts, duration, and cost. Stored in the `extraction_results` database table and in `documentData.entities[].extractionsByModel`. See [backend doc 07](backend/07-extraction-flow.md).

**File hash**
The SHA-256 hash of an uploaded file's bytes. Used as the stable, content-addressable identifier for a file throughout the system — as the blob storage path prefix, the database document ID, and the key in frontend state. Two uploads of the identical file produce the same hash, enabling deduplication. See [backend doc 05](backend/05-document-processing.md).

**Organized file service**
The backend service (`OrganizedFileService`) that manages all blob storage operations using hash-addressed paths. It ensures identical files are stored once, syncs local processing artifacts to blob storage after parsing, and resolves the correct artifact paths for a given file hash and processor combination. See [backend doc 05](backend/05-document-processing.md).

**PMRA**
Pest Management Regulatory Agency — a branch of Health Canada responsible for pesticide and chemical safety regulation. PMRA scientific reviewers are the primary users of Science-GPT. See the [product overview](README.md).

**Processor**
The component that converts an uploaded document into structured text, figures, and tables. Two processors are available: [Azure Document Intelligence](#azure-document-intelligence) (cloud-based, higher accuracy, per-document cost) and [Docling](#docling) (open-source, lower cost, GPU-dependent). The processor used is recorded alongside each processed artifact. See [backend doc 05](backend/05-document-processing.md).

**Restore view**
The API response from `GET /api/sessions/{id}/restore-view` that reconstructs the full frontend `DocumentData` state from a saved session. It re-checks artifact availability in blob storage and rebuilds the uploaded files array, allowing the app to resume exactly where a reviewer left off. See [backend doc 09](backend/09-session-sharing-groups.md).

**Template**
A named, versioned set of entity definitions and prompts that can be saved, shared, and reused across reviews. Templates can be personal (user scope), shared with a group (group scope), or visible to all users (global scope). See [backend doc 10](backend/10-template-system.md) and [frontend doc 11](frontend/11-templates.md).

**Template scope**
The visibility setting for a template or folder: `user` (private to the owner), `group` (shared with a specific group), or `global` (visible to all users). Scope controls both who can see the template and who can edit it. See [backend doc 10](backend/10-template-system.md).

**VRAMGuard**
A backend component that controls concurrent access to Docling processing jobs based on available GPU memory. It maintains a queue of waiting jobs, admits them based on per-worker VRAM estimates, and adjusts the estimate upward after OOM errors to prevent repeated crashes. See [backend doc 05](backend/05-document-processing.md).
