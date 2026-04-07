# Dockerize & Deploy to Azure — Implementation Record

**Status: Complete**

All tasks below have been implemented. This document serves as an architectural reference for the deployed system.

---

## Architecture

```
                        ┌──────────────────────────────────────┐
                        │         Azure Static Web Apps        │
    Browser ──────────▶│   Frontend (Vite static build)       │
                        │   CDN + SPA fallback routing         │
                        └──────────────┬───────────────────────┘
                                       │ /api/* proxy
                                       ▼
                        ┌──────────────────────────────────────┐
                        │      Azure Container App             │
                        │  ┌──────────────────┐ ┌───────────┐ │
                        │  │ Main Container   │ │ Sidecar   │ │
                        │  │ FastAPI          │ │ Auth      │ │
                        │  │ (Gunicorn +      │ │ (Node.js) │ │
                        │  │  Uvicorn)        │ │           │ │
                        │  │ Port 8001        │ │ Port 3001 │ │
                        │  └───────┬──────────┘ └─────┬─────┘ │
                        │  /api/auth/* proxy  localhost:3001   │
                        │          └────────────────▶ │        │
                        └──────────────┬───────────────────────┘
                                       │
                              ┌────────┴────────┐
                              │                 │
                              ▼                 ▼
               ┌──────────────────────┐  ┌──────────────────────┐
               │  Azure PostgreSQL    │  │  Azure Blob Storage   │
               │  Flexible Server     │  │  (uploaded PDFs +     │
               │  - Better Auth tables│  │   processed outputs)  │
               │  - app data tables   │  └──────────────────────┘
               │  - eval_jobs table   │
               └──────────────────────┘
```

**Key routing note:** In production the frontend sends auth requests to the same SWA origin (empty `VITE_AUTH_URL`). SWA proxies `/api/*` to FastAPI. FastAPI's auth proxy (`api/auth/proxy.py`) forwards `/api/auth/*` to the auth sidecar at `localhost:3001`. No nginx needed.

---

## What Was Built

### Task 1 — Backend Dockerfile (`backend/Dockerfile`, `backend/.dockerignore`)

Multi-stage Python build (builder installs deps with `--prefix=/install`, runtime copies them). Runs **1 Gunicorn worker** with `UvicornWorker`.

**Why 1 worker?** Docling loads heavy ML models (~1-2 GB) per process. Multiple workers would OOM the 2 Gi container and fragment the in-process LLM concurrency semaphores (designed to cap rate-limit exposure across the whole process). Horizontal scaling is done via Container Apps replicas (1-5), not by increasing `WORKERS`.

```
--workers ${WORKERS:-1}
--timeout 300          # long-running document processing jobs
--graceful-timeout 30
```

### Task 2 — Auth Service Dockerfile (`auth-service/Dockerfile`, `auth-service/.dockerignore`)

Multi-stage Node.js build: `npm ci` + `tsc`, then runtime `npm ci --omit=dev` + copy `dist/`. Healthcheck via `node -e "fetch(...)"`.

### Task 3 — docker-compose.yml (local development)

Three services: `db` (postgres:16-alpine), `auth`, `backend`. Backend depends on both being healthy. `WORKERS=1` matches production. Root `.env` (from `.env.example`) supplies Postgres credentials, GitHub OAuth, `BETTER_AUTH_SECRET`, and Azure Storage connection string.

### Task 4 — Frontend: `staticwebapp.config.json`

SPA fallback to `index.html`. Routes `/api/auth/*` and `/api/*` as `anonymous` so auth requests flow through without SWA auth interception.

### Task 5 — Azure Container App manifest (`infra/container-app.yaml`)

Template with `${VAR}` placeholders — **no real secrets committed to git**. Contains both containers (backend + auth sidecar), secrets, ingress, health probes, and HTTP-based autoscaling (1-5 replicas at 50 concurrent requests).

