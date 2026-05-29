# Backend Class Reference

This appendix is a field-oriented reference for classes defined under `backend/`. It complements the compact [class index](class-index.md) and the design documents in the parent folder.

How to read this document:

- **ORM models** list SQLAlchemy columns as they are defined in code. The database-focused explanation lives in [../03-data-models.md](../03-data-models.md).
- **Pydantic and API schemas** list request/response fields, types, and defaults. These are the HTTP-facing contracts.
- **Dataclasses and runtime state** list in-memory job, telemetry, and guard fields.
- **Service/provider classes** usually do not expose schema fields, so this reference lists constructor-created instance attributes and public methods.
- **Scripts and utilities** are included because they are defined under `backend/`, but most are developer tooling rather than production request-path classes.
- Fields are direct fields declared on that class. If a class inherits from another schema, inherited fields are documented on the base class entry.

This file is generated from source-level class definitions and should be updated when fields, schemas, dataclasses, or service constructors change.

## Summary

| Category | Class count |
| --- | --- |
| ORM models | 18 |
| Pydantic and API schemas | 66 |
| Dataclasses and runtime state | 12 |
| Enums | 1 |
| Service and provider classes | 34 |
| Utilities | 1 |
| Scripts and developer tools | 7 |
| Other backend classes | 1 |

## ORM models

### `AppSession`

**File:** `backend/models/app_session.py`  
**Base classes:** `Base`  
**Purpose:** An extraction workflow session. Users create sessions to track

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `UUID(as_uuid=True)` | `primary_key=True, default=uuid.uuid4` | SQLAlchemy column |
| `user_id` | `String(36)` | `ForeignKey("user.id", ondelete="CASCADE"), nullable=False` | SQLAlchemy column |
| `name` | `Text` | `default="Untitled Session"` | SQLAlchemy column |
| `status` | `Text` | `default="in_progress"` | SQLAlchemy column |
| `last_step` | `Text` | `default="upload"` | SQLAlchemy column |
| `configuration` | `JSONB` | `default=dict` | SQLAlchemy column |
| `evaluation_config` | `JSONB` | `default=dict` | SQLAlchemy column |
| `files_config` | `JSONB` | `default=dict` | SQLAlchemy column |
| `total_cost` | `Float` | `default=0.0` | SQLAlchemy column |
| `total_latency` | `Float` | `default=0.0` | SQLAlchemy column |
| `total_calls` | `Integer` | `default=0` | SQLAlchemy column |
| `shared_with_group_id` | `UUID(as_uuid=True)` | `ForeignKey("groups.id", ondelete="SET NULL"), nullable=True` | SQLAlchemy column |
| `shared_by` | `String(36)` | `ForeignKey("user.id"), nullable=True` | SQLAlchemy column |
| `shared_at` | `DateTime` | `nullable=True` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow` | SQLAlchemy column |
| `updated_at` | `DateTime` | `default=datetime.utcnow, onupdate=datetime.utcnow` | SQLAlchemy column |

### `Document`

**File:** `backend/models/document.py`  
**Base classes:** `Base`  
**Purpose:** A document within an extraction session.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `UUID(as_uuid=True)` | `primary_key=True, default=uuid.uuid4` | SQLAlchemy column |
| `session_id` | `UUID(as_uuid=True)` | `ForeignKey("app_sessions.id", ondelete="CASCADE"), nullable=True` | SQLAlchemy column |
| `user_id` | `String(36)` | `ForeignKey("user.id", ondelete="CASCADE"), nullable=False` | SQLAlchemy column |
| `file_hash` | `Text` | `nullable=False` | SQLAlchemy column |
| `filename` | `Text` | `nullable=False` | SQLAlchemy column |
| `file_path` | `Text` | `nullable=True` | SQLAlchemy column |
| `study_type` | `Text` | `nullable=True` | SQLAlchemy column |
| `processor_used` | `Text` | `nullable=True` | SQLAlchemy column |
| `processing_status` | `Text` | `default="pending"` | SQLAlchemy column |
| `processing_error` | `Text` | `nullable=True` | SQLAlchemy column |
| `extracted_text_path` | `Text` | `nullable=True` | SQLAlchemy column |
| `processed_at` | `DateTime` | `nullable=True` | SQLAlchemy column |
| `parse_cost` | `Float` | `nullable=True` | SQLAlchemy column |
| `page_count` | `Integer` | `nullable=True` | SQLAlchemy column |
| `parse_duration_seconds` | `Float` | `nullable=True` | SQLAlchemy column |
| `figure_count` | `Integer` | `nullable=True` | SQLAlchemy column |
| `table_count` | `Integer` | `nullable=True` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow` | SQLAlchemy column |
| `updated_at` | `DateTime` | `default=datetime.utcnow, onupdate=datetime.utcnow` | SQLAlchemy column |

### `EvalJobRecord`

**File:** `backend/models/eval_job.py`  
**Base classes:** `Base`  
**Purpose:** Persisted snapshot of an EvalJob's status and results.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `job_id` | `Text` | `primary_key=True` | SQLAlchemy column |
| `session_id` | `Text` | `nullable=True` | SQLAlchemy column |
| `user_id` | `Text` | `nullable=True` | SQLAlchemy column |
| `status` | `Text` | `nullable=False, default="pending"` | SQLAlchemy column |
| `progress` | `Integer` | `nullable=False, default=0` | SQLAlchemy column |
| `total` | `Integer` | `nullable=False, default=0` | SQLAlchemy column |
| `results` | `JSONB` | `nullable=True, default=list` | SQLAlchemy column |
| `errors` | `JSONB` | `nullable=True, default=list` | SQLAlchemy column |
| `error` | `Text` | `nullable=True` | SQLAlchemy column |
| `created_at` | `DateTime(timezone=True)` | `nullable=True` | SQLAlchemy column |
| `completed_at` | `DateTime(timezone=True)` | `nullable=True` | SQLAlchemy column |

### `EvaluationResult`

**File:** `backend/models/evaluation.py`  
**Base classes:** `Base`  
**Purpose:** An evaluation score for an extraction result.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `UUID(as_uuid=True)` | `primary_key=True, default=uuid.uuid4` | SQLAlchemy column |
| `extraction_result_id` | `UUID(as_uuid=True)` | `ForeignKey("extraction_results.id", ondelete="CASCADE"), nullable=False` | SQLAlchemy column |
| `metric` | `Text` | `nullable=False` | SQLAlchemy column |
| `score` | `Float` | `nullable=True` | SQLAlchemy column |
| `reasoning` | `Text` | `nullable=True` | SQLAlchemy column |
| `judge_model` | `Text` | `nullable=True` | SQLAlchemy column |
| `human_score` | `Float` | `nullable=True` | SQLAlchemy column |
| `ground_truth` | `Text` | `nullable=True` | SQLAlchemy column |
| `evaluation_cost` | `Float` | `nullable=True` | SQLAlchemy column |
| `evaluation_time` | `Float` | `nullable=True` | SQLAlchemy column |
| `evaluated_at` | `DateTime` | `default=datetime.utcnow` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow` | SQLAlchemy column |
| `updated_at` | `DateTime` | `default=datetime.utcnow, onupdate=datetime.utcnow` | SQLAlchemy column |

### `ExtractionResult`

**File:** `backend/models/extraction.py`  
**Base classes:** `Base`  
**Purpose:** An extraction result for a specific entity from a specific model.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `UUID(as_uuid=True)` | `primary_key=True, default=uuid.uuid4` | SQLAlchemy column |
| `session_id` | `UUID(as_uuid=True)` | `ForeignKey("app_sessions.id", ondelete="CASCADE"), nullable=False` | SQLAlchemy column |
| `document_id` | `UUID(as_uuid=True)` | `ForeignKey("documents.id", ondelete="CASCADE"), nullable=False` | SQLAlchemy column |
| `entity_name` | `Text` | `nullable=False` | SQLAlchemy column |
| `model_id` | `Text` | `nullable=False` | SQLAlchemy column |
| `extracted_text` | `Text` | `nullable=True` | SQLAlchemy column |
| `bbox_references` | `JSONB` | `nullable=True` | SQLAlchemy column |
| `status` | `Text` | `default="pending"` | SQLAlchemy column |
| `error_message` | `Text` | `nullable=True` | SQLAlchemy column |
| `extracted_at` | `DateTime` | `nullable=True` | SQLAlchemy column |
| `prompt_tokens` | `Integer` | `nullable=True` | SQLAlchemy column |
| `completion_tokens` | `Integer` | `nullable=True` | SQLAlchemy column |
| `duration_ms` | `Integer` | `nullable=True` | SQLAlchemy column |
| `cost` | `Float` | `nullable=True` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow` | SQLAlchemy column |
| `updated_at` | `DateTime` | `default=datetime.utcnow, onupdate=datetime.utcnow` | SQLAlchemy column |

### `Group`

**File:** `backend/models/group.py`  
**Base classes:** `Base`  
**Purpose:** A user group for sharing sessions and templates.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `UUID(as_uuid=True)` | `primary_key=True, default=uuid.uuid4` | SQLAlchemy column |
| `name` | `Text` | `nullable=False` | SQLAlchemy column |
| `description` | `Text` | `nullable=True` | SQLAlchemy column |
| `created_by` | `String(36)` | `ForeignKey("user.id"), nullable=True` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow` | SQLAlchemy column |
| `updated_at` | `DateTime` | `default=datetime.utcnow, onupdate=datetime.utcnow` | SQLAlchemy column |

### `UserGroup`

**File:** `backend/models/group.py`  
**Base classes:** `Base`  
**Purpose:** User-group membership with roles.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `user_id` | `String(36)` | `ForeignKey("user.id", ondelete="CASCADE"), primary_key=True` | SQLAlchemy column |
| `group_id` | `UUID(as_uuid=True)` | `ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True` | SQLAlchemy column |
| `role` | `Text` | `default="member"` | SQLAlchemy column |
| `joined_at` | `DateTime` | `default=datetime.utcnow` | SQLAlchemy column |

### `UserPreferences`

**File:** `backend/models/preferences.py`  
**Base classes:** `Base`  
**Purpose:** User preferences for default models, temperature, etc.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `UUID(as_uuid=True)` | `primary_key=True, default=uuid.uuid4` | SQLAlchemy column |
| `user_id` | `String(36)` | `ForeignKey("user.id", ondelete="CASCADE"), nullable=False, unique=True` | SQLAlchemy column |
| `default_models` | `JSONB` | `default=list` | SQLAlchemy column |
| `default_temperature` | `Float` | `default=0.0` | SQLAlchemy column |
| `settings` | `JSONB` | `default=dict` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow` | SQLAlchemy column |
| `updated_at` | `DateTime` | `default=datetime.utcnow, onupdate=datetime.utcnow` | SQLAlchemy column |

### `LoginHistory`

**File:** `backend/models/preferences.py`  
**Base classes:** `Base`  
**Purpose:** Login history for audit trail.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `UUID(as_uuid=True)` | `primary_key=True, default=uuid.uuid4` | SQLAlchemy column |
| `user_id` | `String(36)` | `ForeignKey("user.id", ondelete="CASCADE"), nullable=False` | SQLAlchemy column |
| `ip_address` | `Text` | `nullable=True` | SQLAlchemy column |
| `user_agent` | `Text` | `nullable=True` | SQLAlchemy column |
| `login_at` | `DateTime` | `default=datetime.utcnow` | SQLAlchemy column |

### `UserPromptTemplate`

