# Data Models Technical Design

> *Everything a reviewer does — uploading a file, running an extraction, saving a session, sharing with a group — gets written to PostgreSQL through one of these 13 ORM models. This document describes every table: what each field stores, its type and constraints, and any gotchas between what the ORM assumes and what the database actually enforces. Read this if you're adding a new feature that needs a new table, or if you're debugging unexpected data in the database.*

This document describes the backend physical data model implemented with SQLAlchemy models in `backend/models/` and Alembic migrations in `backend/alembic/`.

## Visual overview

![Backend data model relationships](images/data-model-relationships.png)

The diagram separates the database into five operational areas. Better Auth owns login identity through `user`, `session`, `account`, and `verification`. Application workflow state starts at `app_sessions`, flows to `documents`, then to `extraction_results`, and finally to `evaluation_results`. `eval_jobs` is intentionally separate from normalized evaluation scores because it tracks background execution status and polling state. Collaboration is handled through `groups` and `user_groups`, while templates use their own scoped records, version snapshots, and optional per-user permission overrides.

## 1. Database infrastructure

### `backend/models/base.py`

| Symbol | Purpose |
| --- | --- |
| `Base` | SQLAlchemy declarative base for all ORM models. |
| `_build_database_url()` | Uses `DATABASE_URL` or constructs a PostgreSQL URL from `POSTGRES_*` variables. Converts asyncpg URLs to sync SQLAlchemy URLs. |
| `get_engine()` | Lazy sync SQLAlchemy engine singleton with pool settings. |
| `get_session_factory()` | Lazy `sessionmaker` singleton. |
| `get_db_session()` | Returns one new SQLAlchemy session. |
| `db_session_scope()` | Context manager for transaction-scoped DB writes with commit/rollback. |

The ORM is synchronous. Async FastAPI handlers call sync DB code directly or through service methods; cost-tracker DB updates are pushed through an executor where needed.

## 2. Auth tables

### `User`

File: `backend/models/user.py`

Table: `user`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `String(36)` | Primary key from Better Auth. |
| `name` | `Text` | Required display name. |
| `email` | `Text` | Required, unique. |
| `email_verified` | `Boolean` | Column name `emailVerified`, Python default `False`. |
| `image` | `Text` | Optional avatar/image URL. |
| `created_at` | `DateTime` | Column name `createdAt`, Python default now. |
| `updated_at` | `DateTime` | Column name `updatedAt`, Python default/onupdate now. |
| `role` | `Text` | Application role, Python default `user`. |
| `is_admin` | `Boolean` | Application admin flag, Python default `False`. |

Associations:

- Referenced by auth/session/account tables and nearly all app-owned records.

### `AuthSession`

Table: `session`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `String(36)` | Primary key. |
| `expires_at` | `DateTime` | Column name `expiresAt`; used for session expiry. |
| `token` | `Text` | Required, unique; matched by `core.auth.get_current_user`. |
| `created_at` / `updated_at` | `DateTime` | Better Auth timestamp columns. |
| `ip_address` | `Text` | Column name `ipAddress`. |
| `user_agent` | `Text` | Column name `userAgent`. |
| `user_id` | `String(36)` | Column name `userId`; logical link to `user.id`. |

### `Account`

Table: `account`

Stores Better Auth account/provider linkage, including OAuth access/refresh/id tokens, token expiry fields, scopes, and optional password field.

### `Verification`

Table: `verification`

Stores Better Auth verification/reset tokens: `identifier`, `value`, expiry, created/updated timestamps.

## 3. Session and document workflow tables

### `AppSession`

File: `backend/models/app_session.py`

Table: `app_sessions`

Represents one user workflow session, not a login session.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `UUID` | Primary key. |
| `user_id` | `String(36)` | FK to `user.id`, cascade delete. |
| `name` | `Text` | Default `Untitled Session`. |
| `status` | `Text` | Default `in_progress`. |
| `last_step` | `Text` | Default `upload`. |
| `configuration` | `JSONB` | Extraction/session config. |
| `evaluation_config` | `JSONB` | Evaluation settings. |
| `files_config` | `JSONB` | Per-file frontend/restore settings. |
| `total_cost` | `Float` | Session-level cost total. |
| `total_latency` | `Float` | Session-level latency total. |
| `total_calls` | `Integer` | Number of recorded calls. |
| `shared_with_group_id` | `UUID` | Optional FK to `groups.id`, set null on group deletion. |
| `shared_by` | `String(36)` | Optional FK to `user.id`. |
| `shared_at` | `DateTime` | Share timestamp. |
| `created_at` / `updated_at` | `DateTime` | ORM timestamps. |

