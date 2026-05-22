# Pydantic Schemas Technical Design

> *Pydantic schemas are the typed contracts that sit at the boundary between the frontend and the backend — they define exactly what JSON the API accepts and what it returns. This document lists every schema class used for request bodies and response payloads, with notes on design decisions like why certain fields use free strings instead of enums. If the frontend is sending data that the backend rejects, or you're not sure what shape a response will have, start here.*

This document describes request and response schemas in `backend/schemas/` and local router-level schemas in `backend/api/*`. These schemas define the API-facing data structures separate from SQLAlchemy ORM models.

## 1. Shared enum schemas

### `ProcessorType`

File: `backend/schemas/enums.py`

String enum values:

| Name | Value | Meaning |
| --- | --- | --- |
| `AUTO` | `auto` | Let backend choose parser. |
| `DOCLING` | `docling` | Use Docling parser. |
| `AZURE_DOC_INTELLIGENCE` | `azure_doc_intelligence` | Use Azure Document Intelligence parser. |

Used by document-processing requests.

## 2. Document schemas

File: `backend/schemas/documents.py`

### `ProcessFileRequest`

Request body for document processing.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `processor` | `Optional[ProcessorType]` | `auto` | Parser selection. |
| `extract_figures` | `bool` | `True` | Whether figure extraction should run. |
| `batch_number` | `Optional[int]` | `None` | Frontend grouping/benchmark metadata. Description says 1-99, but no numeric bounds are enforced. |

### `ExtractFigureContentRequest`

Request body for figure content extraction or summary generation.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `model_type` | `str` | `gemini` | Free string, not enum-constrained. |
| `model_id` | `Optional[str]` | `None` | Specific model identifier. |
| `extraction_prompt` | `str` | long OCR/scientific prompt | Prompt sent to vision model. |
| `max_tokens` | `int` | `2048` | No explicit bounds. |
| `temperature` | `float` | `0.0` | No explicit bounds. |
| `system_message` | `Optional[str]` | `None` | Optional system prompt. |

### `FigureExtractionResult`

Nested result attached to figure metadata.

| Field | Type |
| --- | --- |
| `content` | `str` |
| `model_used` | `str` |
| `timestamp` | `str` |
| `duration` | `float` |

### `FigureMetadata`

Figure metadata shape returned to API callers.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `str` | Figure identifier. |
| `page` | `Optional[int]` | Page number. |
| `caption` | `Optional[str]` | Figure caption. |
| `image_path` | `Optional[str]` | Relative artifact path. |
| `bounding_regions` | `Optional[list]` | Unconstrained list shape. |
| `extracted_content` | `Optional[FigureExtractionResult]` | Nested extracted summary/content. |

## 3. Extraction schemas

File: `backend/schemas/extractions.py`

### `Entity`

One entity extraction instruction.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `str` | Entity label. |
| `prompt` | `str` | Entity-specific extraction prompt. |
| `extracted` | `Optional[str]` | Optional existing value. |
| `system_prompt` | `Optional[str]` | Optional per-entity system prompt. |

### `ExtractRequest`

Request body for `POST /api/extract`.

| Field | Type | Notes |
| --- | --- | --- |
| `conversion_id` | `str` | File hash/conversion id. |
| `session_id` | `Optional[str]` | Session for persistence. |
| `deployment` | `Optional[str]` | Azure-style deployment. |
| `entities` | `List[Entity]` | Entity extraction instructions. |
| `api_version` | `Optional[str]` | Provider API version. |
| `azure_endpoint` | `Optional[str]` | Optional direct Azure endpoint. |
| `azure_api_key` | `Optional[str]` | Optional direct Azure API key. |
| `gemini_api_key` | `Optional[str]` | Optional Gemini API key. |
| `gemini_project_id` | `Optional[str]` | Optional GCP project. |
| `gemini_location` | `Optional[str]` | Optional Vertex location. |
| `max_tokens` | `int` | Default `8024`. |
| `temperature` | `float` | Default `0.0`. |
| `model_type` | `Optional[str]` | Default `azure`; free string. |
| `model_id` | `Optional[str]` | Provider model id. |
| `processor_used` | `Optional[str]` | Preferred parser output subtree. |

Validation is intentionally light. Provider and model compatibility is handled in service/router code.

## 4. Evaluation schemas

File: `backend/schemas/evaluations.py`

### `EvaluationRequest`