**File:** `backend/models/preferences.py`  
**Base classes:** `Base`  
**Purpose:** Legacy user-scoped prompt templates (simple key-value).

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `UUID(as_uuid=True)` | `primary_key=True, default=uuid.uuid4` | SQLAlchemy column |
| `user_id` | `String(36)` | `ForeignKey("user.id", ondelete="CASCADE"), nullable=False` | SQLAlchemy column |
| `name` | `Text` | `nullable=False` | SQLAlchemy column |
| `entity_name` | `Text` | `nullable=False` | SQLAlchemy column |
| `prompt_content` | `Text` | `nullable=False` | SQLAlchemy column |
| `study_type` | `Text` | `nullable=True` | SQLAlchemy column |
| `system_prompt` | `Text` | `nullable=True` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow` | SQLAlchemy column |
| `updated_at` | `DateTime` | `default=datetime.utcnow, onupdate=datetime.utcnow` | SQLAlchemy column |

### `TemplateFolder`

**File:** `backend/models/template.py`  
**Base classes:** `Base`  
**Purpose:** Folder for organising prompt templates hierarchically.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `UUID(as_uuid=True)` | `primary_key=True, default=uuid.uuid4` | SQLAlchemy column |
| `name` | `Text` | `nullable=False` | SQLAlchemy column |
| `scope` | `Text` | `nullable=False, default="user"` | SQLAlchemy column |
| `owner_user_id` | `String(36)` | `ForeignKey("user.id", ondelete="CASCADE"), nullable=True` | SQLAlchemy column |
| `owner_group_id` | `UUID(as_uuid=True)` | `ForeignKey("groups.id", ondelete="CASCADE"), nullable=True` | SQLAlchemy column |
| `parent_id` | `UUID(as_uuid=True)` | `ForeignKey("template_folders.id", ondelete="CASCADE"), nullable=True` | SQLAlchemy column |
| `created_by` | `String(36)` | `ForeignKey("user.id"), nullable=True` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow` | SQLAlchemy column |
| `updated_at` | `DateTime` | `default=datetime.utcnow, onupdate=datetime.utcnow` | SQLAlchemy column |

### `PromptTemplate`

**File:** `backend/models/template.py`  
**Base classes:** `Base`  
**Purpose:** A prompt template for entity extraction.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `UUID(as_uuid=True)` | `primary_key=True, default=uuid.uuid4` | SQLAlchemy column |
| `name` | `Text` | `nullable=False` | SQLAlchemy column |
| `description` | `Text` | `nullable=True` | SQLAlchemy column |
| `study_type` | `Text` | `nullable=True` | SQLAlchemy column |
| `scope` | `Text` | `nullable=False, default="user"` | SQLAlchemy column |
| `owner_user_id` | `String(36)` | `ForeignKey("user.id", ondelete="CASCADE"), nullable=True` | SQLAlchemy column |
| `owner_group_id` | `UUID(as_uuid=True)` | `ForeignKey("groups.id", ondelete="CASCADE"), nullable=True` | SQLAlchemy column |
| `system_prompt` | `Text` | `nullable=True` | SQLAlchemy column |
| `entities` | `JSONB` | `nullable=False, default=list` | SQLAlchemy column |
| `summary_prompt` | `Text` | `nullable=True` | SQLAlchemy column |
| `variables` | `JSONB` | `default=list` | SQLAlchemy column |
| `is_immutable` | `Boolean` | `default=False` | SQLAlchemy column |
| `tags` | `ARRAY(Text)` | `default=list` | SQLAlchemy column |
| `is_default` | `Boolean` | `default=False` | SQLAlchemy column |
| `version` | `Integer` | `default=1` | SQLAlchemy column |
| `folder_id` | `UUID(as_uuid=True)` | `nullable=True` | SQLAlchemy column |
| `created_by` | `String(36)` | `ForeignKey("user.id"), nullable=True` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow` | SQLAlchemy column |
| `updated_at` | `DateTime` | `default=datetime.utcnow, onupdate=datetime.utcnow` | SQLAlchemy column |

### `TemplateVersion`

**File:** `backend/models/template.py`  
**Base classes:** `Base`  
**Purpose:** Version history for prompt templates.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `UUID(as_uuid=True)` | `primary_key=True, default=uuid.uuid4` | SQLAlchemy column |
| `template_id` | `UUID(as_uuid=True)` | `ForeignKey("prompt_templates.id", ondelete="CASCADE"), nullable=False` | SQLAlchemy column |
| `version` | `Integer` | `nullable=False` | SQLAlchemy column |
| `system_prompt` | `Text` | `nullable=True` | SQLAlchemy column |
| `entities` | `JSONB` | `nullable=False` | SQLAlchemy column |
| `summary_prompt` | `Text` | `nullable=True` | SQLAlchemy column |
| `variables` | `JSONB` | `nullable=True` | SQLAlchemy column |
| `changed_by` | `String(36)` | `ForeignKey("user.id"), nullable=True` | SQLAlchemy column |
| `change_summary` | `Text` | `nullable=True` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow` | SQLAlchemy column |

### `TemplatePermission`

**File:** `backend/models/template.py`  
**Base classes:** `Base`  
**Purpose:** Per-user permission overrides for templates.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `UUID(as_uuid=True)` | `primary_key=True, default=uuid.uuid4` | SQLAlchemy column |
| `template_id` | `UUID(as_uuid=True)` | `ForeignKey("prompt_templates.id", ondelete="CASCADE"), nullable=False` | SQLAlchemy column |
| `user_id` | `String(36)` | `ForeignKey("user.id", ondelete="CASCADE"), nullable=False` | SQLAlchemy column |
| `can_read` | `Boolean` | `default=True` | SQLAlchemy column |
| `can_write` | `Boolean` | `default=False` | SQLAlchemy column |
| `granted_by` | `String(36)` | `ForeignKey("user.id"), nullable=True` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow` | SQLAlchemy column |

### `User`

**File:** `backend/models/user.py`  
**Base classes:** `Base`  
**Purpose:** Better Auth 'user' table.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `String(36)` | `primary_key=True` | SQLAlchemy column |
| `name` | `Text` | `nullable=False` | SQLAlchemy column |
| `email` | `Text` | `nullable=False, unique=True` | SQLAlchemy column |
| `email_verified` | `Boolean` | `default=False, name="emailVerified"` | SQLAlchemy column |
| `image` | `Text` | `nullable=True` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow, name="createdAt"` | SQLAlchemy column |
| `updated_at` | `DateTime` | `default=datetime.utcnow, onupdate=datetime.utcnow, name="updatedAt"` | SQLAlchemy column |
| `role` | `Text` | `default="user"` | SQLAlchemy column |
| `is_admin` | `Boolean` | `default=False` | SQLAlchemy column |

### `AuthSession`

**File:** `backend/models/user.py`  
**Base classes:** `Base`  
**Purpose:** Better Auth 'session' table.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `String(36)` | `primary_key=True` | SQLAlchemy column |
| `expires_at` | `DateTime` | `nullable=False, name="expiresAt"` | SQLAlchemy column |
| `token` | `Text` | `nullable=False, unique=True` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow, name="createdAt"` | SQLAlchemy column |
| `updated_at` | `DateTime` | `default=datetime.utcnow, onupdate=datetime.utcnow, name="updatedAt"` | SQLAlchemy column |
| `ip_address` | `Text` | `nullable=True, name="ipAddress"` | SQLAlchemy column |
| `user_agent` | `Text` | `nullable=True, name="userAgent"` | SQLAlchemy column |
| `user_id` | `String(36)` | `nullable=False, name="userId"` | SQLAlchemy column |

### `Account`

**File:** `backend/models/user.py`  
**Base classes:** `Base`  
**Purpose:** Better Auth 'account' table.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `String(36)` | `primary_key=True` | SQLAlchemy column |
| `account_id` | `Text` | `nullable=False, name="accountId"` | SQLAlchemy column |
| `provider_id` | `Text` | `nullable=False, name="providerId"` | SQLAlchemy column |
| `user_id` | `String(36)` | `nullable=False, name="userId"` | SQLAlchemy column |
| `access_token` | `Text` | `nullable=True, name="accessToken"` | SQLAlchemy column |
| `refresh_token` | `Text` | `nullable=True, name="refreshToken"` | SQLAlchemy column |
| `id_token` | `Text` | `nullable=True, name="idToken"` | SQLAlchemy column |
| `access_token_expires_at` | `DateTime` | `nullable=True, name="accessTokenExpiresAt"` | SQLAlchemy column |
| `refresh_token_expires_at` | `DateTime` | `nullable=True, name="refreshTokenExpiresAt"` | SQLAlchemy column |
| `scope` | `Text` | `nullable=True` | SQLAlchemy column |
| `password` | `Text` | `nullable=True` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow, name="createdAt"` | SQLAlchemy column |
| `updated_at` | `DateTime` | `default=datetime.utcnow, onupdate=datetime.utcnow, name="updatedAt"` | SQLAlchemy column |

### `Verification`

**File:** `backend/models/user.py`  
**Base classes:** `Base`  
**Purpose:** Better Auth 'verification' table.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `String(36)` | `primary_key=True` | SQLAlchemy column |
| `identifier` | `Text` | `nullable=False` | SQLAlchemy column |
| `value` | `Text` | `nullable=False` | SQLAlchemy column |
| `expires_at` | `DateTime` | `nullable=False, name="expiresAt"` | SQLAlchemy column |
| `created_at` | `DateTime` | `default=datetime.utcnow, name="createdAt"` | SQLAlchemy column |
| `updated_at` | `DateTime` | `default=datetime.utcnow, onupdate=datetime.utcnow, name="updatedAt"` | SQLAlchemy column |

## Pydantic and API schemas

### `ChatQueryRequest`

**File:** `backend/api/chat/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `query` | `str` |  | declared field |
| `document_markdown` | `Optional[str]` | `None` | declared field |
| `model_type` | `str` |  | declared field |
| `model_id` | `Optional[str]` | `None` | declared field |
| `deployment` | `Optional[str]` | `None` | declared field |
| `api_version` | `Optional[str]` | `None` | declared field |

### `EvalTaskRequest`

**File:** `backend/api/evaluations/jobs.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `entity_name` | `str` |  | declared field |
| `source_model` | `str` |  | declared field |
| `actual_output` | `str` |  | declared field |
| `extraction_prompt` | `str` |  | declared field |
| `expected_output` | `Optional[str]` | `None` | declared field |
| `file_hash` | `Optional[str]` | `None` | declared field |
| `file_id` | `Optional[str]` | `None` | declared field |

### `ProviderConfigRequest`

**File:** `backend/api/evaluations/jobs.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `provider_id` | `str` | `Field(..., description="e.g. 'azure-gpt4o'")` | Pydantic Field |
| `provider` | `str` | `Field(..., description="'azure_openai' \| 'vertex_ai' \| 'anthropic'")` | Pydantic Field |
| `model_name` | `Optional[str]` | `None` | declared field |
| `deployment` | `Optional[str]` | `None` | declared field |
| `endpoint` | `Optional[str]` | `None` | declared field |
| `api_key` | `Optional[str]` | `None` | declared field |

### `SubmitJobRequest`

**File:** `backend/api/evaluations/jobs.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `session_id` | `str` |  | declared field |
| `tasks` | `List[EvalTaskRequest]` |  | declared field |
| `providers` | `List[ProviderConfigRequest]` |  | declared field |
| `metrics` | `List[str]` | `Field( default=["correctness", "completeness", "relevance", "safety"] )` | Pydantic Field |
| `custom_evaluation_steps` | `Optional[Dict[str, List[str]]]` | `None` | declared field |
| `threshold` | `float` | `Field(default=0.7, ge=0.0, le=1.0)` | Pydantic Field |

### `FileUploadResponse`

**File:** `backend/api/files/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `success` | `bool` |  | declared field |
| `file_hash` | `str` |  | declared field |
| `original_filename` | `str` |  | declared field |
| `file_size` | `int` |  | declared field |
| `is_new` | `bool` |  | declared field |
| `deduplicated` | `bool` |  | declared field |
| `processed` | `dict` | `{}` | declared field |

### `UserFileInfo`

**File:** `backend/api/files/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `file_hash` | `str` |  | declared field |
| `original_filename` | `str` |  | declared field |
| `file_size` | `int` |  | declared field |
| `mime_type` | `str` |  | declared field |
| `created_at` | `str` |  | declared field |
| `processed` | `dict` | `{}` | declared field |