Indexes:

- `idx_app_sessions_user_id`
- `idx_app_sessions_updated_at`
- partial `idx_app_sessions_shared_group` where `shared_with_group_id IS NOT NULL`

### `Document`

File: `backend/models/document.py`

Table: `documents`

Tracks uploaded and processed document metadata.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `UUID` | Primary key. |
| `session_id` | `UUID` | Optional FK to `app_sessions.id`, cascade delete. |
| `user_id` | `String(36)` | FK to `user.id`, cascade delete. |
| `file_hash` | `Text` | SHA-256 content hash; indexed. |
| `filename` | `Text` | Original filename or resolved filename. |
| `file_path` | `Text` | Blob-style or local file path. |
| `study_type` | `Text` | Optional domain/study label. |
| `processor_used` | `Text` | Parser used, e.g. `azure_doc_intelligence` or `docling`. |
| `processing_status` | `Text` | Free-text status, default `pending`. |
| `processing_error` | `Text` | Error message if processing failed. |
| `extracted_text_path` | `Text` | Path to markdown or extracted content artifact. |
| `processed_at` | `DateTime` | Completed timestamp. |
| `parse_cost` | `Float` | Estimated parsing cost. |
| `page_count` | `Integer` | Parsed page count. |
| `parse_duration_seconds` | `Float` | Processing duration. |
| `figure_count` | `Integer` | Parsed figure count. |
| `table_count` | `Integer` | Parsed table count. |
| `created_at` / `updated_at` | `DateTime` | ORM timestamps. |

Indexes:

- `idx_documents_session_id`
- `idx_documents_user_id`
- `idx_documents_file_hash`

### `ExtractionResult`

File: `backend/models/extraction.py`

Table: `extraction_results`

Stores one extracted entity for one document/model combination.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `UUID` | Primary key. |
| `session_id` | `UUID` | FK to `app_sessions.id`, cascade delete. |
| `document_id` | `UUID` | FK to `documents.id`, cascade delete. |
| `entity_name` | `Text` | Requested entity name. |
| `model_id` | `Text` | Provider/model identifier. |
| `extracted_text` | `Text` | Extracted answer text. |
| `bbox_references` | `JSONB` | Matched references/bounding boxes. |
| `status` | `Text` | Free-text status, default `pending`. |
| `error_message` | `Text` | Error text for failed extraction. |
| `extracted_at` | `DateTime` | Completion timestamp. |
| `prompt_tokens` | `Integer` | Provider prompt token count. |
| `completion_tokens` | `Integer` | Provider completion token count. |
| `duration_ms` | `Integer` | Extraction duration. |
| `cost` | `Float` | Estimated extraction cost. |
| `created_at` / `updated_at` | `DateTime` | ORM timestamps. |

Constraints/indexes:

- Unique `(document_id, entity_name, model_id)` as `uq_extraction_doc_entity_model`.
- Indexed by session, document, and entity/model.

Upsert behavior depends on the unique constraint.

### `EvaluationResult`

File: `backend/models/evaluation.py`

Table: `evaluation_results`

Stores one evaluation score for one extraction result, metric, and judge model.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `UUID` | Primary key. |
| `extraction_result_id` | `UUID` | FK to `extraction_results.id`, cascade delete. |
| `metric` | `Text` | Metric name, e.g. correctness, completeness, relevance, safety. |
| `score` | `Float` | Numeric score. |
| `reasoning` | `Text` | Judge explanation. |
| `judge_model` | `Text` | Model that judged the output. |
| `human_score` | `Float` | Optional human override. |
| `ground_truth` | `Text` | Expected answer. |
| `evaluation_cost` | `Float` | Estimated judge-call cost. |
| `evaluation_time` | `Float` | Evaluation duration. |
| `evaluated_at` | `DateTime` | Evaluation timestamp. |
| `created_at` / `updated_at` | `DateTime` | ORM timestamps. |