Critical config:
- `WORKERS=1` per replica
- `BETTER_AUTH_URL=https://${STATIC_WEB_APP_URL}` — must be the public SWA URL (not `localhost:3001`) so GitHub OAuth callbacks and cookie domains work correctly
- `BETTER_AUTH_SECRET` wired via `secretRef`

### Task 6 — One-time provisioning script (`infra/provision.sh`)

Validates all required env vars, runs `envsubst` on the template in memory, pipes to `az containerapp create --yaml -`. The resolved YAML with real secrets is never written to disk or git.

### Task 7 — GitHub Actions CI/CD (`.github/workflows/deploy.yml`)

Four jobs: `build-backend`, `build-auth`, `deploy-backend`, `deploy-frontend`.

- Each build job is conditional on changed files (skipped if only auth changed, backend rebuild is skipped, etc.)
- `deploy-backend` runs `az containerapp secret set` on every deploy (idempotent — secret rotation is just update GitHub Secret + redeploy)
- Image updates use `az containerapp update --container-name` (separate for backend and auth-sidecar)
- Frontend build sets `VITE_AUTH_URL=""` and `VITE_API_BASE_URL=""` so all requests go to the same SWA origin in production

**Required GitHub Actions secrets** (Settings → Secrets and variables → Actions):

| Secret | Description |
|--------|-------------|
| `AZURE_CREDENTIALS` | `az ad sp create-for-rbac --sdk-auth` JSON |
| `ACR_NAME` | Azure Container Registry name |
| `ACR_USERNAME` | ACR admin username |
| `ACR_PASSWORD` | ACR admin password |
| `AZURE_RESOURCE_GROUP` | Resource group name |
| `CONTAINER_APP_NAME` | Container App name |
| `DATABASE_URL` | Full Postgres connection string |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `BETTER_AUTH_SECRET` | Better Auth signing secret |
| `AZURE_STORAGE_CONNECTION_STRING` | Blob storage connection string |
| `STATIC_WEB_APP_URL` | SWA hostname (no `https://`) |
| `SWA_DEPLOY_TOKEN` | Static Web Apps deployment token |

### Task 8 — CORS + backend config

`backend/core/middleware.py` reads `CORS_ALLOWED_ORIGINS` (comma-separated). Defaults to `*` for local dev. Production sets it to the SWA URL.

`backend/models/base.py` DB pool: `pool_size=5, max_overflow=10`. With 5 replicas × 15 connections = 75 max — well within Postgres Flexible Server limits.

### Task 9 — Azure Blob Storage (`backend/services/storage/blob_storage.py`)

Activated when `AZURE_STORAGE_CONNECTION_STRING` is set. Falls back to local filesystem when not set (local dev unchanged).

**`BlobStorageClient`** wraps `azure-storage-blob` async SDK:
- `upload_bytes(blob_path, data)` / `download_bytes(blob_path)`
- `upload_directory(blob_prefix, local_dir)` — parallel uploads via `asyncio.gather`
- `from_env()` — returns `None` if env var not set (local dev mode)

**Blob path structure** mirrors local layout:
```
global/{sha256}/original.{ext}
global/{sha256}/processed/{processor}/document.md
global/{sha256}/processed/{processor}/metadata.json
global/{sha256}/processed/{processor}/figures/{filename}
```

**`OrganizedFileService`** updated with dual local/blob paths:
- `get_processing_output_path()` → `/tmp/summarization/{hash}/...` in blob mode (ephemeral per-container scratch space)
- `sync_processing_output_to_blob()` — called after processing completes; uploads the `/tmp/` tree to blob
- `get_processing_file_bytes()` — checks `/tmp/` cache first, downloads from blob if missing (cross-replica cache hits)
- `get_original_file_path()` — downloads to `/tmp/` and caches on first access

