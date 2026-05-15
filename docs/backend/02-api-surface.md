# API Surface Technical Design

This document describes the backend FastAPI API surface by router. It focuses on interface communication: paths, methods, request/response structures, authentication, service dependencies, and important exceptions.

For a compact route-only list, see [appendices/api-endpoint-index.md](appendices/api-endpoint-index.md).

## 1. API architecture

Routers are included from `backend/main.py` in this order:

1. `api.auth.proxy.router`
2. `api.auth.router`
3. `api.files.router`
4. `api.documents.router`
5. `api.extractions.router`
6. `api.evaluations.router`
7. `api.evaluations.jobs_router`
8. `api.server.router`
9. `api.paragraphgenerator.router`
10. `api.paragraph_evaluation.router`
11. `api.sessions.router`
12. `api.groups.router`
13. `api.templates.router`
14. `api.chat.router`

Most application endpoints require `Depends(get_current_user)`. Some file endpoints use `get_optional_user` or no explicit dependency, but still derive access through file hashes or storage lookups.

## 2. Auth proxy and auth endpoints

### `backend/api/auth/proxy.py`

Router tags: `auth-proxy`.

| Method/path | Request | Response | Auth behavior | Purpose |
| --- | --- | --- | --- | --- |
| `/{api/auth/{path:path}}` for all common HTTP methods | Raw forwarded request | Raw proxied response | Proxies Better Auth traffic; `get-session` can be email-allowlist checked | Transparent proxy from FastAPI to Better Auth sidecar. |

Implementation details:

- Forwards `/api/auth/*` to the auth sidecar.
- Preserves relevant headers and `Set-Cookie` behavior.
- Adds forwarded host/proto headers so Better Auth can construct public callback URLs correctly.
- Strips hop-by-hop headers.

### `backend/api/auth/router.py`

Router prefix: `/auth`.

| Method/path | Request | Response | Dependencies | Purpose |
| --- | --- | --- | --- | --- |
| `GET /auth/health` | none | health JSON | `get_current_user` | Auth-protected health check. |
| `POST /auth/history` | current user + request metadata | login-history record/status | `get_current_user` | Records login audit information. |

Service dependencies:

- `core.auth.get_current_user`
- `SQLAlchemyDBService.record_login`

## 3. File endpoints

### `backend/api/files/router.py`

Router prefix: `/api`.

Local response models:

- `FileUploadResponse`
- `UserFileInfo`

| Method/path | Request | Response | Purpose |
| --- | --- | --- | --- |
| `POST /api/upload` | Multipart file upload, optional authenticated user | file hash/path metadata | Validate and store uploaded file through `OrganizedFileService`. |
| `GET /api/files/list` | optional user | list of user file metadata | List files associated with the user. |
| `GET /api/files/{file_id}` | file hash/id | file bytes response | Serve original uploaded file content. |
| `GET /api/files/{file_id}/info` | file hash/id | file metadata and processed flags | Return file metadata and parser availability state. |
| `DELETE /api/files/{file_id}` | file hash/id | status JSON | Delete behavior is stubbed/deferred in current code. |

Important behavior:

- Upload computes or reuses a SHA-256 file hash.
- Storage path follows `global/{file_hash}/original.{ext}` in blob storage.
- Metadata is stored at `global/{file_hash}/metadata.json`.
- Duplicate content returns the same hash and indicates deduplication.

Service dependencies:

- `OrganizedFileService`
- optional auth from `core.auth.get_optional_user`

## 4. Document endpoints

### `backend/api/documents/router.py`

Router prefix: `/api/documents`.

Request model:

- `ProcessFileRequest`
- `ExtractFigureContentRequest`

| Method/path | Request | Response | Purpose |
| --- | --- | --- | --- |
| `GET /api/documents/{document_id}/view` | optional `processor_used` query | canonical document view | Build frontend restore/view state from blob and metadata. |
| `POST /api/documents/process/file/{file_id}` | `ProcessFileRequest` | processing result + document view | Process an uploaded file, using cache when possible. |
| `GET /api/documents/{document_id}/content` | optional `processor_used` query | markdown content JSON | Return processed `document.md`. |
| `GET /api/documents/{document_id}/enhanced-content` | optional `processor_used` query | markdown with figure summaries inserted | Return enhanced markdown content. |
| `GET /api/documents/{document_id}/figures` | document id/file hash | list of figure metadata | Return figures from processor metadata. |
| `GET /api/documents/{document_id}/analysis` | optional `processor_used` query | normalized raw analysis JSON | Return processor raw analysis normalized for frontend. |
| `GET /api/documents/{document_id}/figures/{figure_filename}` | file hash + figure filename | image response | Serve figure image artifact. |
| `POST /api/documents/{document_id}/figures/{figure_id}/generate-summary` | `ExtractFigureContentRequest` | generated figure summary | Run a vision model over a figure and persist summary metadata. |
| `POST /api/documents/{document_id}/figures/{figure_id}/extract-content` | legacy alias | generated figure summary | Backward-compatible alias for figure content extraction. |
| `GET /api/documents/{document_id}/tables/{table_filename}` | file hash + table filename | HTML response | Serve table HTML artifact. |

