# Backend Architecture

This document describes the high-level backend architecture, module boundaries, runtime setup, and major control/data flows. Lower-level class, endpoint, and schema details are split into the linked module documents.

## 1. Application entry point

The backend starts from `backend/main.py`.

Key functions:

| Function | Responsibility |
| --- | --- |
| `load_secrets_to_env()` | Loads `backend/core/secrets.toml` or nearby `core/secrets.toml` candidates and writes values into environment variables. Special-cases `Macbook.macbook_llm_base_url` into `MACBOOK_LLM_BASE_URL`. |
| `load_config()` | Loads provider-specific configuration from `backend/core/secrets.toml`, including Azure OpenAI, Azure Document Intelligence, Vertex/Gemini, Anthropic, and Google credentials. |
| `_setup_otel(app)` | Enables OpenTelemetry FastAPI instrumentation if `OTLP_ENDPOINT` is configured. |
| `lifespan(app)` | Sets the default asyncio thread pool to 64 workers so provider calls delegated through `asyncio.to_thread()` do not bottleneck on the default small pool. |
| `create_app()` | Creates the FastAPI app, installs metrics, tracing, CORS, exception handling, observability middleware, and all routers. |

Router registration happens in `create_app()` and is intentionally ordered. The auth proxy router is mounted first so `/api/auth/*` traffic is forwarded to the Better Auth sidecar before other auth routes are considered.

## 2. Runtime layers