Request for one extraction evaluation.

Core fields:

| Field | Type | Default / constraint |
| --- | --- | --- |
| `entity_name` | `str` | required |
| `extraction_prompt` | `str` | required |
| `actual_output` | `str` | required |
| `expected_output` | `Optional[str]` | `None` |
| `metrics` | `Optional[List[str]]` | `['all']`; values not enum-constrained |
| `provider` | `str` | `azure_openai` |
| `threshold` | `float` | default `0.5`, constrained `0.0 <= x <= 1.0` |
| `strict_mode` | `bool` | `False` |
| `custom_evaluation_steps` | `Optional[Dict[str, List[str]]]` | `None` |

Provider-specific fields:

- Azure: `azure_deployment`, `azure_endpoint`, `azure_api_key`, `azure_model_name`.
- Vertex: `vertex_model_name`, `vertex_project`, `vertex_location`.
- Anthropic/other: `model_name`.

### `SingleExtractionEval`

Nested item for batch evaluation:

- `entity_name`
- `extraction_prompt`
- `actual_output`
- `expected_output`

### `BatchEvaluationRequest`

Batch request with:

- `extractions: List[SingleExtractionEval]`
- metrics/custom steps/provider/threshold/strict mode
- same Azure/Vertex/model provider fields as single evaluation

### `CustomMetricRequest`

Request for one custom metric evaluation:

| Field | Type | Notes |
| --- | --- | --- |
| `metric_name` | `str` | Custom metric label. |
| `evaluation_steps` | `List[str]` | Required but no min length. |
| `entity_name` | `str` | Entity label. |
| `extraction_prompt` | `str` | Original extraction prompt. |
| `actual_output` | `str` | Output being evaluated. |
| `expected_output` | `Optional[str]` | Ground truth. |
| provider fields | mixed | Same pattern as other evaluation schemas. |

### Evaluation response models

`MetricResult`:

- `metric_name`
- `score`
- `threshold`
- `success`
- `reason`

`EvaluationResponse`:

- evaluation metadata, test case, metric results, aggregate score, pass/fail, status, optional error.

`BatchEvaluationResponse`:

- batch id, timing, counts, average score, pass/fail, provider, and raw result dictionaries.

## 5. Server config schema

File: `backend/schemas/server.py`

### `ServerConfig`

Returned by `/api/server-config`.

| Field | Type | Meaning |
| --- | --- | --- |
| `is_azure_openai_configured` | `bool` | Azure OpenAI credentials/models available. |
| `is_gemini_configured` | `bool` | Gemini/Vertex configured. |
| `is_azure_document_intelligence_configured` | `bool` | Azure Document Intelligence available. |
| `is_llama_configured` | `bool` | Llama MaaS configured. |
| `is_macbook_configured` | `bool` | Macbook base URL configured. |
| `is_macbook_healthy` | `bool` | Macbook endpoint reachable. |

## 6. Session schemas

File: `backend/schemas/sessions.py`

These schemas are the main aggregate response contract for workflow restore and session history.

### `SessionEntity`

| Field | Type |
| --- | --- |
| `name` | `str` |
| `prompt` | `str` |
| `system_prompt` | `Optional[str]` |

### `SessionConfiguration`

| Field | Type | Default |
| --- | --- | --- |
| `study_type` | `Optional[str]` | `None` |
| `selected_models` | `List[str]` | empty list |
| `entities` | `List[SessionEntity]` | empty list |
| `summary_prompt` | `Optional[str]` | `None` |
| `paragraph_system_prompt` | `Optional[str]` | `None` |
| `temperature` | `float` | `0.0` |
| `model_temperatures` | `Optional[Dict[str, float]]` | empty dict |
| `files_config` | `Optional[Dict[str, Any]]` | empty dict |
| `evaluation_config` | `Optional[Dict[str, Any]]` | empty dict |

### `SessionDocument`

Document summary in a session response:

- `id`
- `file_hash`
- `filename`
- `processor_used`
- `parse_cost`
- `page_count`
- `parse_duration_seconds`
- `figure_count`
- `table_count`

### `ExtractionResult`

API/session extraction result, distinct from ORM model with the same class name.