### `CreateGroupRequest`

**File:** `backend/api/groups/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `name` | `str` |  | declared field |
| `description` | `Optional[str]` | `None` | declared field |

### `UpdateGroupRequest`

**File:** `backend/api/groups/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `name` | `Optional[str]` | `None` | declared field |
| `description` | `Optional[str]` | `None` | declared field |

### `AddMemberRequest`

**File:** `backend/api/groups/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `user_id` | `str` |  | declared field |
| `role` | `str` | `"member"` | declared field |

### `UpdateMemberRoleRequest`

**File:** `backend/api/groups/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `role` | `str` |  | declared field |

### `GroupResponse`

**File:** `backend/api/groups/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `str` |  | declared field |
| `name` | `str` |  | declared field |
| `description` | `Optional[str]` |  | declared field |
| `created_by` | `Optional[str]` |  | declared field |
| `created_at` | `str` |  | declared field |
| `updated_at` | `str` |  | declared field |
| `user_role` | `Optional[str]` | `None` | declared field |
| `member_count` | `Optional[int]` | `None` | declared field |

### `MemberResponse`

**File:** `backend/api/groups/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `user_id` | `str` |  | declared field |
| `role` | `str` |  | declared field |
| `joined_at` | `str` |  | declared field |
| `display_name` | `Optional[str]` | `None` | declared field |
| `email` | `Optional[str]` | `None` | declared field |
| `avatar_url` | `Optional[str]` | `None` | declared field |

### `GroupDetailResponse`

**File:** `backend/api/groups/router.py`  
**Base classes:** `GroupResponse`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `members` | `List[MemberResponse]` | `[]` | declared field |

### `UserSearchResult`

**File:** `backend/api/groups/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `user_id` | `str` |  | declared field |
| `display_name` | `Optional[str]` | `None` | declared field |
| `email` | `Optional[str]` | `None` | declared field |
| `avatar_url` | `Optional[str]` | `None` | declared field |

### `ParagraphEvalGenerateRequest`

**File:** `backend/api/paragraph_evaluation.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `session_id` | `str` |  | declared field |
| `file_hash` | `str` |  | declared field |
| `user_id` | `Optional[str]` | `None` | declared field |
| `entity_order` | `Optional[List[str]]` | `None` | declared field |

### `ParagraphGenerationRequest`

**File:** `backend/api/paragraphgenerator.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `entities` | `List[Dict]` |  | declared field |
| `summary_prompt` | `str` |  | declared field |
| `session_id` | `Optional[str]` | `None` | declared field |
| `file_hash` | `Optional[str]` | `None` | declared field |
| `system_prompt` | `Optional[str]` | `None` | declared field |
| `model_type` | `Optional[str]` | `"azure"` | declared field |
| `model_id` | `Optional[str]` | `None` | declared field |
| `deployment` | `Optional[str]` | `None` | declared field |
| `api_version` | `Optional[str]` | `None` | declared field |
| `azure_endpoint` | `Optional[str]` | `None` | declared field |
| `azure_api_key` | `Optional[str]` | `None` | declared field |
| `gemini_api_key` | `Optional[str]` | `None` | declared field |
| `gemini_project_id` | `Optional[str]` | `None` | declared field |
| `gemini_location` | `Optional[str]` | `None` | declared field |
| `max_tokens` | `int` | `8048` | declared field |
| `temperature` | `Optional[float]` | `None` | declared field |

### `BatchMetricsRequest`

**File:** `backend/api/server/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `session_id` | `str` |  | declared field |
| `batch_number` | `int` |  | declared field |
| `batch_latency` | `float` |  | declared field |
| `document_count` | `int` |  | declared field |

### `ShareSessionRequest`

**File:** `backend/api/sessions/router.py`  
**Base classes:** `BaseModel`  
**Purpose:** Request to share a session with a group

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `group_id` | `str` |  | declared field |

### `EntityModel`

**File:** `backend/api/templates/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `name` | `str` |  | declared field |
| `prompt` | `str` |  | declared field |

### `VariableModel`

**File:** `backend/api/templates/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `name` | `str` |  | declared field |
| `description` | `Optional[str]` | `None` | declared field |
| `default` | `Optional[str]` | `None` | declared field |

### `CreateTemplateRequest`

**File:** `backend/api/templates/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `name` | `str` |  | declared field |
| `entities` | `List[EntityModel]` |  | declared field |
| `scope` | `str` | `"user"` | declared field |
| `owner_group_id` | `Optional[str]` | `None` | declared field |
| `description` | `Optional[str]` | `None` | declared field |
| `study_type` | `Optional[str]` | `None` | declared field |
| `system_prompt` | `Optional[str]` | `None` | declared field |
| `summary_prompt` | `Optional[str]` | `None` | declared field |
| `variables` | `Optional[List[VariableModel]]` | `None` | declared field |
| `tags` | `Optional[List[str]]` | `None` | declared field |
| `is_immutable` | `bool` | `False` | declared field |
| `folder_id` | `Optional[str]` | `None` | declared field |

### `UpdateTemplateRequest`

**File:** `backend/api/templates/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `name` | `Optional[str]` | `None` | declared field |
| `description` | `Optional[str]` | `None` | declared field |
| `study_type` | `Optional[str]` | `None` | declared field |
| `system_prompt` | `Optional[str]` | `None` | declared field |
| `entities` | `Optional[List[EntityModel]]` | `None` | declared field |
| `summary_prompt` | `Optional[str]` | `None` | declared field |
| `variables` | `Optional[List[VariableModel]]` | `None` | declared field |
| `tags` | `Optional[List[str]]` | `None` | declared field |
| `is_immutable` | `Optional[bool]` | `None` | declared field |
| `change_summary` | `Optional[str]` | `None` | declared field |
| `folder_id` | `Optional[str]` | `None` | declared field |

### `SetImmutableRequest`

**File:** `backend/api/templates/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `is_immutable` | `bool` |  | declared field |

### `SetPermissionRequest`

**File:** `backend/api/templates/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `user_id` | `str` |  | declared field |
| `can_read` | `bool` | `True` | declared field |
| `can_write` | `bool` | `False` | declared field |

### `ForkTemplateRequest`

**File:** `backend/api/templates/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `new_name` | `Optional[str]` | `None` | declared field |

### `ChangeScopeRequest`

**File:** `backend/api/templates/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `new_scope` | `str` |  | declared field |
| `owner_group_id` | `Optional[str]` | `None` | declared field |

### `CreateFolderRequest`

**File:** `backend/api/templates/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `name` | `str` |  | declared field |
| `scope` | `str` |  | declared field |
| `parent_id` | `Optional[str]` | `None` | declared field |
| `owner_group_id` | `Optional[str]` | `None` | declared field |

### `RenameFolderRequest`

**File:** `backend/api/templates/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `name` | `str` |  | declared field |

### `FolderResponse`

**File:** `backend/api/templates/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `str` |  | declared field |
| `name` | `str` |  | declared field |
| `scope` | `str` |  | declared field |
| `owner_user_id` | `Optional[str]` |  | declared field |
| `owner_group_id` | `Optional[str]` |  | declared field |
| `parent_id` | `Optional[str]` |  | declared field |
| `created_by` | `Optional[str]` |  | declared field |
| `created_at` | `str` |  | declared field |

### `TemplateResponse`

**File:** `backend/api/templates/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `str` |  | declared field |
| `name` | `str` |  | declared field |
| `description` | `Optional[str]` |  | declared field |
| `study_type` | `Optional[str]` |  | declared field |
| `scope` | `str` |  | declared field |
| `owner_user_id` | `Optional[str]` |  | declared field |
| `owner_group_id` | `Optional[str]` |  | declared field |
| `system_prompt` | `Optional[str]` |  | declared field |
| `entities` | `List[Any]` |  | declared field |
| `summary_prompt` | `Optional[str]` |  | declared field |
| `variables` | `Optional[List[Any]]` |  | declared field |
| `tags` | `Optional[List[str]]` |  | declared field |
| `is_immutable` | `bool` |  | declared field |
| `version` | `int` |  | declared field |
| `created_by` | `Optional[str]` |  | declared field |
| `created_at` | `str` |  | declared field |
| `updated_at` | `str` |  | declared field |
| `can_edit` | `Optional[bool]` | `None` | declared field |
| `is_owner` | `Optional[bool]` | `None` | declared field |
| `group_name` | `Optional[str]` | `None` | declared field |
| `folder_id` | `Optional[str]` | `None` | declared field |

### `VersionResponse`

**File:** `backend/api/templates/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `str` |  | declared field |
| `template_id` | `str` |  | declared field |
| `version` | `int` |  | declared field |
| `system_prompt` | `Optional[str]` |  | declared field |
| `entities` | `List[Any]` |  | declared field |
| `summary_prompt` | `Optional[str]` |  | declared field |
| `variables` | `Optional[List[Any]]` |  | declared field |
| `changed_by` | `Optional[str]` |  | declared field |
| `change_summary` | `Optional[str]` |  | declared field |
| `created_at` | `str` |  | declared field |

### `PermissionResponse`

**File:** `backend/api/templates/router.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `str` |  | declared field |
| `template_id` | `str` |  | declared field |
| `user_id` | `str` |  | declared field |
| `can_read` | `bool` |  | declared field |
| `can_write` | `bool` |  | declared field |
| `granted_by` | `Optional[str]` |  | declared field |
| `created_at` | `str` |  | declared field |

### `ProcessFileRequest`

**File:** `backend/schemas/documents.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `processor` | `Optional[ProcessorType]` | `ProcessorType.AUTO` | declared field |
| `extract_figures` | `bool` | `Field( default=True, description="Extract figures/charts from document (Azure Document Intelligence only)", )` | Pydantic Field |
| `batch_number` | `Optional[int]` | `Field( default=None, description="Logical batch identifier (1–99) assigned by the frontend for grouped uploads", )` | Pydantic Field |

### `ExtractFigureContentRequest`

**File:** `backend/schemas/documents.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `model_type` | `str` | `Field( default="gemini", description="LLM model type for OCR extraction (gemini, azure)", )` | Pydantic Field |
| `model_id` | `Optional[str]` | `Field( default=None, description="Specific model ID to use" )` | Pydantic Field |
| `extraction_prompt` | `str` | `Field( default="Extract all textual content, data points, axis labels, legends, and any other readable information from this scientific figure or chart. Include numerical values...` | Pydantic Field |
| `max_tokens` | `int` | `Field(default=2048, description="Maximum tokens in the response")` | Pydantic Field |
| `temperature` | `float` | `Field( default=0.0, description="Sampling temperature for extraction" )` | Pydantic Field |
| `system_message` | `Optional[str]` | `Field( default=None, description="Custom system message for the model" )` | Pydantic Field |

### `FigureExtractionResult`

**File:** `backend/schemas/documents.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `content` | `str` | `Field(description="Extracted textual content from the figure")` | Pydantic Field |
| `model_used` | `str` | `Field(description="Model that was used for extraction")` | Pydantic Field |
| `timestamp` | `str` | `Field(description="ISO timestamp of extraction")` | Pydantic Field |
| `duration` | `float` | `Field(description="Processing time in seconds")` | Pydantic Field |

### `FigureMetadata`

**File:** `backend/schemas/documents.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `id` | `str` | `Field(description="Figure identifier")` | Pydantic Field |
| `page` | `Optional[int]` | `Field( default=None, description="Page number where figure appears" )` | Pydantic Field |
| `caption` | `Optional[str]` | `Field( default=None, description="Figure caption if available" )` | Pydantic Field |
| `image_path` | `Optional[str]` | `Field( default=None, description="Path to figure image file" )` | Pydantic Field |
| `bounding_regions` | `Optional[list]` | `Field( default=None, description="Figure bounding regions" )` | Pydantic Field |
| `extracted_content` | `Optional[FigureExtractionResult]` | `Field( default=None, description="OCR extraction results if available" )` | Pydantic Field |