Constraints/indexes:

- Unique `(extraction_result_id, metric, judge_model)` as `uq_eval_extraction_metric_judge`.
- Indexed by extraction id and judge model.

## 4. Groups and memberships

### `Group`

File: `backend/models/group.py`

Table: `groups`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `UUID` | Primary key. |
| `name` | `Text` | Group name. |
| `description` | `Text` | Optional description. |
| `created_by` | `String(36)` | FK to `user.id`. |
| `created_at` / `updated_at` | `DateTime` | ORM timestamps. |

Indexes:

- `idx_groups_created_by`
- `idx_groups_name`

### `UserGroup`

Table: `user_groups`

Composite primary key:

- `user_id`
- `group_id`

Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `user_id` | `String(36)` | FK to `user.id`, cascade delete. |
| `group_id` | `UUID` | FK to `groups.id`, cascade delete. |
| `role` | `Text` | One of `viewer`, `member`, `admin`, `owner`. |
| `joined_at` | `DateTime` | Join timestamp. |

Constraint:

- `ck_user_groups_role` enforces allowed roles.

## 5. Template system tables

### `TemplateFolder`

File: `backend/models/template.py`

Table: `template_folders`

Supports hierarchical folders scoped to user, group, or global template workspaces.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `UUID` | Primary key. |
| `name` | `Text` | Folder name. |
| `scope` | `Text` | `user`, `group`, or `global`. |
| `owner_user_id` | `String(36)` | User owner for user scope. |
| `owner_group_id` | `UUID` | Group owner for group scope. |
| `parent_id` | `UUID` | Self-FK for hierarchy. |
| `created_by` | `String(36)` | Creator user id. |
| `created_at` / `updated_at` | `DateTime` | ORM timestamps. |

Constraint:

- `ck_template_folders_scope` enforces allowed scope.

### `PromptTemplate`

Table: `prompt_templates`

Stores reusable prompt templates.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `UUID` | Primary key. |
| `name` | `Text` | Template name. |
| `description` | `Text` | Optional description. |
| `study_type` | `Text` | Optional domain/study type. |
| `scope` | `Text` | `user`, `group`, or `global`. |
| `owner_user_id` | `String(36)` | User owner for user scope. |
| `owner_group_id` | `UUID` | Group owner for group scope. |
| `system_prompt` | `Text` | Optional shared system prompt. |
| `entities` | `JSONB` | Entity definitions. |
| `summary_prompt` | `Text` | Optional paragraph/summary prompt. |
| `variables` | `JSONB` | Template variable definitions. |
| `is_immutable` | `Boolean` | Blocks edits when true. |
| `tags` | `ARRAY(Text)` | Search/filter tags. |
| `is_default` | `Boolean` | Default template flag. |
| `version` | `Integer` | Current version number. |
| `folder_id` | `UUID` | Folder association; model does not declare FK. |
| `created_by` | `String(36)` | Creator. |
| `created_at` / `updated_at` | `DateTime` | ORM timestamps. |

Constraint:

- `ck_templates_scope` enforces allowed scope.

### `TemplateVersion`

Table: `template_versions`

Stores snapshots before template updates.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `UUID` | Primary key. |
| `template_id` | `UUID` | FK to `prompt_templates.id`, cascade delete. |
| `version` | `Integer` | Snapshot version. |
| `system_prompt` | `Text` | Snapshot field. |
| `entities` | `JSONB` | Snapshot field. |
| `summary_prompt` | `Text` | Snapshot field. |
| `variables` | `JSONB` | Snapshot field. |
| `changed_by` | `String(36)` | User who caused snapshot. |
| `change_summary` | `Text` | Optional summary. |
| `created_at` | `DateTime` | Snapshot timestamp. |

Constraint:

- Unique `(template_id, version)` as `uq_template_version`.

### `TemplatePermission`

Table: `template_permissions`