| Field | Type | Notes |
| --- | --- | --- |
| `entity_name` | `str` | Entity label. |
| `model_id` | `str` | Provider/model id. |
| `document_id` | `Optional[str]` | Associated document id. |
| `extracted_text` | `Optional[str]` | Answer text. |
| `references` | `Optional[List[Dict[str, Any]]]` | Bounding-box/reference data. |
| `status` | `Literal['pending','completed','error']` | Strictly validated. |
| `error_message` | `Optional[str]` | Error text. |
| `extracted_at` | `Optional[datetime]` | Completion timestamp. |
| `file_hash` | `Optional[str]` | File hash for matching. |
| token/cost fields | optional ints/floats | Usage metrics. |

### `SessionMetrics`

- `total_cost: float = 0.0`
- `total_latency: float = 0.0`
- `total_calls: int = 0`

### `EvaluationScore`

One metric score:

- `metric`
- `score`
- `reasoning`
- `judge_model`
- `human_score`
- `evaluation_cost`
- `evaluation_time`

### `EvaluationResult`

Session-level grouped evaluation result:

- document/file/entity/model identity fields;
- `ground_truth`;
- `scores: List[EvaluationScore]`;
- optional aggregate human/cost/time fields.

### `Session`

Full session aggregate:

| Field | Type | Notes |
| --- | --- | --- |
| `session_id` | `str` | Default UUID string. |
| `user_id` | `str` | Owner. |
| `name` | `str` | Default `Untitled Session`. |
| `status` | `Literal['in_progress','completed']` | Strictly validated. |
| `last_step` | `Optional[str]` | UI workflow step. |
| `evaluation_config` | `Optional[Dict[str, Any]]` | Session-level eval config. |
| `files_config` | `Optional[Dict[str, Any]]` | Per-file config. |
| `created_at` / `updated_at` | `datetime` | Timestamps. |
| `configuration` | `SessionConfiguration` | Main workflow configuration. |
| `documents` | `List[SessionDocument]` | Documents in session. |
| `extraction_results` | `List[ExtractionResult]` | Extraction outputs. |
| `evaluation_results` | `List[EvaluationResult]` | Grouped evaluation outputs. |
| `session_metrics` | `Optional[SessionMetrics]` | Optional aggregate metrics. |

### `CreateSessionRequest`

Fields:

- `user_id`
- optional name/last_step/config/evaluation_config/files_config/documents

### `UpdateSessionRequest`

All fields optional. Supports updating:

- user/name/status/last_step;
- configuration/evaluation_config/files_config;
- documents/extraction_results/evaluation_results.

### `SessionSummary` and `SessionListResponse`

`SessionSummary` is list-card style metadata:

- session id, name, status, timestamps, last step;
- study type, document count/names, extraction/evaluation counts;
- shared session display fields.

`SessionListResponse` wraps:

- `sessions: List[SessionSummary]`
- `total: int`

## 7. Router-local schemas

Some routers define local Pydantic models rather than central schemas.

### Files router

- `FileUploadResponse`
- `UserFileInfo`

These cover upload metadata and user-file list entries.

### Groups router

- `CreateGroupRequest`
- `UpdateGroupRequest`
- `AddMemberRequest`
- `UpdateMemberRoleRequest`
- `GroupResponse`
- `MemberResponse`
- `GroupDetailResponse`
- `UserSearchResult`

These mirror group service dictionaries and profile-enriched membership data.

### Templates router

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

These define the template workspace API contract.

### Evaluation jobs router

- `EvalTaskRequest`
- `ProviderConfigRequest`
- `SubmitJobRequest`

These are converted into `EvalTask`, `ProviderConfig`, and `EvalJob` dataclasses in the job queue.

### Chat router

- `ChatQueryRequest`

Fields include query text, optional document markdown, and model configuration.

### Paragraph routers

- `ParagraphGenerationRequest`
- `ParagraphEvalGenerateRequest`

These support generated scientific summary paragraphs and paragraph-specific evaluation records.

## 8. Schema design notes

- Several fields are free strings instead of enums (`model_type`, `provider`, `metrics`, status fields in ORM models). Validation happens later in services.
- Session API schemas use `Literal` for `Session.status` and API extraction status, making the API stricter than some database fields.
- Many nested JSON structures intentionally use `Dict[str, Any]` or `List[Dict[str, Any]]` because provider outputs and bbox references vary by parser/provider.
- Mutable defaults use `default_factory` in session schemas where needed.
- There are naming collisions between ORM classes and Pydantic classes, especially `ExtractionResult` and `EvaluationResult`. Always qualify by package in technical discussions.