### `EvaluationRequest`

**File:** `backend/schemas/evaluations.py`  
**Base classes:** `BaseModel`  
**Purpose:** Request schema for evaluating a single entity extraction

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `entity_name` | `str` | `Field(..., description="Name of the entity being extracted")` | Pydantic Field |
| `extraction_prompt` | `str` | `Field(..., description="Prompt used for extraction")` | Pydantic Field |
| `actual_output` | `str` | `Field(..., description="The actual extracted output")` | Pydantic Field |
| `expected_output` | `Optional[str]` | `Field( None, description="Expected/ground truth output (required for correctness/completeness)", )` | Pydantic Field |
| `metrics` | `Optional[List[str]]` | `Field( default=["all"], description="List of metrics to use: 'correctness', 'completeness', 'relevance', 'safety', or 'all'", )` | Pydantic Field |
| `provider` | `str` | `Field( default="azure_openai", description="LLM provider for evaluation: 'azure_openai' or 'vertex_ai'", )` | Pydantic Field |
| `threshold` | `float` | `Field( default=0.5, ge=0.0, le=1.0, description="Score threshold for passing" )` | Pydantic Field |
| `strict_mode` | `bool` | `Field( default=False, description="If True, only perfect scores pass" )` | Pydantic Field |
| `custom_evaluation_steps` | `Optional[Dict[str, List[str]]]` | `Field( None, description="Custom evaluation steps for each metric (e.g., {'correctness': ['step1', 'step2']})", )` | Pydantic Field |
| `azure_deployment` | `Optional[str]` | `Field( None, description="Azure OpenAI deployment name" )` | Pydantic Field |
| `azure_endpoint` | `Optional[str]` | `Field(None, description="Azure OpenAI endpoint")` | Pydantic Field |
| `azure_api_key` | `Optional[str]` | `Field(None, description="Azure OpenAI API key")` | Pydantic Field |
| `azure_model_name` | `Optional[str]` | `Field(None, description="Azure OpenAI model name")` | Pydantic Field |
| `vertex_model_name` | `Optional[str]` | `Field( default="gemini-2.5-flash", description="Vertex AI model name" )` | Pydantic Field |
| `vertex_project` | `Optional[str]` | `Field(None, description="GCP project ID")` | Pydantic Field |
| `vertex_location` | `Optional[str]` | `Field( default="us-central1", description="GCP location" )` | Pydantic Field |
| `model_name` | `Optional[str]` | `Field( None, description="Model name for Anthropic providers" )` | Pydantic Field |

### `SingleExtractionEval`

**File:** `backend/schemas/evaluations.py`  
**Base classes:** `BaseModel`  
**Purpose:** Schema for a single extraction in batch evaluation

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `entity_name` | `str` |  | declared field |
| `extraction_prompt` | `str` |  | declared field |
| `actual_output` | `str` |  | declared field |
| `expected_output` | `Optional[str]` | `None` | declared field |

### `BatchEvaluationRequest`

**File:** `backend/schemas/evaluations.py`  
**Base classes:** `BaseModel`  
**Purpose:** Request schema for batch evaluation of multiple extractions

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `extractions` | `List[SingleExtractionEval]` | `Field( ..., description="List of extractions to evaluate" )` | Pydantic Field |
| `metrics` | `Optional[List[str]]` | `Field( default=["all"], description="List of metrics to use" )` | Pydantic Field |
| `custom_evaluation_steps` | `Optional[Dict[str, List[str]]]` | `Field( None, description="Custom evaluation steps for each metric (e.g., {'correctness': ['step1', 'step2']})", )` | Pydantic Field |
| `provider` | `str` | `Field( default="azure_openai", description="LLM provider for evaluation" )` | Pydantic Field |
| `threshold` | `float` | `Field(default=0.5, ge=0.0, le=1.0)` | Pydantic Field |
| `strict_mode` | `bool` | `Field(default=False)` | Pydantic Field |
| `azure_deployment` | `Optional[str]` | `None` | declared field |
| `azure_endpoint` | `Optional[str]` | `None` | declared field |
| `azure_api_key` | `Optional[str]` | `None` | declared field |
| `azure_model_name` | `Optional[str]` | `None` | declared field |
| `vertex_model_name` | `Optional[str]` | `"gemini-2.5-flash"` | declared field |
| `vertex_project` | `Optional[str]` | `None` | declared field |
| `vertex_location` | `Optional[str]` | `"us-central1"` | declared field |
| `model_name` | `Optional[str]` | `None` | declared field |

### `CustomMetricRequest`

**File:** `backend/schemas/evaluations.py`  
**Base classes:** `BaseModel`  
**Purpose:** Request schema for creating and running a custom G-Eval metric

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `metric_name` | `str` | `Field(..., description="Name of the custom metric")` | Pydantic Field |
| `evaluation_steps` | `List[str]` | `Field( ..., description="List of evaluation steps for the metric" )` | Pydantic Field |
| `entity_name` | `str` | `Field(..., description="Name of the entity being extracted")` | Pydantic Field |
| `extraction_prompt` | `str` | `Field(..., description="Prompt used for extraction")` | Pydantic Field |
| `actual_output` | `str` | `Field(..., description="The actual extracted output")` | Pydantic Field |
| `expected_output` | `Optional[str]` | `None` | declared field |
| `provider` | `str` | `Field(default="azure_openai")` | Pydantic Field |
| `threshold` | `float` | `Field(default=0.5, ge=0.0, le=1.0)` | Pydantic Field |
| `strict_mode` | `bool` | `Field(default=False)` | Pydantic Field |
| `azure_deployment` | `Optional[str]` | `None` | declared field |
| `azure_endpoint` | `Optional[str]` | `None` | declared field |
| `azure_api_key` | `Optional[str]` | `None` | declared field |
| `azure_model_name` | `Optional[str]` | `None` | declared field |
| `vertex_model_name` | `Optional[str]` | `"gemini-2.5-flash"` | declared field |
| `vertex_project` | `Optional[str]` | `None` | declared field |
| `vertex_location` | `Optional[str]` | `"us-central1"` | declared field |

### `MetricResult`

**File:** `backend/schemas/evaluations.py`  
**Base classes:** `BaseModel`  
**Purpose:** Schema for a single metric evaluation result

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `metric_name` | `str` |  | declared field |
| `score` | `float` |  | declared field |
| `threshold` | `float` |  | declared field |
| `success` | `bool` |  | declared field |
| `reason` | `str` |  | declared field |

### `EvaluationResponse`

**File:** `backend/schemas/evaluations.py`  
**Base classes:** `BaseModel`  
**Purpose:** Response schema for evaluation results

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `evaluation_id` | `str` |  | declared field |
| `entity_name` | `str` |  | declared field |
| `provider` | `str` |  | declared field |
| `model` | `str` |  | declared field |
| `timestamp` | `str` |  | declared field |
| `evaluation_time` | `float` |  | declared field |
| `test_case` | `Dict[str, Any]` |  | declared field |
| `metrics` | `List[MetricResult]` |  | declared field |
| `aggregate_score` | `float` |  | declared field |
| `all_passed` | `bool` |  | declared field |
| `threshold` | `float` |  | declared field |
| `strict_mode` | `bool` |  | declared field |
| `status` | `str` |  | declared field |
| `error` | `Optional[str]` | `None` | declared field |

### `BatchEvaluationResponse`

**File:** `backend/schemas/evaluations.py`  
**Base classes:** `BaseModel`  
**Purpose:** Response schema for batch evaluation results

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `batch_id` | `str` |  | declared field |
| `timestamp` | `str` |  | declared field |
| `batch_time` | `float` |  | declared field |
| `total_evaluations` | `int` |  | declared field |
| `successful_evaluations` | `int` |  | declared field |
| `failed_evaluations` | `int` |  | declared field |
| `avg_aggregate_score` | `float` |  | declared field |
| `all_passed` | `bool` |  | declared field |
| `threshold` | `float` |  | declared field |
| `provider` | `str` |  | declared field |
| `results` | `List[Dict[str, Any]]` |  | declared field |

### `Entity`

**File:** `backend/schemas/extractions.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `name` | `str` |  | declared field |
| `prompt` | `str` |  | declared field |
| `extracted` | `Optional[str]` | `None` | declared field |
| `system_prompt` | `Optional[str]` | `None` | declared field |

### `ExtractRequest`

**File:** `backend/schemas/extractions.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `conversion_id` | `str` |  | declared field |
| `session_id` | `Optional[str]` | `None` | declared field |
| `deployment` | `Optional[str]` | `None` | declared field |
| `entities` | `List[Entity]` |  | declared field |
| `api_version` | `Optional[str]` | `None` | declared field |
| `azure_endpoint` | `Optional[str]` | `None` | declared field |
| `azure_api_key` | `Optional[str]` | `None` | declared field |
| `gemini_api_key` | `Optional[str]` | `None` | declared field |
| `gemini_project_id` | `Optional[str]` | `None` | declared field |
| `gemini_location` | `Optional[str]` | `None` | declared field |
| `max_tokens` | `int` | `8024` | declared field |
| `temperature` | `float` | `0.0` | declared field |
| `model_type` | `Optional[str]` | `"azure"` | declared field |
| `model_id` | `Optional[str]` | `None` | declared field |
| `processor_used` | `Optional[str]` | `None` | declared field |

### `ServerConfig`

