# API Endpoint Index

Compact index of backend API endpoints by router. For design details, see [../02-api-surface.md](../02-api-surface.md).

## Auth proxy

| Method | Path | Purpose |
| --- | --- | --- |
| all common methods | `/api/auth/{path:path}` | Proxy Better Auth sidecar endpoints. |

## Auth

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/auth/health` | Auth-protected health check. |
| `POST` | `/auth/history` | Record login history. |

## Files

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/upload` | Upload and deduplicate file. |
| `GET` | `/api/files/list` | List current user's files. |
| `GET` | `/api/files/{file_id}` | Download uploaded file. |
| `GET` | `/api/files/{file_id}/info` | Get file metadata and processing flags. |
| `DELETE` | `/api/files/{file_id}` | Delete file placeholder/stub behavior. |

## Documents

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/documents/{document_id}/view` | Return canonical document view. |
| `POST` | `/api/documents/process/file/{file_id}` | Process uploaded file. |
| `GET` | `/api/documents/{document_id}/content` | Return markdown content. |
| `GET` | `/api/documents/{document_id}/enhanced-content` | Return markdown with figure summaries. |
| `GET` | `/api/documents/{document_id}/figures` | Return figure metadata. |
| `GET` | `/api/documents/{document_id}/analysis` | Return normalized raw analysis. |
| `GET` | `/api/documents/{document_id}/figures/{figure_filename}` | Serve figure image artifact. |
| `POST` | `/api/documents/{document_id}/figures/{figure_id}/generate-summary` | Generate/persist figure summary. |
| `POST` | `/api/documents/{document_id}/figures/{figure_id}/extract-content` | Legacy alias for figure extraction. |
| `GET` | `/api/documents/{document_id}/tables/{table_filename}` | Serve table HTML artifact. |

## Extractions

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/extract` | Extract requested entities from a processed document. |

## Paragraph generation and evaluation

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/generate_paragraph` | Generate paragraph from extracted entities. |
| `POST` | `/api/paragraph-evaluation/generate` | Generate paragraph evaluation/ground-truth record. |

## Evaluations

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/evaluations/cancel` | Cancel session evaluation. |
| `POST` | `/api/evaluations/evaluate` | Evaluate one extraction. |
| `POST` | `/api/evaluations/evaluate/batch` | Evaluate multiple extractions. |
| `POST` | `/api/evaluations/evaluate/custom` | Evaluate with custom metric. |
| `GET` | `/api/evaluations/results/{evaluation_id}` | Fetch stored evaluation result. |
| `GET` | `/api/evaluations/results` | List stored evaluation results. |
| `GET` | `/api/evaluations/metrics/info` | Return metric/provider info. |

## Evaluation jobs

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/evaluations/jobs` | Submit background evaluation job. |
| `GET` | `/api/evaluations/jobs/{job_id}` | Poll job status. |
| `POST` | `/api/evaluations/jobs/{job_id}/cancel` | Cancel job. |

## Sessions

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/sessions` | Create session. |
| `GET` | `/api/sessions` | List user sessions. |
| `GET` | `/api/sessions/{session_id}` | Get full owned session. |
| `GET` | `/api/sessions/{session_id}/restore-view` | Build restore-view payload. |
| `PATCH` | `/api/sessions/{session_id}` | Update session. |
| `DELETE` | `/api/sessions/{session_id}` | Delete session. |
| `POST` | `/api/sessions/{session_id}/extractions` | Add extraction result. |
| `POST` | `/api/sessions/{session_id}/evaluations` | Add evaluation result. |
| `GET` | `/api/sessions/shared/list` | List shared sessions. |
| `GET` | `/api/sessions/shared/{session_id}` | Get shared session. |
| `GET` | `/api/sessions/shared/{session_id}/restore-view` | Build shared restore-view payload. |
| `POST` | `/api/sessions/{session_id}/share` | Share session with group. |
| `DELETE` | `/api/sessions/{session_id}/share` | Unshare session. |

## Groups

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/groups` | List groups. |
| `POST` | `/api/groups` | Create group. |
| `GET` | `/api/groups/{group_id}` | Get group detail. |
| `PUT` | `/api/groups/{group_id}` | Update group. |
| `DELETE` | `/api/groups/{group_id}` | Delete group. |
| `GET` | `/api/groups/{group_id}/members` | List members. |
| `POST` | `/api/groups/{group_id}/members` | Add member. |
| `PUT` | `/api/groups/{group_id}/members/{user_id}` | Update member role. |
| `DELETE` | `/api/groups/{group_id}/members/{user_id}` | Remove member. |
| `GET` | `/api/groups/users/search` | Search users. |

## Templates and folders

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/templates/folders` | List folders. |
| `POST` | `/api/templates/folders` | Create folder. |
| `PATCH` | `/api/templates/folders/{folder_id}` | Rename folder. |
| `DELETE` | `/api/templates/folders/{folder_id}` | Delete folder. |
| `GET` | `/api/templates` | List templates. |
| `POST` | `/api/templates` | Create template. |
| `GET` | `/api/templates/{template_id}` | Get template. |
| `PUT` | `/api/templates/{template_id}` | Update template. |
| `DELETE` | `/api/templates/{template_id}` | Delete template. |
| `POST` | `/api/templates/{template_id}/fork` | Fork template. |
| `PUT` | `/api/templates/{template_id}/scope` | Change template scope. |
| `PUT` | `/api/templates/{template_id}/immutable` | Set immutability. |
| `GET` | `/api/templates/{template_id}/versions` | List versions. |
| `POST` | `/api/templates/{template_id}/revert/{version}` | Revert version. |
| `GET` | `/api/templates/{template_id}/permissions` | List permissions. |
| `POST` | `/api/templates/{template_id}/permissions` | Set permission. |
| `DELETE` | `/api/templates/{template_id}/permissions/{user_id}` | Remove permission. |

## Server and telemetry

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/server/health` | Health check. |
| `POST` | `/api/telemetry/traces` | Proxy browser traces. |
| `POST` | `/api/server/client-error` | Record frontend error. |
| `GET` | `/api/server-config` | Provider/config flags. |
| `GET` | `/api/models` | Available model catalog. |
| `GET` | `/api/server/session-metrics` | Session metrics. |
| `POST` | `/api/server/session-metrics/load` | Load metrics from DB. |
| `DELETE` | `/api/server/session-metrics` | Clear session metrics. |
| `POST` | `/api/server/batch-metrics` | Record batch metrics. |
| `GET` | `/api/server/document-metrics` | Document metrics. |
| `POST` | `/api/server/benchmark/clear` | Clear benchmark cache. |
| `GET` | `/api/server/logs` | Fetch server logs. |

## Chat

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/chat/query` | General chat over optional document markdown. |