**`api/documents/router.py`** — 8 code paths updated to go through service methods instead of direct path reads:
- Cache-hit metadata and content reads → `get_processed_metadata()` / `get_processed_content()`
- Fresh processing metadata write → `update_processed_metadata()`
- Figure serving → filename validation + `get_processing_file_bytes()` + `Response(content=bytes)`
- Figure summary (vision model) → temp file via `mkstemp`, cleaned up after model call
- `raw_analysis.json` read → `get_processing_file_bytes()`

### Task 10 — PostgreSQL-backed job queue

**Problem:** `_JOBS: Dict[str, EvalJob]` is per-process. With Gunicorn or multiple replicas, a job submitted to one worker is invisible to other workers' status-poll requests.

**Solution:** Persist job state to a new `eval_jobs` table. The in-process `_JOBS` dict remains the hot path (zero I/O); DB is the cold path for cross-worker lookups.

New files/changes:
- `backend/models/eval_job.py` — `EvalJobRecord` SQLAlchemy model
- `backend/alembic/versions/b5f8e2a1c9d3_add_eval_jobs_table.py` — migration
- `backend/services/database/sqlalchemy_db_service.py` — 4 new methods: `create_eval_job_record`, `upsert_eval_job_status`, `get_eval_job_status`, `mark_eval_job_cancelled`
- `backend/services/evaluation/job_queue.py`:
  - `submit_job()` fires `_create_job_in_db()` (fire-and-forget `asyncio.create_task`)
  - `_process_job()` fires status=running update on start; `await`s final write on completion
  - `get_job()` checks `_JOBS` first, falls back to `get_eval_job_status()` and wraps in `_JobStatusProxy`
  - `cancel_job()` tries in-process cancel first; if job not local, writes `cancelled` to DB via `mark_eval_job_cancelled()`

Apply migration on deploy: `alembic upgrade head`

### Task 11 — FastAPI auth proxy (`backend/api/auth/proxy.py`)

Replaces the role nginx would have played. Registered first in `main.py` so it matches before the existing `/auth/*` routes.

```
/api/auth/{path:path} → http://localhost:3001/api/auth/{path}
```

Passes all headers including `Set-Cookie`. Adds `X-Forwarded-Host` and `X-Forwarded-Proto` so BetterAuth generates correct callback URLs. Strips hop-by-hop headers. No `follow_redirects` (302s pass through to the browser).

---

## File Map

| File | Purpose |
|------|---------|
| `backend/Dockerfile` | Multi-stage Python build, 1 Gunicorn+Uvicorn worker |
| `backend/.dockerignore` | Excludes secrets.toml, .env, venv, uploads |
| `auth-service/Dockerfile` | Multi-stage Node.js build (tsc → dist) |
| `auth-service/.dockerignore` | Excludes node_modules, dist, .env |
| `docker-compose.yml` | Local dev: db + auth + backend |
| `.env.example` | Template for root `.env` (docker-compose vars only) |
| `staticwebapp.config.json` | SWA SPA fallback + anonymous API routes |
| `infra/container-app.yaml` | ACA manifest template with `${VAR}` placeholders |
| `infra/provision.sh` | One-time provisioning via envsubst + az cli |
| `.github/workflows/deploy.yml` | CI: build images, sync secrets, update replicas |
| `backend/services/storage/blob_storage.py` | Azure Blob Storage async client |
| `backend/services/document/organized_file_service.py` | Dual local/blob file operations |
| `backend/services/document/organized_processor.py` | Calls sync_processing_output_to_blob after processing |
| `backend/models/eval_job.py` | EvalJobRecord SQLAlchemy model |
| `backend/alembic/versions/b5f8e2a1c9d3_*.py` | eval_jobs table migration |
| `backend/services/evaluation/job_queue.py` | Job queue with PostgreSQL cross-worker persistence |
| `backend/api/auth/proxy.py` | Transparent /api/auth/* → auth sidecar proxy |
| `backend/core/middleware.py` | CORS from CORS_ALLOWED_ORIGINS env var |
| `backend/models/base.py` | DB pool: size=5, overflow=10 |