**File:** `backend/schemas/server.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `is_azure_openai_configured` | `bool` |  | declared field |
| `is_gemini_configured` | `bool` | `False` | declared field |
| `is_azure_document_intelligence_configured` | `bool` | `False` | declared field |
| `is_llama_configured` | `bool` | `False` | declared field |
| `is_macbook_configured` | `bool` | `False` | declared field |
| `is_macbook_healthy` | `bool` | `False` | declared field |

### `SessionEntity`

**File:** `backend/schemas/sessions.py`  
**Base classes:** `BaseModel`  
**Purpose:** Entity configuration within a session

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `name` | `str` |  | declared field |
| `prompt` | `str` |  | declared field |
| `system_prompt` | `Optional[str]` | `None` | declared field |

### `SessionConfiguration`

**File:** `backend/schemas/sessions.py`  
**Base classes:** `BaseModel`  
**Purpose:** Configuration snapshot for a session

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `study_type` | `Optional[str]` | `None` | declared field |
| `selected_models` | `List[str]` | `Field(default_factory=list)` | Pydantic Field |
| `entities` | `List[SessionEntity]` | `Field(default_factory=list)` | Pydantic Field |
| `summary_prompt` | `Optional[str]` | `None` | declared field |
| `paragraph_system_prompt` | `Optional[str]` | `None` | declared field |
| `temperature` | `float` | `0.0` | declared field |
| `model_temperatures` | `Optional[Dict[str, float]]` | `Field( default_factory=dict )` | Pydantic Field |
| `files_config` | `Optional[Dict[str, Any]]` | `Field( default_factory=dict )` | Pydantic Field |
| `evaluation_config` | `Optional[Dict[str, Any]]` | `Field( default_factory=dict )` | Pydantic Field |

### `SessionDocument`

**File:** `backend/schemas/sessions.py`  
**Base classes:** `BaseModel`  
**Purpose:** Document reference within a session

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `file_hash` | `str` |  | declared field |
| `filename` | `str` |  | declared field |
| `id` | `Optional[str]` | `None` | declared field |
| `processor_used` | `Optional[str]` | `None` | declared field |
| `parse_cost` | `Optional[float]` | `None` | declared field |
| `page_count` | `Optional[int]` | `None` | declared field |
| `parse_duration_seconds` | `Optional[float]` | `None` | declared field |
| `figure_count` | `Optional[int]` | `None` | declared field |
| `table_count` | `Optional[int]` | `None` | declared field |

### `ExtractionResult`

**File:** `backend/schemas/sessions.py`  
**Base classes:** `BaseModel`  
**Purpose:** Extraction result for a single entity

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `entity_name` | `str` |  | declared field |
| `model_id` | `str` |  | declared field |
| `document_id` | `Optional[str]` | `None` | declared field |
| `extracted_text` | `Optional[str]` | `None` | declared field |
| `references` | `Optional[List[Dict[str, Any]]]` | `None` | declared field |
| `status` | `Literal["pending", "completed", "error"]` | `"pending"` | declared field |
| `error_message` | `Optional[str]` | `None` | declared field |
| `extracted_at` | `Optional[datetime]` | `None` | declared field |
| `file_hash` | `Optional[str]` | `None` | declared field |
| `prompt_tokens` | `Optional[int]` | `None` | declared field |
| `completion_tokens` | `Optional[int]` | `None` | declared field |
| `duration_ms` | `Optional[int]` | `None` | declared field |
| `cost` | `Optional[float]` | `None` | declared field |

### `SessionMetrics`

**File:** `backend/schemas/sessions.py`  
**Base classes:** `BaseModel`  
**Purpose:** Aggregated session metrics (stored in sessions table)

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `total_cost` | `float` | `0.0` | declared field |
| `total_latency` | `float` | `0.0` | declared field |
| `total_calls` | `int` | `0` | declared field |

### `EvaluationScore`

**File:** `backend/schemas/sessions.py`  
**Base classes:** `BaseModel`  
**Purpose:** Evaluation score from a judge

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `metric` | `str` |  | declared field |
| `score` | `Optional[float]` | `None` | declared field |
| `reasoning` | `Optional[str]` | `None` | declared field |
| `judge_model` | `Optional[str]` | `None` | declared field |
| `human_score` | `Optional[float]` | `None` | declared field |
| `evaluation_cost` | `Optional[float]` | `None` | declared field |
| `evaluation_time` | `Optional[float]` | `None` | declared field |

### `EvaluationResult`

**File:** `backend/schemas/sessions.py`  
**Base classes:** `BaseModel`  
**Purpose:** Evaluation result for an extraction

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `document_id` | `Optional[str]` | `None` | declared field |
| `file_hash` | `Optional[str]` | `None` | declared field |
| `entity_name` | `str` |  | declared field |
| `model_id` | `str` |  | declared field |
| `ground_truth` | `Optional[str]` | `None` | declared field |
| `scores` | `List[EvaluationScore]` | `Field(default_factory=list)` | Pydantic Field |
| `human_score` | `Optional[float]` | `None` | declared field |
| `evaluated_at` | `Optional[datetime]` | `None` | declared field |
| `evaluation_cost` | `Optional[float]` | `None` | declared field |
| `evaluation_time` | `Optional[float]` | `None` | declared field |

### `Session`

**File:** `backend/schemas/sessions.py`  
**Base classes:** `BaseModel`  
**Purpose:** Full session model with configuration, results, and evaluations

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `session_id` | `str` | `Field(default_factory=lambda: str(uuid.uuid4()))` | Pydantic Field |
| `user_id` | `str` |  | declared field |
| `name` | `str` | `"Untitled Session"` | declared field |
| `status` | `Literal["in_progress", "completed"]` | `"in_progress"` | declared field |
| `last_step` | `Optional[str]` | `"upload"` | declared field |
| `evaluation_config` | `Optional[Dict[str, Any]]` | `Field(default_factory=dict)` | Pydantic Field |
| `files_config` | `Optional[Dict[str, Any]]` | `Field(default_factory=dict)` | Pydantic Field |
| `created_at` | `datetime` | `Field(default_factory=datetime.utcnow)` | Pydantic Field |
| `updated_at` | `datetime` | `Field(default_factory=datetime.utcnow)` | Pydantic Field |
| `configuration` | `SessionConfiguration` | `Field(default_factory=SessionConfiguration)` | Pydantic Field |
| `documents` | `List[SessionDocument]` | `Field(default_factory=list)` | Pydantic Field |
| `extraction_results` | `List[ExtractionResult]` | `Field(default_factory=list)` | Pydantic Field |
| `evaluation_results` | `List[EvaluationResult]` | `Field(default_factory=list)` | Pydantic Field |
| `session_metrics` | `Optional[SessionMetrics]` | `None` | declared field |

### `CreateSessionRequest`

**File:** `backend/schemas/sessions.py`  
**Base classes:** `BaseModel`  
**Purpose:** Request to create a new session

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `user_id` | `str` |  | declared field |
| `name` | `Optional[str]` | `"Untitled Session"` | declared field |
| `last_step` | `Optional[str]` | `"upload"` | declared field |
| `configuration` | `Optional[SessionConfiguration]` | `None` | declared field |
| `evaluation_config` | `Optional[Dict[str, Any]]` | `None` | declared field |
| `files_config` | `Optional[Dict[str, Any]]` | `None` | declared field |
| `documents` | `Optional[List[SessionDocument]]` | `None` | declared field |

### `UpdateSessionRequest`

**File:** `backend/schemas/sessions.py`  
**Base classes:** `BaseModel`  
**Purpose:** Request to update an existing session

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `user_id` | `Optional[str]` | `None` | declared field |
| `name` | `Optional[str]` | `None` | declared field |
| `status` | `Optional[Literal["in_progress", "completed"]]` | `None` | declared field |
| `last_step` | `Optional[str]` | `None` | declared field |
| `configuration` | `Optional[SessionConfiguration]` | `None` | declared field |
| `evaluation_config` | `Optional[Dict[str, Any]]` | `None` | declared field |
| `files_config` | `Optional[Dict[str, Any]]` | `None` | declared field |
| `documents` | `Optional[List[SessionDocument]]` | `None` | declared field |
| `extraction_results` | `Optional[List[ExtractionResult]]` | `None` | declared field |
| `evaluation_results` | `Optional[List[EvaluationResult]]` | `None` | declared field |

### `SessionSummary`

**File:** `backend/schemas/sessions.py`  
**Base classes:** `BaseModel`  
**Purpose:** Lightweight session summary for list views

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `session_id` | `str` |  | declared field |
| `name` | `str` |  | declared field |
| `status` | `Literal["in_progress", "completed"]` |  | declared field |
| `created_at` | `datetime` |  | declared field |
| `updated_at` | `datetime` |  | declared field |
| `last_step` | `Optional[str]` | `None` | declared field |
| `study_type` | `Optional[str]` | `None` | declared field |
| `document_count` | `int` |  | declared field |
| `document_names` | `List[str]` | `Field(default_factory=list)` | Pydantic Field |
| `extraction_count` | `int` |  | declared field |
| `evaluation_count` | `int` |  | declared field |
| `shared_by_name` | `Optional[str]` | `None` | declared field |
| `shared_group_name` | `Optional[str]` | `None` | declared field |
| `shared_at` | `Optional[datetime]` | `None` | declared field |
| `owner_user_id` | `Optional[str]` | `None` | declared field |

### `SessionListResponse`

**File:** `backend/schemas/sessions.py`  
**Base classes:** `BaseModel`  
**Purpose:** Response for listing sessions

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `sessions` | `List[SessionSummary]` |  | declared field |
| `total` | `int` |  | declared field |

### `MarkdownReference`

**File:** `backend/services/llm/azure.py`  
**Base classes:** `BaseModel`  
**Purpose:** A reference to a specific section of the markdown that was used

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `text` | `str` | `Field( description="The exact text excerpt from the markdown that was referenced" )` | Pydantic Field |

### `ExtractionResult`

**File:** `backend/services/llm/azure.py`  
**Base classes:** `BaseModel`  
**Purpose:** Structured result containing both the extracted answer and its references

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `answer` | `str` | `Field( description="The extracted information or answer based on the prompt" )` | Pydantic Field |
| `references` | `List[MarkdownReference]` | `Field( description="List of specific text excerpts from the markdown that were used to generate this answer" )` | Pydantic Field |

### `MarkdownReference`

**File:** `backend/services/llm/gemini.py`  
**Base classes:** `BaseModel`  
**Purpose:** A reference to a specific section of the markdown that was used

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `text` | `str` | `Field( description="The exact text excerpt from the markdown that was referenced" )` | Pydantic Field |

### `ExtractionResult`

**File:** `backend/services/llm/gemini.py`  
**Base classes:** `BaseModel`  
**Purpose:** Structured result containing both the extracted answer and its references

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `answer` | `str` | `Field( description="The extracted information or answer based on the prompt" )` | Pydantic Field |
| `references` | `List[MarkdownReference]` | `Field( description="List of specific text excerpts from the markdown that were used to generate this answer" )` | Pydantic Field |

### `MarkdownReference`

**File:** `backend/services/llm/llama.py`  
**Base classes:** `BaseModel`  
**Purpose:** A reference to a specific section of the markdown that was used

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `text` | `str` | `Field( description="The exact text excerpt from the markdown that was referenced" )` | Pydantic Field |

### `ExtractionResult`

**File:** `backend/services/llm/llama.py`  
**Base classes:** `BaseModel`  
**Purpose:** Structured result containing both the extracted answer and its references

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `answer` | `Union[str, Dict[str, Any], List[Any]]` | `Field( description="The extracted information or answer based on the prompt (string, structured data, or list)" )` | Pydantic Field |
| `references` | `List[MarkdownReference]` | `Field( description="List of specific text excerpts from the markdown that were used to generate this answer" )` | Pydantic Field |

### `MarkdownReference`

**File:** `backend/services/llm/vllm.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `text` | `str` | `Field(description="Exact text excerpt from the markdown")` | Pydantic Field |

### `ExtractionResult`

**File:** `backend/services/llm/vllm.py`  
**Base classes:** `BaseModel`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `answer` | `str` | `Field(description="Extracted information or answer")` | Pydantic Field |
| `references` | `List[MarkdownReference]` | `Field( description="Text excerpts used to generate the answer" )` | Pydantic Field |

## Dataclasses and runtime state

### `Config`

**File:** `backend/scripts/evaluate_macbook_models.py`  
**Decorators:** `dataclass`  
**Purpose:** Configuration settings for the evaluation script.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `base_url` | `str` | `"http://macbook1.sciencegpt.ca"` | declared field |
| `api_endpoint` | `str` | `"/api/generate"` | declared field |
| `delay_between_requests` | `int` | `60` | declared field |
| `max_tokens` | `int` | `4096` | declared field |
| `temperature` | `float` | `0.0` | declared field |
| `request_timeout` | `int` | `600` | declared field |
| `project_root` | `Path` | `Path(__file__).resolve().parents[2]` | declared field |
| `model_list_file` | `Path` | `field(default_factory=lambda: Path("macbookmodelnames.csv"))` | dataclass field |
| `prompt_file` | `Path` | `field(default_factory=lambda: Path("prompt.md"))` | dataclass field |
| `test_document_file` | `Path` | `field( default_factory=lambda: Path( "64596011f75ffd2916b1ce50131f3d7cb36c10141e914e435fd5dc0e007b2b52_base.md" ) )` | dataclass field |
| `output_file` | `Path` | `field( default_factory=lambda: Path("model_evaluation_results.xlsx") )` | dataclass field |

**Public methods:** `from_env()`

### `TestResult`

**File:** `backend/scripts/evaluate_macbook_models.py`  
**Decorators:** `dataclass`  
**Purpose:** Result of testing a single model.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `model_name` | `str` |  | declared field |
| `entity_responses` | `Dict[str, str]` |  | declared field |
| `ground_truth` | `Dict[str, str]` |  | declared field |
| `score` | `float` |  | declared field |
| `total_latency_seconds` | `float` |  | declared field |
| `error` | `Optional[str]` | `None` | declared field |