Per-user template permission override.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `UUID` | Primary key. |
| `template_id` | `UUID` | FK to `prompt_templates.id`, cascade delete. |
| `user_id` | `String(36)` | FK to `user.id`, cascade delete. |
| `can_read` | `Boolean` | Read override. |
| `can_write` | `Boolean` | Write override. |
| `granted_by` | `String(36)` | User who granted permission. |
| `created_at` | `DateTime` | Grant timestamp. |

Constraint:

- Unique `(template_id, user_id)` as `uq_template_permission`.

## 6. Preferences, login history, and legacy prompt templates

### `UserPreferences`

Table: `user_preferences`

One row per user. Stores default models, default temperature, and arbitrary settings JSON.

### `LoginHistory`

Table: `login_history`

Audit trail with `user_id`, `ip_address`, `user_agent`, and `login_at`.

### `UserPromptTemplate`

Table: `user_prompt_templates`

Legacy user-scoped prompt templates. Unique `(user_id, name, entity_name)`.

## 7. Evaluation jobs

### `EvalJobRecord`

File: `backend/models/eval_job.py`

Table: `eval_jobs`

Persists background evaluation job state so polling can work across workers/replicas.

| Field | Type | Notes |
| --- | --- | --- |
| `job_id` | `Text` | Primary key. |
| `session_id` | `Text` | Associated session id. |
| `user_id` | `Text` | Owner/requester user id. |
| `status` | `Text` | pending/running/completed/cancelled/failed style status. |
| `progress` | `Integer` | Completed task count. |
| `total` | `Integer` | Total task count. |
| `results` | `JSONB` | Serialized task results. |
| `errors` | `JSONB` | Serialized errors. |
| `error` | `Text` | Top-level failure message. |
| `created_at` | `DateTime(timezone=True)` | Creation timestamp. |
| `completed_at` | `DateTime(timezone=True)` | Completion timestamp. |

Indexes:

- `idx_eval_jobs_status`
- `idx_eval_jobs_user_id`

## 8. Alembic migrations

### Initial schema

`backend/alembic/versions/03069a8f5e8c_initial_schema.py` creates:

- Better Auth tables: `account`, `session`, `user`, `verification`.
- Collaboration and preferences: `groups`, `user_groups`, `user_preferences`, `login_history`, `user_prompt_templates`.
- Workflow tables: `app_sessions`, `documents`, `extraction_results`, `evaluation_results`.
- Template tables: `template_folders`, `prompt_templates`, `template_versions`, `template_permissions`.

### Eval jobs migration

`backend/alembic/versions/b5f8e2a1c9d3_add_eval_jobs_table.py` creates `eval_jobs` with server defaults for `status`, `progress`, and `total`.

## 9. Important model-vs-migration notes

Some defaults are Python-side ORM defaults, not database server defaults. Direct SQL inserts may behave differently from ORM inserts unless callers provide values explicitly.

Examples:

- `User.email_verified` has a Python default but no server default in the initial migration.
- `AppSession.status`, `last_step`, config JSON fields, metrics, and timestamps rely on ORM/application defaults.
- `Document.processing_status` and `ExtractionResult.status` are free text and have no DB check constraints.
- `PromptTemplate.entities` is non-null in the model but nullable in the initial migration.
- `PromptTemplate.folder_id` is used as a logical association but no FK is declared in the model.
- `EvalJobRecord.results` and `errors` have Python defaults but no JSON server defaults in the migration.

These are not necessarily bugs, but they are important implementation constraints for tests and direct DB scripts.

## 10. Relationship summary

```text
user
  -> session / account / verification       Better Auth
  -> app_sessions                           workflow ownership
  -> documents                              uploaded/processed docs
  -> groups.created_by                      group creator
  -> user_groups                            group membership
  -> prompt_templates / template_folders    template ownership/creation
  -> template_permissions                   explicit permissions
  -> user_preferences / login_history       settings/audit

app_sessions
  -> documents
  -> extraction_results

extraction_results
  -> evaluation_results

groups
  -> user_groups
  -> app_sessions.shared_with_group_id
  -> group-scoped templates/folders

prompt_templates
  -> template_versions
  -> template_permissions
```