Important helper functions:

- `camel_to_snake_case()` converts camelCase keys.
- `transform_keys_to_snake_case()` recursively converts nested structures.
- `_generate_figure_summary_with_retry()` handles vision-summary retries.
- `_insert_figure_summaries_inline()` injects figure summaries into markdown.

Service dependencies:

- `DocumentService`
- `OrganizedFileService`
- `LLMService`
- `normalize_bbox_format`
- `cost_tracker`
- SQLAlchemy DB service for document row updates

Key exceptions/status behavior:

- Missing processed artifacts produce 404-style HTTP exceptions.
- Processor failures surface as failed processing JSON or HTTP exceptions depending on path.
- Figure/table filenames are validated before artifact lookup to reduce path traversal risk.

## 5. Extraction endpoint

### `backend/api/extractions/router.py`

Router prefix: `/api`.

Request model:

- `ExtractRequest`
- nested `Entity`

| Method/path | Request | Response | Purpose |
| --- | --- | --- | --- |
| `POST /api/extract` | document conversion id, entities, model config, optional session id | extraction results per entity | Run entity extraction over markdown and persist optional session results. |

Important behavior:

- Loads markdown through `DocumentService`.
- Builds optional figure context from figure metadata and summaries.
- Runs one extraction task per entity concurrently.
- Uses `LLMService.extract_entities_from_markdown()` for provider routing.
- Attempts reference/bounding-box matching where raw analysis and references exist.
- Persists results with `SessionService.add_extraction_result_fast()` when `session_id` is provided.

Service dependencies:

- `DocumentService`
- `LLMService`
- `SessionService`
- Azure/Docling bbox matchers
- `cost_tracker`

Provider map:

- `azure` -> Azure OpenAI style extraction
- `gemini` -> Gemini/Vertex
- `anthropic` -> Anthropic Vertex
- `llama` / `azure-llama`
- `macbook`
- `vllm`

## 6. Paragraph generation and paragraph evaluation

### `backend/api/paragraphgenerator.py`

Router prefix: `/api`.

Request model:

- `ParagraphGenerationRequest`

| Method/path | Request | Response | Purpose |
| --- | --- | --- | --- |
| `POST /api/generate_paragraph` | extracted entities, model config, optional session id | generated paragraph text and metadata | Generate a scientific summary paragraph from extracted entity values. |

Important behavior:

- Routes to `LLMService.generate_paragraph()`.
- Persists paragraph output into session extraction results if `session_id` is provided.
- Uses provider map similar to extraction.

### `backend/api/paragraph_evaluation.py`

Router prefix: `/api/paragraph-evaluation`.

Request model:

- `ParagraphEvalGenerateRequest`

| Method/path | Request | Response | Purpose |
| --- | --- | --- | --- |
| `POST /api/paragraph-evaluation/generate` | session/model/entity information | paragraph ground-truth/evaluation record | Build a deterministic paragraph ground truth from entity values. |

Helper:

- `build_paragraph_ground_truth(entities)` converts entity values into a paragraph-style expected answer.

## 7. Evaluation endpoints

### `backend/api/evaluations/router.py`

Router prefix: `/api/evaluations`.

Request models:

- `EvaluationRequest`
- `BatchEvaluationRequest`
- `CustomMetricRequest`

| Method/path | Request | Response | Purpose |
| --- | --- | --- | --- |
| `POST /api/evaluations/cancel` | `X-Session-Id` header | cancellation status | Mark a session evaluation as cancelled. |
| `POST /api/evaluations/evaluate` | `EvaluationRequest` | `EvaluationResponse`-like dict | Evaluate one extraction. |
| `POST /api/evaluations/evaluate/batch` | `BatchEvaluationRequest` | batch evaluation result | Evaluate multiple extraction outputs. |
| `POST /api/evaluations/evaluate/custom` | `CustomMetricRequest` | custom metric result | Evaluate using caller-provided metric steps. |
| `GET /api/evaluations/results/{evaluation_id}` | evaluation id | stored result JSON | Fetch a result from file-backed evaluation storage. |
| `GET /api/evaluations/results` | none | list of stored results | List stored evaluation outputs. |
| `GET /api/evaluations/metrics/info` | none | metric/provider metadata | Describe built-in metrics and configured providers. |