```text
Browser / frontend
        |
        | HTTP / JSON / multipart upload
        v
FastAPI app (`backend/main.py`)
        |
        +-- core middleware/auth/config/logging
        |
        +-- API routers (`backend/api/*`)
        |       |
        |       v
        +-- service layer (`backend/services/*`)
        |       |
        |       +-- SQLAlchemy DB service
        |       +-- document processors and blob storage
        |       +-- LLM provider clients
        |       +-- evaluation queue/adapters/metrics
        |       +-- sessions/groups/templates services
        |
        v
PostgreSQL + Azure Blob Storage + external model/parser providers
```

## 3. Package responsibilities

### `backend/core/`

Core cross-cutting concerns:

- `auth.py` validates Better Auth sessions against the DB.
- `config.py` maps `secrets.toml` values into environment variables.
- `dependencies.py` re-exports auth dependencies.
- `middleware.py` configures CORS.
- `logging_config.py` configures structlog JSON logging, file logging, and optional Loki shipping.

### `backend/api/`

FastAPI routers. Routers translate HTTP input into Pydantic request models or primitive parameters, call services, and map exceptions to HTTP responses.

Major router groups:

- auth proxy and login history;
- file upload/download/listing;
- document processing, content, analysis, figures, tables;
- extraction and paragraph generation;
- evaluation and background evaluation jobs;
- sessions and shared sessions;
- groups and memberships;
- templates and folders;
- server health, config, models, telemetry, and logs;
- chat query endpoint.

See [02-api-surface.md](02-api-surface.md) and [appendices/api-endpoint-index.md](appendices/api-endpoint-index.md).

### `backend/models/`

SQLAlchemy ORM models and database helpers. These classes define the physical data model used by the service layer.

Important groups:

- Better Auth tables: `User`, `AuthSession`, `Account`, `Verification`.
- Workflow tables: `AppSession`, `Document`, `ExtractionResult`, `EvaluationResult`.
- Collaboration: `Group`, `UserGroup`.
- Templates: `TemplateFolder`, `PromptTemplate`, `TemplateVersion`, `TemplatePermission`.
- Preferences and audit: `UserPreferences`, `LoginHistory`, `UserPromptTemplate`.
- Evaluation jobs: `EvalJobRecord`.

See [03-data-models.md](03-data-models.md).

### `backend/schemas/`

Pydantic models used for API input/output and session aggregates. These are separate from ORM models so HTTP contracts can remain explicit even when the database representation changes.

See [04-schemas.md](04-schemas.md).

### `backend/services/`

Domain and infrastructure services:

| Subpackage | Responsibility |
| --- | --- |
| `database/` | SQLAlchemy persistence access layer. |
| `session/` | Session orchestration and DB-to-Pydantic conversion. |
| `document/` | Upload organization, parser orchestration, artifact access, bbox normalization. |
| `storage/` | Azure Blob Storage wrapper. |
| `llm/` | Provider-specific LLM clients and routing façade. |
| `evaluation/` | DeepEval adapters, metric factories, result storage, background queue. |
| `groups/` | Group and membership authorization/business logic. |
| `templates/` | Prompt template CRUD, folders, permissions, versions, forks. |
| `telemetry/` | Cost and session metrics tracking. |

## 4. Main data flows

### 4.1 Authenticated request flow

```text
Frontend request
  -> Authorization: Bearer <Better Auth session token>
  -> FastAPI route with Depends(get_current_user)
  -> core.auth.get_current_user()
  -> query AuthSession + User from PostgreSQL
  -> optional ALLOWED_EMAILS check
  -> route receives current_user dict
```

Returned user dict contains `id`, `email`, `name`, `image`, and `is_admin`.

### 4.2 Upload and processing flow

```text
POST /api/upload
  -> OrganizedFileService.save_uploaded_file()
  -> SHA-256 file hash
  -> blob: global/{hash}/original.{ext}
  -> blob metadata: global/{hash}/metadata.json
  -> optional Document DB row

POST /api/documents/process/file/{file_hash}
  -> OrganizedFileService cache check
  -> DocumentService / processor orchestration
  -> Azure Document Intelligence or Docling
  -> local /tmp/summarization/{hash}/processed/{processor}/...
  -> sync processed tree to blob
  -> Document DB processing metadata update
```

See [05-document-processing.md](05-document-processing.md).

### 4.3 Extraction flow

```text
POST /api/extract
  -> DocumentService.get_markdown_content()
  -> optional figure context assembly
  -> LLMService.extract_entities_from_markdown()
  -> provider client call
  -> normalize response/meta/cost
  -> optional bbox matching against raw analysis
  -> SessionService.add_extraction_result_fast()
  -> extraction_results upsert
```

See [07-extraction-flow.md](07-extraction-flow.md).

### 4.4 Evaluation flow

```text
POST /api/evaluations/evaluate or /evaluate/batch
  -> EvaluationService.create_evaluation_model()
  -> metric factories produce GEval metrics
  -> combined scoring prompt or per-metric fallback
  -> cost tracking from adapter call history
  -> optional JSON file result storage

POST /api/evaluations/jobs
  -> create EvalJob dataclass
  -> persist EvalJobRecord for cross-worker status
  -> background asyncio tasks
  -> SessionService.add_evaluation_result_fast()
```

See [08-evaluation-flow.md](08-evaluation-flow.md).

### 4.5 Restore-view flow

```text
GET /api/sessions/{session_id}/restore-view
  -> SessionService.get_session()
  -> SessionService.build_restore_view()
  -> OrganizedFileService.build_document_view() per document
  -> frontend receives canonical uploadedFiles + processingResult state
```

See [09-session-sharing-groups.md](09-session-sharing-groups.md).

## 5. Dependency direction

The intended dependency direction is:

```text
api -> services -> models/storage/provider SDKs
schemas -> api/services
core -> app/api/services as dependencies
```

Important exceptions:

- `services.session` imports Pydantic schemas to build API-ready aggregate models.
- `services.telemetry.cost_tracker` writes session metrics back through the database service.
- Provider clients return dictionaries rather than shared typed result classes, so `LLMService` and API routers perform normalization.

## 6. Infrastructure assumptions

- PostgreSQL is available through `DATABASE_URL` or `POSTGRES_*` variables.
- Alembic migrations have been applied before serving traffic.
- Azure Blob Storage connection string is present for the organized file service in current upload/processing flows.
- Better Auth sidecar is reachable at the configured local/internal URL for `/api/auth/*` proxying.
- External provider credentials are optional per provider; unavailable providers should be reported as disabled rather than blocking the whole app.
- Production backend container is expected to run one Gunicorn worker per replica because Docling model memory and in-process concurrency controls assume a single process per container.

## 7. Cross-cutting algorithms

### Request observability

`create_app()` installs an HTTP middleware that:

1. assigns a short request ID;
2. binds the request ID into structlog context variables;
3. calls the downstream route;
4. logs method/path/status/duration at severity based on status code;
5. returns `X-Request-Id` in the response.

### Processor selection

`DocumentService._auto_select_processor()` currently selects Azure Document Intelligence if available; otherwise Docling. It does not yet perform content-based routing.

### Model-provider routing

`LLMService` switches by `model_type`. Each branch calls a provider client and records session metrics on successful responses.

### Evaluation scoring

`EvaluationService` prefers a combined scoring prompt for multiple metrics in one judge-model call, then falls back to per-metric concurrent evaluation if parsing fails.

## 8. Related documents

- [02-api-surface.md](02-api-surface.md)
- [03-data-models.md](03-data-models.md)
- [05-document-processing.md](05-document-processing.md)
- [06-llm-layer.md](06-llm-layer.md)
- [08-evaluation-flow.md](08-evaluation-flow.md)
- [11-auth-security-observability.md](11-auth-security-observability.md)