**Public methods:** `to_dict()`

### `EntityPrompt`

**File:** `backend/scripts/evaluate_macbook_models.py`  
**Decorators:** `dataclass`  
**Purpose:** Represents a single entity extraction prompt.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `entity_name` | `str` |  | declared field |
| `prompt_with_examples` | `str` |  | declared field |

### `VRAMStatus`

**File:** `backend/services/document/processors/docling/vram_guard.py`  
**Decorators:** `dataclass`  
**Purpose:** Snapshot of current GPU VRAM and worker state.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `total_mb` | `float` |  | declared field |
| `used_mb` | `float` |  | declared field |
| `free_mb` | `float` |  | declared field |
| `active_workers` | `int` |  | declared field |
| `max_workers` | `int` |  | declared field |
| `can_accept_worker` | `bool` |  | declared field |
| `estimated_per_worker_mb` | `float` |  | declared field |
| `safety_margin_mb` | `float` |  | declared field |
| `jobs_completed` | `int` | `0` | declared field |
| `jobs_queued` | `int` | `0` | declared field |
| `is_cold_start` | `bool` | `False` | declared field |

**Public methods:** `utilization_pct()`

### `EvalTask`

**File:** `backend/services/evaluation/job_queue.py`  
**Decorators:** `dataclass`  
**Purpose:** One atomic unit of work: evaluate a single entity extraction.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `entity_name` | `str` |  | declared field |
| `source_model` | `str` |  | declared field |
| `actual_output` | `str` |  | declared field |
| `extraction_prompt` | `str` |  | declared field |
| `expected_output` | `Optional[str]` | `None` | declared field |
| `file_hash` | `Optional[str]` | `None` | declared field |
| `file_id` | `Optional[str]` | `None` | declared field |

### `ProviderConfig`

**File:** `backend/services/evaluation/job_queue.py`  
**Decorators:** `dataclass`  
**Purpose:** Configuration for a single judge LLM.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `provider_id` | `str` |  | declared field |
| `provider` | `str` |  | declared field |
| `model_name` | `Optional[str]` | `None` | declared field |
| `deployment` | `Optional[str]` | `None` | declared field |
| `endpoint` | `Optional[str]` | `None` | declared field |
| `api_key` | `Optional[str]` | `None` | declared field |

### `TaskResult`

**File:** `backend/services/evaluation/job_queue.py`  
**Decorators:** `dataclass`  
**Purpose:** Result of evaluating one task with one provider.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `entity_name` | `str` |  | declared field |
| `source_model` | `str` |  | declared field |
| `file_id` | `Optional[str]` |  | declared field |
| `file_hash` | `Optional[str]` |  | declared field |
| `provider_id` | `str` |  | declared field |
| `provider` | `str` |  | declared field |
| `model` | `str` |  | declared field |
| `aggregate_score` | `float` |  | declared field |
| `all_passed` | `bool` |  | declared field |
| `evaluation_time` | `float` |  | declared field |
| `evaluation_cost` | `float` |  | declared field |
| `metrics` | `List[Dict[str, Any]]` |  | declared field |
| `ground_truth` | `Optional[str]` | `None` | declared field |

### `EvalJob`

**File:** `backend/services/evaluation/job_queue.py`  
**Decorators:** `dataclass`  
**Purpose:** A batch evaluation job submitted by a user.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `job_id` | `str` |  | declared field |
| `session_id` | `str` |  | declared field |
| `user_id` | `str` |  | declared field |
| `tasks` | `List[EvalTask]` |  | declared field |
| `providers` | `List[ProviderConfig]` |  | declared field |
| `metrics` | `List[str]` |  | declared field |
| `custom_evaluation_steps` | `Dict[str, List[str]]` |  | declared field |
| `threshold` | `float` | `0.7` | declared field |
| `status` | `str` | `"pending"` | declared field |
| `progress` | `int` | `0` | declared field |
| `total` | `int` | `0` | declared field |
| `results` | `List[TaskResult]` | `field(default_factory=list)` | dataclass field |
| `errors` | `List[Dict[str, str]]` | `field( default_factory=list )` | dataclass field |
| `cancelled` | `bool` | `False` | declared field |
| `created_at` | `datetime` | `field(default_factory=lambda: datetime.now(timezone.utc))` | dataclass field |
| `completed_at` | `Optional[datetime]` | `None` | declared field |
| `error` | `Optional[str]` | `None` | declared field |
| `_asyncio_tasks` | `List[Any]` | `field(default_factory=list, repr=False)` | dataclass field |

**Public methods:** `to_status_dict()`

### `_JobStatusProxy`

**File:** `backend/services/evaluation/job_queue.py`  
**Decorators:** `dataclass`  
**Purpose:** Read-only snapshot of a job loaded from DB (cross-worker lookup).

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `_data` | `Dict[str, Any]` |  | declared field |

**Public methods:** `to_status_dict()`

### `CallMetric`

**File:** `backend/services/telemetry/cost_tracker.py`  
**Decorators:** `dataclass`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `provider` | `str` |  | declared field |
| `model` | `str` |  | declared field |
| `prompt_tokens` | `int` |  | declared field |
| `completion_tokens` | `int` |  | declared field |
| `duration` | `float` |  | declared field |
| `cost` | `float` |  | declared field |
| `timestamp` | `str` |  | declared field |
| `document_name` | `Optional[str]` | `None` | declared field |
| `page_count` | `int` | `0` | declared field |
| `figure_count` | `int` | `0` | declared field |
| `table_count` | `int` | `0` | declared field |
| `batch_number` | `Optional[int]` | `None` | declared field |

### `BatchMetric`

**File:** `backend/services/telemetry/cost_tracker.py`  
**Decorators:** `dataclass`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `batch_number` | `int` |  | declared field |
| `batch_latency` | `float` |  | declared field |
| `document_count` | `int` |  | declared field |

### `SessionMetrics`

**File:** `backend/services/telemetry/cost_tracker.py`  
**Decorators:** `dataclass`  

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `session_id` | `str` |  | declared field |
| `total_cost` | `float` | `0.0` | declared field |
| `total_latency` | `float` | `0.0` | declared field |
| `total_calls` | `int` | `0` | declared field |
| `calls` | `List[CallMetric]` | `field(default_factory=list)` | dataclass field |
| `batches` | `Dict[int, BatchMetric]` | `field(default_factory=dict)` | dataclass field |

## Enums

### `ProcessorType`

**File:** `backend/schemas/enums.py`  
**Base classes:** `str, Enum`  
**Purpose:** Document processor types

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `AUTO` |  | `"auto"` | declared field |
| `DOCLING` |  | `"docling"` | declared field |
| `AZURE_DOC_INTELLIGENCE` |  | `"azure_doc_intelligence"` | declared field |

## Service and provider classes

### `SQLAlchemyDBService`

**File:** `backend/services/database/sqlalchemy_db_service.py`  
**Purpose:** Database service using SQLAlchemy / Azure Postgres directly.

_No class-level data fields or constructor instance attributes are defined._

**Public methods:** `create_session()`, `get_session()`, `list_sessions()`, `get_session_basic()`, `update_session()`, `delete_session()`, `get_session_for_shared_view()`, `record_login()`, `create_document()`, `get_document()`, `get_documents_by_session()`, `get_parse_cost_by_file_hash()`, `list_user_documents()`, `update_document()`, `update_document_processing()`, `upsert_extraction_result()`, `update_extraction_cost()`, `get_extraction_results_by_session()`, `get_extraction_results_by_document()`, `upsert_evaluation_result()`, `get_evaluation_results_by_extraction()`, `get_or_create_preferences()`, `update_preferences()`, `save_prompt_template()`, `get_prompt_templates()`, `delete_prompt_template()`, `share_session()`, `unshare_session()`, `list_shared_sessions()`, `get_user_group_ids()`, `get_group_name()`, `get_user_display_name()`, `increment_session_metrics()`, `get_session_metrics()`, `reset_session_metrics()`, `create_eval_job_record()`, `upsert_eval_job_status()`, `get_eval_job_status()`, `mark_eval_job_cancelled()`

### `DocumentService`

**File:** `backend/services/document/document_service.py`  
**Purpose:** Main service for document processing with multiple processor support

| Instance attribute | Initialized from |
| --- | --- |
| `available_processors` | `self._check_processor_availability()` |
| `azure_doc_intelligence_service` | `AzureDocIntelligenceService()` |
| `docling_service` | `DoclingRemoteClient()` |
| `file_service` | `get_organized_file_service()` |

**Public methods:** `async convert_document_to_markdown()`, `async get_processor_capabilities()`, `async get_conversion_by_id()`, `async get_markdown_content()`, `async resolve_processor_used()`, `async get_figures_for_conversion()`, `async get_raw_analysis_result()`, `async get_processing_file_bytes()`

### `FileService`

**File:** `backend/services/document/file_service.py`  
**Purpose:** Service for handling file upload, storage, and management operations

| Instance attribute | Initialized from |
| --- | --- |
| `metadata_dir` | `self.upload_dir / "metadata"` |
| `upload_dir` | `Path(upload_dir)` |

**Public methods:** `async save_uploaded_file()`, `async get_file_by_hash()`, `async get_file_info()`, `async get_file_by_id()`, `async delete_file()`, `async get_file_content()`, `async list_files()`, `async _save_metadata()`, `async _load_metadata()`

### `OrganizedFileService`

**File:** `backend/services/document/organized_file_service.py`  
**Purpose:** Service for file upload, storage, and retrieval using Azure Blob Storage.

| Instance attribute | Initialized from |
| --- | --- |
| `_blob` | `BlobStorageClient(conn_str, container)` |
| `_db` | `None` |

**Public methods:** `db()`, `compute_file_hash()`, `async save_uploaded_file()`, `get_processing_output_path()`, `async sync_processing_output_to_blob()`, `async get_processed_metadata()`, `async update_processed_metadata()`, `async get_processing_file_bytes()`, `async processing_file_exists()`, `async resolve_processed_processor()`, `async build_document_view()`, `async is_file_processed()`, `async get_processed_content()`, `async get_file_content()`, `async get_file_metadata()`, `async get_original_file_path()`, `async list_user_files()`

### `OrganizedDocumentProcessor`

**File:** `backend/services/document/organized_processor.py`  
**Purpose:** Document processor that uses the organized file structure.

| Instance attribute | Initialized from |
| --- | --- |
| `azure_service` | `AzureDocIntelligenceService()` |
| `docling_service` | `DoclingRemoteClient(base_url=docling_url)` |
| `file_service` | `get_organized_file_service()` |

**Public methods:** `async process_document()`, `async _process_with_azure()`, `async _process_with_docling()`, `async _load_metadata()`, `async get_processed_markdown()`, `async is_processed()`

### `AzureDocIntelligenceService`

**File:** `backend/services/document/processors/azure_doc_intelligence/azure_doc_intelligence_service.py`  
**Purpose:** Service for processing documents using Azure Document Intelligence

| Instance attribute | Initialized from |
| --- | --- |
| `base_path` | `Path(__file__).parent.parent.parent.parent.parent` |
| `client` | `self._init_client()` |
| `output_base_dir` | `self.base_path / "output" / "azure_doc_intelligence"` |

**Public methods:** `async convert_document_to_markdown()`, `async _log()`, `async get_conversion_by_id()`, `async get_markdown_content()`, `is_available()`, `async get_figures_for_conversion()`, `async get_raw_analysis_result()`

### `DoclingRemoteClient`

**File:** `backend/services/document/processors/docling/docling_remote_client.py`  
**Purpose:** Drop-in replacement for DoclingService.convert_document_to_markdown().