Service dependencies:

- `EvaluationService`
- cancellation helpers in `services.evaluation.evaluation_service`
- provider configuration from environment variables

### `backend/api/evaluations/jobs.py`

Router prefix: `/api/evaluations/jobs`.

Request models:

- `EvalTaskRequest`
- `ProviderConfigRequest`
- `SubmitJobRequest`

| Method/path | Request | Response | Purpose |
| --- | --- | --- | --- |
| `POST /api/evaluations/jobs` | tasks + providers + session id | job status with job id | Submit background evaluation job. |
| `GET /api/evaluations/jobs/{job_id}` | job id | current job status | Poll in-memory or DB-backed job status. |
| `POST /api/evaluations/jobs/{job_id}/cancel` | job id | cancellation status | Cancel local or cross-worker job. |

Service dependencies:

- `services.evaluation.job_queue.create_job`
- `get_job`
- `cancel_job`
- `EvalJobRecord` persistence through DB service

## 8. Session endpoints

### `backend/api/sessions/router.py`

Router prefix: `/api/sessions`.

Request/response schemas:

- `CreateSessionRequest`
- `UpdateSessionRequest`
- `Session`
- `SessionListResponse`
- local `ShareSessionRequest`

| Method/path | Request | Response | Purpose |
| --- | --- | --- | --- |
| `POST /api/sessions` | `CreateSessionRequest` | `Session` | Create workflow session. |
| `GET /api/sessions` | current user | `SessionListResponse` | List user session summaries. |
| `GET /api/sessions/{session_id}` | session id | `Session` | Fetch full session owned by user, with shared fallback. |
| `GET /api/sessions/{session_id}/restore-view` | session id | restore-view dict | Build frontend restore state. |
| `PATCH /api/sessions/{session_id}` | `UpdateSessionRequest` | session dict | Update config, docs, extractions, evaluations. |
| `DELETE /api/sessions/{session_id}` | session id | deletion status | Delete owned session. |
| `POST /api/sessions/{session_id}/extractions` | `ExtractionResult` | updated session/status | Add extraction result. |
| `POST /api/sessions/{session_id}/evaluations` | `EvaluationResult` | updated session/status | Add evaluation result. |
| `GET /api/sessions/shared/list` | current user | `SessionListResponse` | List sessions shared with user groups. |
| `GET /api/sessions/shared/{session_id}` | session id | `Session` | Fetch shared session. |
| `GET /api/sessions/shared/{session_id}/restore-view` | session id | restore-view dict | Restore shared session view. |
| `POST /api/sessions/{session_id}/share` | group id | status/session | Share owned session with group. |
| `DELETE /api/sessions/{session_id}/share` | session id | status | Remove sharing from owned session. |

Service dependencies:

- `SessionService`
- `SQLAlchemyDBService`
- `OrganizedFileService` indirectly through restore view

## 9. Group endpoints

### `backend/api/groups/router.py`

Router prefix: `/api/groups`.

Local request/response models:

- `CreateGroupRequest`
- `UpdateGroupRequest`
- `AddMemberRequest`
- `UpdateMemberRoleRequest`
- `GroupResponse`
- `GroupDetailResponse`
- `MemberResponse`
- `UserSearchResult`

| Method/path | Request | Response | Purpose |
| --- | --- | --- | --- |
| `GET /api/groups` | current user | list groups | List groups for current user. |
| `POST /api/groups` | group name/description | group | Create group and owner membership. |
| `GET /api/groups/{group_id}` | group id | group detail | Fetch group with members. |
| `PUT /api/groups/{group_id}` | name/description | group | Update group metadata. |
| `DELETE /api/groups/{group_id}` | group id | 204 | Delete group. |
| `GET /api/groups/{group_id}/members` | group id | members | List group members. |
| `POST /api/groups/{group_id}/members` | user id/email + role | member | Add group member. |
| `PUT /api/groups/{group_id}/members/{user_id}` | role | member | Update member role. |
| `DELETE /api/groups/{group_id}/members/{user_id}` | member user id | 204 | Remove member. |
| `GET /api/groups/users/search` | query | users | Search users for group membership. |

Service dependency:

- `GroupService`

Authorization is handled in `GroupService`, including owner/admin/member role rules and system-admin bypass where implemented.

## 10. Template endpoints

### `backend/api/templates/router.py`

Router prefix: `/api/templates`.

Local request/response models:

- `EntityModel`
- `VariableModel`
- `CreateTemplateRequest`
- `UpdateTemplateRequest`
- `SetImmutableRequest`
- `SetPermissionRequest`
- `ForkTemplateRequest`
- `ChangeScopeRequest`
- `CreateFolderRequest`
- `RenameFolderRequest`
- `FolderResponse`
- `TemplateResponse`
- `VersionResponse`
- `PermissionResponse`

Folder endpoints:

| Method/path | Purpose |
| --- | --- |
| `GET /api/templates/folders` | List folders by scope/owner/parent. |
| `POST /api/templates/folders` | Create folder. |
| `PATCH /api/templates/folders/{folder_id}` | Rename folder. |
| `DELETE /api/templates/folders/{folder_id}` | Delete empty folder. |

Template endpoints:

| Method/path | Purpose |
| --- | --- |
| `GET /api/templates` | List accessible templates with filters. |
| `POST /api/templates` | Create template. |
| `GET /api/templates/{template_id}` | Fetch one template. |
| `PUT /api/templates/{template_id}` | Update template and create version snapshot. |
| `DELETE /api/templates/{template_id}` | Delete template. |
| `POST /api/templates/{template_id}/fork` | Copy accessible template into user scope. |
| `PUT /api/templates/{template_id}/scope` | Change template scope. |
| `PUT /api/templates/{template_id}/immutable` | Set immutability flag. |
| `GET /api/templates/{template_id}/versions` | List version history. |
| `POST /api/templates/{template_id}/revert/{version}` | Revert to a previous version. |
| `GET /api/templates/{template_id}/permissions` | List explicit permissions. |
| `POST /api/templates/{template_id}/permissions` | Upsert user permission. |
| `DELETE /api/templates/{template_id}/permissions/{user_id}` | Remove user permission. |

Service dependencies:

- `TemplateService`
- `FolderService`

See [10-template-system.md](10-template-system.md).

## 11. Server, metrics, and model endpoints

### `backend/api/server/router.py`

Router prefix: `/api`.

Local request model:

- `BatchMetricsRequest`

| Method/path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/server/health` | no schema auth | DB and service health check. |
| `POST /api/telemetry/traces` | unauthenticated internal/proxy style | Proxy browser OTLP traces to Tempo endpoint. |
| `POST /api/server/client-error` | unauthenticated report endpoint | Receive frontend client error reports. |
| `GET /api/server-config` | public | Return provider/config flags as `ServerConfig`. |
| `GET /api/models` | authenticated | Return available model catalog across providers. |
| `GET /api/server/session-metrics` | authenticated | Return session cost/latency/call totals. |
| `POST /api/server/session-metrics/load` | authenticated | Load metrics from DB into cost tracker. |
| `DELETE /api/server/session-metrics` | authenticated | Clear in-memory and DB metrics for a session. |
| `POST /api/server/batch-metrics` | authenticated | Record batch metric summary. |
| `GET /api/server/document-metrics` | authenticated | Return document-level metrics. |
| `POST /api/server/benchmark/clear` | authenticated | Clear benchmark/session cache state. |
| `GET /api/server/logs` | authenticated | Return backend logs. |

Service dependencies:

- `LLMService` provider clients indirectly
- `MacbookLLMClient` model discovery/health
- `cost_tracker`
- DB service
- log files under `backend/output/logs`

## 12. Chat endpoint

### `backend/api/chat/router.py`

Router prefix: `/api/chat`.

Request model:

- `ChatQueryRequest`

| Method/path | Request | Response | Purpose |
| --- | --- | --- | --- |
| `POST /api/chat/query` | query, optional `document_markdown`, model config | model answer JSON | General chat endpoint over optional uploaded document markdown context. |

Important behavior:

- Reuses LLM provider logic for a general answer rather than structured entity extraction.
- Frontend can concatenate multiple documents into the single `document_markdown` field.

## 13. Interface conventions

### Authentication

Most protected routes use:

```python
Depends(get_current_user)
```

The dependency returns a dict:

```python
{
  "id": str,
  "email": str,
  "name": Optional[str],
  "image": Optional[str],
  "is_admin": bool
}
```

### Errors

Routers generally use `HTTPException` for expected API errors. `main.py` also installs a global exception handler returning HTTP 500 with `{"detail": str(exc)}` for unhandled errors.

### Response shape style

The backend uses a mixture of:

- Pydantic response models for sessions/groups/templates;
- plain dictionaries for processing, extraction, evaluation, server metrics, and model catalog endpoints;
- binary `Response` objects for files, figures, tables, and telemetry proxying.

This mixed style should be considered part of the current API contract when changing clients.