| Instance attribute | Initialized from |
| --- | --- |
| `base_url` | `(base_url or os.environ.get("DOCLING_SERVICE_URL", "")).rstrip( "/" )` |
| `poll_interval` | `poll_interval` |
| `timeout` | `timeout` |

**Public methods:** `async convert_document_to_markdown()`, `async _call_sync_convert()`, `async _download_artifact_bundle()`, `async convert_async()`, `async check_health()`

### `_VRAMPeakTracker`

**File:** `backend/services/document/processors/docling/docling_service.py`  
**Purpose:** Poll nvidia-smi in a background thread to capture the true peak VRAM.

| Instance attribute | Initialized from |
| --- | --- |
| `_peak` | `-1.0` |
| `_poll_sec` | `poll_sec` |
| `_stop` | `_threading.Event()` |
| `_thread` | `None` |

**Public methods:** `start()`, `stop()`

### `DoclingService`

**File:** `backend/services/document/processors/docling/docling_service.py`  
**Purpose:** Service for handling document ingestion and conversion using Docling

| Instance attribute | Initialized from |
| --- | --- |
| `_pool_size` | `0` |
| `_process_pool` | `None` |
| `_vram_guard` | `None` |
| `base_path` | `Path(__file__).resolve().parents[4]` |
| `image_resolution_scale` | `image_resolution_scale` |
| `output_base_dir` | `Path(markdown_dir)` |
| `output_base_dir` | `self.base_path / "output" / "docling"` |

**Public methods:** `process_pool()`, `vram_guard()`, `max_workers()`, `async convert_document_to_markdown()`, `async start_conversion()`, `async get_conversion_by_id()`, `async get_markdown_content()`, `async list_conversions()`, `async delete_conversion()`, `async get_figures_for_conversion()`, `async get_raw_analysis_result()`, `async _save_conversion_metadata()`, `async _load_conversion_metadata()`

### `VRAMGuard`

**File:** `backend/services/document/processors/docling/vram_guard.py`  
**Purpose:** VRAM-aware concurrency controller for GPU-accelerated document processing.

| Instance attribute | Initialized from |
| --- | --- |
| `_active_workers` | `0` |
| `_cold_start_max` | `cold_start_workers if cold_start_workers is not None else int( os.environ.get( "VRAM_COLD_START_WORKERS", str(_COLD_START_WORKERS_DEFAULT) ) )` |
| `_cold_start_min_jobs` | `cold_start_min_jobs if cold_start_min_jobs is not None else _COLD_START_MIN_JOBS_DEFAULT` |
| `_is_cold_start` | `not loaded_state` |
| `_jobs_completed` | `0` |
| `_last_smi_free` | `self.vram_total_mb` |
| `_last_smi_time` | `0.0` |
| `_last_smi_used` | `0.0` |
| `_lock` | `asyncio.Lock()` |
| `_max_workers_cap` | `max_workers_cap if max_workers_cap is not None else ( int(os.environ["VRAM_MAX_WORKERS"]) if "VRAM_MAX_WORKERS" in os.environ else None )` |
| `_observation_window` | `observation_window if observation_window is not None else int( os.environ.get( "VRAM_OBSERVATION_WINDOW", str(_OBSERVATION_WINDOW_DEFAULT) ) )` |
| `_peak_observations` | `loaded_state.get("observations", []) if loaded_state else []` |
| `_per_worker_mb` | `loaded_state["per_worker_mb"]` |
| `_per_worker_mb` | `per_worker_init_mb if per_worker_init_mb is not None else float(os.environ.get("VRAM_PER_WORKER_INIT_MB", "2800"))` |
| `_persistence_path` | `Path(persistence_path) if persistence_path else _DEFAULT_STATE_PATH` |
| `_pool_needs_resize` | `False` |
| `_queued_workers` | `0` |
| `_slot_available` | `asyncio.Event()` |
| `_smi_lock` | `threading.Lock()` |
| `_usable_vram_mb` | `self.vram_total_mb - self.safety_margin_mb` |
| `check_interval_sec` | `check_interval_sec if check_interval_sec is not None else float(os.environ.get("VRAM_CHECK_INTERVAL_SEC", "1.0"))` |
| `safety_margin_mb` | `safety_margin_mb if safety_margin_mb is not None else float(os.environ.get("VRAM_SAFETY_MARGIN_MB", "1536"))` |
| `vram_total_mb` | `vram_total_mb or _get_gpu_vram_total_mb() or 16384.0` |

**Public methods:** `async acquire_slot()`, `report_worker_result()`, `report_oom()`, `get_status()`, `max_workers()`, `active_workers()`, `per_worker_mb()`, `is_cuda_oom()`

### `AnthropicVertexDeepEvalModel`

**File:** `backend/services/evaluation/adapters/anthropic_adapter.py`  
**Base classes:** `DeepEvalBaseLLM`  
**Purpose:** Custom DeepEval model adapter for Anthropic via Vertex AI

| Instance attribute | Initialized from |
| --- | --- |
| `_model_name` | `model_name` |
| `async_client` | `AsyncAnthropicVertex( region=self.location, project_id=self.project )` |
| `call_history` | `[]` |
| `client` | `AnthropicVertex(region=self.location, project_id=self.project)` |
| `location` | `location` |
| `max_tokens` | `max_tokens` |
| `project` | `project or "hcsx-scigpt2-innocentrhino-acm"` |
| `temperature` | `temperature` |

**Public methods:** `load_model()`, `generate()`, `async a_generate()`, `get_model_name()`

### `AzureOpenAIDeepEvalModel`

**File:** `backend/services/evaluation/adapters/azure_adapter.py`  
**Base classes:** `DeepEvalBaseLLM`  
**Purpose:** Custom DeepEval model adapter for Azure OpenAI using LangChain

| Instance attribute | Initialized from |
| --- | --- |
| `_model_name` | `model_name or (secrets_config.get("model_name") if secrets_config else None) or os.getenv("AZURE_OPENAI_MODEL_NAME", "gpt-5-mini")` |
| `api_key` | `api_key or (secrets_config.get("api_key") if secrets_config else None) or os.getenv("AZURE_OPENAI_KEY")` |
| `api_version` | `api_version or (secrets_config.get("api_version") if secrets_config else None) or os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")` |
| `call_history` | `[]` |
| `deployment` | `deployment or (secrets_config.get("deployment") if secrets_config else None) or os.getenv("AZURE_OPENAI_DEPLOYMENT") or os.getenv("AZURE_OPENAI_MODEL_NAME")` |
| `endpoint` | `endpoint or (secrets_config.get("endpoint") if secrets_config else None) or os.getenv("AZURE_OPENAI_ENDPOINT")` |
| `max_tokens` | `max_tokens` |
| `model` | `AzureChatOpenAI(**model_kwargs)` |
| `temperature` | `temperature` |

**Public methods:** `load_model()`, `generate()`, `async a_generate()`, `get_model_name()`

### `VertexAIDeepEvalModel`

**File:** `backend/services/evaluation/adapters/vertex_adapter.py`  
**Base classes:** `DeepEvalBaseLLM`  
**Purpose:** Custom DeepEval model adapter for Vertex AI using LangChain

| Instance attribute | Initialized from |
| --- | --- |
| `_model_name` | `model_name` |
| `call_history` | `[]` |
| `location` | `location or os.getenv("GEMINI_LOCATION", "us-central1")` |
| `model` | `ChatVertexAI(**model_kwargs)` |
| `project` | `project or os.getenv("GEMINI_PROJECT")` |
| `temperature` | `temperature` |

**Public methods:** `load_model()`, `generate()`, `async a_generate()`, `get_model_name()`

### `EvaluationService`

**File:** `backend/services/evaluation/evaluation_service.py`  
**Purpose:** Main evaluation service orchestrator

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `METRIC_FACTORIES` |  | `{ "correctness": CorrectnessMetricFactory, "completeness": CompletenessMetricFactory, "relevance": RelevanceMetricFactory, "safety": SafetyMetricFactory, }` | declared field |

**Public methods:** `create_evaluation_model()`, `create_metric()`, `create_custom_metric()`, `async _evaluate_combined()`, `async evaluate_extraction()`, `async evaluate_multiple_extractions()`, `async get_evaluation_result()`, `async list_evaluations()`

### `CompletenessMetricFactory`

**File:** `backend/services/evaluation/metrics/completeness.py`  
**Purpose:** Factory for creating Completeness evaluation metrics

_No class-level data fields or constructor instance attributes are defined._

**Public methods:** `create()`, `get_required_params()`, `get_description()`

### `CorrectnessMetricFactory`

**File:** `backend/services/evaluation/metrics/correctness.py`  
**Purpose:** Factory for creating Correctness evaluation metrics

_No class-level data fields or constructor instance attributes are defined._

**Public methods:** `create()`, `get_required_params()`, `get_description()`

### `CustomMetricFactory`

**File:** `backend/services/evaluation/metrics/custom.py`  
**Purpose:** Factory for creating custom G-Eval metrics

_No class-level data fields or constructor instance attributes are defined._

**Public methods:** `create()`, `get_description()`

### `RelevanceMetricFactory`

**File:** `backend/services/evaluation/metrics/relevance.py`  
**Purpose:** Factory for creating Relevance evaluation metrics

_No class-level data fields or constructor instance attributes are defined._

**Public methods:** `create()`, `get_required_params()`, `get_description()`

### `SafetyMetricFactory`

**File:** `backend/services/evaluation/metrics/safety.py`  
**Purpose:** Factory for creating Safety evaluation metrics

_No class-level data fields or constructor instance attributes are defined._

**Public methods:** `create()`, `get_required_params()`, `get_description()`

### `EvaluationResultStorage`

**File:** `backend/services/evaluation/storage/result_storage.py`  
**Purpose:** Handles storage and retrieval of evaluation results

| Instance attribute | Initialized from |
| --- | --- |
| `output_dir` | `Path(output_dir) if output_dir else base_path / "output" / "evaluations"` |

**Public methods:** `async save()`, `async get()`, `async list_all()`, `async delete()`, `get_storage_path()`

### `GroupService`

**File:** `backend/services/groups/group_service.py`  
**Purpose:** Service for managing groups and memberships

_No class-level data fields or constructor instance attributes are defined._

**Public methods:** `create_group()`, `get_group()`, `list_user_groups()`, `update_group()`, `delete_group()`, `get_group_members()`, `add_member()`, `update_member_role()`, `remove_member()`

### `AnthropicLLMClient`

**File:** `backend/services/llm/anthropic.py`  

| Instance attribute | Initialized from |
| --- | --- |
| `disabled` | `not self.service_account_path` |
| `location` | `os.environ.get("ANTHROPIC_LOCATION", "global")` |
| `project_id` | `os.environ.get("ANTHROPIC_PROJECT_ID") or "hcsx-scigpt2-innocentrhino-acm"` |
| `service_account_path` | `self._find_service_account_file()` |

**Public methods:** `async _call_anthropic_api()`, `async extract_entities_with_anthropic()`, `async generate_paragraph_with_anthropic()`

### `AzureLLMClient`

**File:** `backend/services/llm/azure.py`  

| Instance attribute | Initialized from |
| --- | --- |
| `api_key` | `os.environ.get("AZURE_OPENAI_KEY")` |
| `api_version` | `os.environ.get( "AZURE_OPENAI_API_VERSION", "2024-08-01-preview" )` |
| `default_deployment` | `os.environ.get("AZURE_OPENAI_DEPLOYMENT")` |
| `default_model_name` | `os.environ.get("AZURE_OPENAI_MODEL_NAME")` |
| `disabled` | `not has_global_creds and not has_configured_models` |
| `endpoint` | `os.environ.get("AZURE_OPENAI_ENDPOINT")` |

**Public methods:** `async generate_paragraph_with_azure()`, `async extract_entities_with_azure()`, `async extract_content_from_image()`

### `GeminiLLMClient`

**File:** `backend/services/llm/gemini.py`  

| Instance attribute | Initialized from |
| --- | --- |
| `disabled` | `not self.project_id or not self.location or not self.service_account_path` |
| `location` | `os.environ.get("GEMINI_LOCATION") or os.environ.get("VERTEX_AI_LOCATION") or "us-central1"` |
| `project_id` | `os.environ.get("GEMINI_PROJECT_ID") or os.environ.get("GEMINI_PROJECT") or os.environ.get("VERTEX_AI_PROJECT")` |
| `service_account_path` | `self._find_service_account_file()` |

**Public methods:** `async _call_gemini_api()`, `async extract_entities_with_gemini()`, `async generate_paragraph_with_gemini()`, `async extract_content_from_image()`

### `LlamaLLMClient`

**File:** `backend/services/llm/llama.py`  

| Instance attribute | Initialized from |
| --- | --- |
| `disabled` | `not self.project_id or not self.location or not self.region or not self.service_account_path` |
| `location` | `os.environ.get("LLAMA_LOCATION", "us-east5")` |
| `project_id` | `os.environ.get("LLAMA_PROJECT_ID") or os.environ.get( "GEMINI_PROJECT_ID" )` |
| `region` | `os.environ.get("LLAMA_REGION", "us-east5")` |
| `service_account_path` | `self._find_service_account_file()` |

**Public methods:** `async _call_llama_api()`, `async extract_entities_with_llama()`, `async _try_llama_extraction_strategy()`, `async _try_llama_fallback_strategy()`, `async _handle_llama_parsing_error()`, `async generate_paragraph_with_llama()`, `async warm_up()`

### `LLMService`

**File:** `backend/services/llm/llm_service.py`  
**Purpose:** LLM Service for entity extraction and paragraph generation.

| Instance attribute | Initialized from |
| --- | --- |
| `anthropic_client` | `AnthropicLLMClient()` |
| `azure_client` | `AzureLLMClient()` |
| `gemini_client` | `GeminiLLMClient()` |
| `llama_client` | `LlamaLLMClient()` |
| `macbook_client` | `MacbookLLMClient()` |
| `timeout_log_dir` | `Path(__file__).resolve().parents[2] / "output" / "timeout_logs"` |
| `timeout_log_file` | `self.timeout_log_dir / "timeout_log.txt"` |
| `vllm_client` | `VLLMClient()` |

**Public methods:** `async _call_with_timeout_logging()`, `async extract_entities_from_markdown()`, `async extract_content_from_image()`, `async generate_paragraph()`

### `MacbookLLMClient`

**File:** `backend/services/llm/macbook.py`  

| Instance attribute | Initialized from |
| --- | --- |
| `_fail_count` | `0` |
| `_tags_cache` | `[]` |
| `_tags_cache_ts` | `0.0` |
| `_tags_cache_ttl_seconds` | `120` |
| `base_url` | `(self.base_url or "").rstrip("/")` |
| `base_url` | `os.environ.get("MACBOOK_LLM_BASE_URL", "").rstrip("/")` |
| `base_url` | `self._load_base_url_from_secrets()` |
| `disable_reasoning` | `disable_reasoning_env not in [ "false", "0", "no", "off", ]` |
| `disabled` | `not bool(self.base_url)` |
| `initial_backoff` | `float(os.environ.get("MACBOOK_INITIAL_BACKOFF", 1.0))` |
| `max_attempts` | `int(os.environ.get("MACBOOK_MAX_ATTEMPTS", 2))` |
| `max_backoff` | `float(os.environ.get("MACBOOK_MAX_BACKOFF", 8.0))` |
| `per_attempt_timeout` | `max( 1800.0, float(os.environ.get("MACBOOK_PER_ATTEMPT_TIMEOUT", 1800.0)) )` |
| `total_retry_cap` | `max( 1800.0, float(os.environ.get("MACBOOK_TOTAL_RETRY_CAP", 1800.0)) )` |

**Public methods:** `async fetch_available_models()`, `async check_health()`, `async _call_macbook_api()`, `async extract_entities_with_macbook()`, `async generate_paragraph_with_macbook()`

### `MacbookRequestQueue`

**File:** `backend/services/llm/macbook_queue.py`  
**Purpose:** FIFO queue with a single worker for serializing Macbook LLM requests.

| Instance attribute | Initialized from |
| --- | --- |
| `_queue` | `asyncio.Queue()` |
| `_started` | `False` |
| `_total_enqueued` | `0` |
| `_total_processed` | `0` |
| `_worker_task` | `None` |

**Public methods:** `async _worker()`, `async enqueue()`, `pending_count()`, `stats()`

### `VLLMClient`

**File:** `backend/services/llm/vllm.py`  
**Purpose:** OpenAI-compatible client for VLLM inference servers.

| Instance attribute | Initialized from |
| --- | --- |
| `_static_models` | `[]` |
| `_static_models` | `json.loads(models_json)` |
| `api_key` | `os.environ.get("VLLM_API_KEY", "EMPTY")` |
| `base_url` | `os.environ.get("VLLM_BASE_URL", "").rstrip("/")` |
| `disabled` | `not bool(self.base_url)` |

**Public methods:** `async fetch_available_models()`, `async check_health()`, `async _call_vllm_api()`, `async extract_entities_with_vllm()`, `async generate_paragraph_with_vllm()`

### `SessionService`

**File:** `backend/services/session/session_service.py`  
**Purpose:** Service for managing user sessions with database storage

| Instance attribute | Initialized from |
| --- | --- |
| `_doc_cache` | `{}` |
| `_file_service` | `None` |
| `db` | `get_db_service()` |

**Public methods:** `file_service()`, `create_session()`, `get_session()`, `list_sessions()`, `update_session()`, `delete_session()`, `add_extraction_result()`, `add_extraction_result_fast()`, `add_evaluation_result()`, `add_evaluation_result_fast()`, `clear_cache()`, `share_session()`, `unshare_session()`, `list_shared_sessions()`, `get_session_for_shared_view()`, `async build_restore_view()`

### `BlobStorageClient`

**File:** `backend/services/storage/blob_storage.py`  
**Purpose:** Async Azure Blob Storage client.

| Instance attribute | Initialized from |
| --- | --- |
| `_container` | `container_name` |
| `_service` | `BlobServiceClient.from_connection_string(connection_string)` |

**Public methods:** `async _ensure_container()`, `async upload_bytes()`, `async download_bytes()`, `async exists()`, `async upload_directory()`, `async list_blobs_with_prefix()`, `from_env()`

### `CostTracker`

**File:** `backend/services/telemetry/cost_tracker.py`  

| Instance attribute | Initialized from |
| --- | --- |
| `_db_service` | `None` |
| `_pricing` | `self._load_pricing()` |
| `_sessions` | `{}` |

**Public methods:** `estimate_call_cost()`, `record_call()`, `record_batch()`, `get_session_metrics()`, `load_session_metrics_from_db()`, `clear_session()`

### `FolderService`

**File:** `backend/services/templates/folder_service.py`  
**Purpose:** Service for managing template folders.

| Instance attribute | Initialized from |
| --- | --- |
| `group_service` | `get_group_service()` |

**Public methods:** `list_folders()`, `create_folder()`, `rename_folder()`, `delete_folder()`

### `TemplateService`

**File:** `backend/services/templates/template_service.py`  
**Purpose:** Service for managing prompt templates

| Instance attribute | Initialized from |
| --- | --- |
| `group_service` | `get_group_service()` |

**Public methods:** `create_template()`, `get_template()`, `list_templates()`, `update_template()`, `delete_template()`, `get_version_history()`, `revert_to_version()`, `fork_template()`, `change_scope()`, `set_immutable()`, `set_permission()`, `get_permissions()`, `remove_permission()`

## Utilities

### `PDFBBoxVisualizer`

**File:** `backend/utils/pdf_bbox_visualizer.py`  
**Purpose:** Visualizes bounding boxes from Azure Document Intelligence on PDFs

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `COLORS` |  | `{ "word": (0.2, 0.6, 1.0), # Light blue "line": (0.0, 0.5, 0.8), # Blue "paragraph": (0.5, 0.0, 0.5), # Purple "table": (1.0, 0.5, 0.0), # Orange "table_cell": (1.0, 0.7, 0.3), ...` | declared field |

**Public methods:** `visualize_words()`, `visualize_lines()`, `visualize_paragraphs()`, `visualize_tables()`, `visualize_figures()`, `visualize_selection_marks()`, `visualize_all()`, `save()`, `close()`

## Scripts and developer tools

### `DocumentAnalyzer`

**File:** `backend/scripts/analyze_and_visualize_pdf.py`  
**Purpose:** Analyzes documents using Azure Document Intelligence

| Instance attribute | Initialized from |
| --- | --- |
| `client` | `DocumentIntelligenceClient( endpoint=self.endpoint, credential=AzureKeyCredential(self.key) )` |
| `endpoint` | `os.getenv("AZURE_DOC_INTELLIGENCE_ENDPOINT")` |
| `key` | `os.getenv("AZURE_DOC_INTELLIGENCE_KEY")` |

**Public methods:** `analyze_pdf()`

### `ModelListParser`

**File:** `backend/scripts/evaluate_macbook_models.py`  
**Purpose:** Parse model names from the CSV file.

| Field | Type | Default / definition | Kind |
| --- | --- | --- | --- |
| `EXPECTED_MODELS` |  | `[ # 3B - 4B "llama3.2:3b-instruct-fp16", "llama3.2:3b-instruct-q4_K_M", "MedAIBase/MedGemma1.5:4b", "phi4-mini:3.8b", "phi3.5:3.8b", "nemotron-mini:4b-instruct-q4_K_M", "nemotro...` | declared field |

**Public methods:** `parse_model_list()`

### `PromptLoader`

**File:** `backend/scripts/evaluate_macbook_models.py`  
**Purpose:** Load prompt template and test document.

| Instance attribute | Initialized from |
| --- | --- |
| `config` | `config` |

**Public methods:** `load()`

### `MacbookClient`

**File:** `backend/scripts/evaluate_macbook_models.py`  
**Purpose:** Client for interacting with MacBook LLM API.

| Instance attribute | Initialized from |
| --- | --- |
| `base_url` | `config.base_url.rstrip("/")` |
| `config` | `config` |
| `endpoint` | `config.api_endpoint` |
| `session` | `requests.Session()` |

**Public methods:** `generate()`, `close()`

### `ResponseEvaluator`

**File:** `backend/scripts/evaluate_macbook_models.py`  
**Purpose:** Evaluate model responses against ground truth.

| Instance attribute | Initialized from |
| --- | --- |
| `ground_truth` | `ground_truth` |
| `weights` | `{ "study_author(s)": 0.12, "author_affiliations": 0.12, "study_title": 0.12, "publication_date": 0.10, "test_material": 0.12, "vehicle_or_solvent_used": 0.12, "dose_le...` |

**Public methods:** `compute_score()`

### `ExcelReporter`

**File:** `backend/scripts/evaluate_macbook_models.py`  
**Purpose:** Generate Excel report from test results.

| Instance attribute | Initialized from |
| --- | --- |
| `config` | `config` |

**Public methods:** `generate()`

### `ModelTestRunner`

**File:** `backend/scripts/evaluate_macbook_models.py`  
**Purpose:** Orchestrates the model testing process.

| Instance attribute | Initialized from |
| --- | --- |
| `client` | `MacbookClient(config)` |
| `config` | `config` |
| `reporter` | `ExcelReporter(config)` |

**Public methods:** `run()`

## Other backend classes

### `Base`

**File:** `backend/models/base.py`  
**Base classes:** `DeclarativeBase`  
**Purpose:** Base class for all SQLAlchemy models

_No class-level data fields or constructor instance attributes are defined._

