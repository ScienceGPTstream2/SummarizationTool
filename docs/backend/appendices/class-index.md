# Backend Class Index

Compact index of backend classes, dataclasses, and schema classes. For detailed behavior, follow the linked module docs from [../README.md](../README.md).

## Core app/config/auth

| Symbol | File | Type |
| --- | --- | --- |
| `get_current_user` | `backend/core/auth.py` | FastAPI dependency function |
| `get_optional_user` | `backend/core/auth.py` | FastAPI dependency function |
| `load_config` | `backend/core/config.py` | config loader |
| `setup_cors` | `backend/core/middleware.py` | middleware installer |
| `setup_logging` | `backend/core/logging_config.py` | logging setup |

## SQLAlchemy models

| Class | File | Table |
| --- | --- | --- |
| `Base` | `backend/models/base.py` | declarative base |
| `User` | `backend/models/user.py` | `user` |
| `AuthSession` | `backend/models/user.py` | `session` |
| `Account` | `backend/models/user.py` | `account` |
| `Verification` | `backend/models/user.py` | `verification` |
| `AppSession` | `backend/models/app_session.py` | `app_sessions` |
| `Document` | `backend/models/document.py` | `documents` |
| `ExtractionResult` | `backend/models/extraction.py` | `extraction_results` |
| `EvaluationResult` | `backend/models/evaluation.py` | `evaluation_results` |
| `Group` | `backend/models/group.py` | `groups` |
| `UserGroup` | `backend/models/group.py` | `user_groups` |
| `UserPreferences` | `backend/models/preferences.py` | `user_preferences` |
| `LoginHistory` | `backend/models/preferences.py` | `login_history` |
| `UserPromptTemplate` | `backend/models/preferences.py` | `user_prompt_templates` |
| `TemplateFolder` | `backend/models/template.py` | `template_folders` |
| `PromptTemplate` | `backend/models/template.py` | `prompt_templates` |
| `TemplateVersion` | `backend/models/template.py` | `template_versions` |
| `TemplatePermission` | `backend/models/template.py` | `template_permissions` |
| `EvalJobRecord` | `backend/models/eval_job.py` | `eval_jobs` |

## Central Pydantic schemas

| Class | File | Purpose |
| --- | --- | --- |
| `ProcessorType` | `backend/schemas/enums.py` | Parser enum. |
| `ProcessFileRequest` | `backend/schemas/documents.py` | Process file request. |
| `ExtractFigureContentRequest` | `backend/schemas/documents.py` | Figure summary/extraction request. |
| `FigureExtractionResult` | `backend/schemas/documents.py` | Figure extracted content. |
| `FigureMetadata` | `backend/schemas/documents.py` | Figure API metadata. |
| `Entity` | `backend/schemas/extractions.py` | Entity extraction instruction. |
| `ExtractRequest` | `backend/schemas/extractions.py` | Entity extraction request. |
| `EvaluationRequest` | `backend/schemas/evaluations.py` | Single evaluation request. |
| `SingleExtractionEval` | `backend/schemas/evaluations.py` | Batch evaluation item. |
| `BatchEvaluationRequest` | `backend/schemas/evaluations.py` | Batch evaluation request. |
| `CustomMetricRequest` | `backend/schemas/evaluations.py` | Custom metric request. |
| `MetricResult` | `backend/schemas/evaluations.py` | Metric response item. |
| `EvaluationResponse` | `backend/schemas/evaluations.py` | Single evaluation response. |
| `BatchEvaluationResponse` | `backend/schemas/evaluations.py` | Batch evaluation response. |
| `ServerConfig` | `backend/schemas/server.py` | Server/provider config flags. |
| `SessionEntity` | `backend/schemas/sessions.py` | Session entity config. |
| `SessionConfiguration` | `backend/schemas/sessions.py` | Session workflow config. |
| `SessionDocument` | `backend/schemas/sessions.py` | Session document summary. |
| `ExtractionResult` | `backend/schemas/sessions.py` | Session extraction result schema. |
| `SessionMetrics` | `backend/schemas/sessions.py` | Session metric totals. |
| `EvaluationScore` | `backend/schemas/sessions.py` | One evaluation metric score. |
| `EvaluationResult` | `backend/schemas/sessions.py` | Grouped session evaluation result. |
| `Session` | `backend/schemas/sessions.py` | Full session aggregate. |
| `CreateSessionRequest` | `backend/schemas/sessions.py` | Create session request. |
| `UpdateSessionRequest` | `backend/schemas/sessions.py` | Update session request. |
| `SessionSummary` | `backend/schemas/sessions.py` | Session list item. |
| `SessionListResponse` | `backend/schemas/sessions.py` | Session list response. |

## Router-local schemas

| Class | File |
| --- | --- |
| `FileUploadResponse` | `backend/api/files/router.py` |
| `UserFileInfo` | `backend/api/files/router.py` |
| `EvalTaskRequest` | `backend/api/evaluations/jobs.py` |
| `ProviderConfigRequest` | `backend/api/evaluations/jobs.py` |
| `SubmitJobRequest` | `backend/api/evaluations/jobs.py` |
| `ShareSessionRequest` | `backend/api/sessions/router.py` |
| `CreateGroupRequest` | `backend/api/groups/router.py` |
| `UpdateGroupRequest` | `backend/api/groups/router.py` |
| `AddMemberRequest` | `backend/api/groups/router.py` |
| `UpdateMemberRoleRequest` | `backend/api/groups/router.py` |
| `GroupResponse` | `backend/api/groups/router.py` |
| `MemberResponse` | `backend/api/groups/router.py` |
| `GroupDetailResponse` | `backend/api/groups/router.py` |
| `UserSearchResult` | `backend/api/groups/router.py` |
| `EntityModel` | `backend/api/templates/router.py` |
| `VariableModel` | `backend/api/templates/router.py` |
| `CreateTemplateRequest` | `backend/api/templates/router.py` |
| `UpdateTemplateRequest` | `backend/api/templates/router.py` |
| `SetImmutableRequest` | `backend/api/templates/router.py` |
| `SetPermissionRequest` | `backend/api/templates/router.py` |
| `ForkTemplateRequest` | `backend/api/templates/router.py` |
| `ChangeScopeRequest` | `backend/api/templates/router.py` |
| `CreateFolderRequest` | `backend/api/templates/router.py` |
| `RenameFolderRequest` | `backend/api/templates/router.py` |
| `FolderResponse` | `backend/api/templates/router.py` |
| `TemplateResponse` | `backend/api/templates/router.py` |
| `VersionResponse` | `backend/api/templates/router.py` |
| `PermissionResponse` | `backend/api/templates/router.py` |
| `BatchMetricsRequest` | `backend/api/server/router.py` |
| `ChatQueryRequest` | `backend/api/chat/router.py` |
| `ParagraphGenerationRequest` | `backend/api/paragraphgenerator.py` |
| `ParagraphEvalGenerateRequest` | `backend/api/paragraph_evaluation.py` |

## Service classes

| Class | File | Area |
| --- | --- | --- |
| `SQLAlchemyDBService` | `backend/services/database/sqlalchemy_db_service.py` | persistence |
| `SessionService` | `backend/services/session/session_service.py` | session orchestration |
| `GroupService` | `backend/services/groups/group_service.py` | groups/memberships |
| `TemplateService` | `backend/services/templates/template_service.py` | templates |
| `FolderService` | `backend/services/templates/folder_service.py` | template folders |
| `DocumentService` | `backend/services/document/document_service.py` | document façade |
| `OrganizedFileService` | `backend/services/document/organized_file_service.py` | blob-backed file organization |
| `OrganizedDocumentProcessor` | `backend/services/document/organized_processor.py` | organized processing orchestration |
| `FileService` | `backend/services/document/file_service.py` | legacy local file service |
| `BlobStorageClient` | `backend/services/storage/blob_storage.py` | Azure Blob wrapper |
| `AzureDocIntelligenceService` | `backend/services/document/processors/azure_doc_intelligence/azure_doc_intelligence_service.py` | Azure parser |
| `DoclingRemoteClient` | `backend/services/document/processors/docling/docling_remote_client.py` | remote Docling client |
| `DoclingService` | `backend/services/document/processors/docling/docling_service.py` | local Docling parser |
| `_VRAMPeakTracker` | `backend/services/document/processors/docling/docling_service.py` | worker VRAM polling |
| `VRAMStatus` | `backend/services/document/processors/docling/vram_guard.py` | VRAM status data |
| `VRAMGuard` | `backend/services/document/processors/docling/vram_guard.py` | VRAM concurrency guard |
| `LLMService` | `backend/services/llm/llm_service.py` | provider router |
| `AzureLLMClient` | `backend/services/llm/azure.py` | Azure provider |
| `GeminiLLMClient` | `backend/services/llm/gemini.py` | Gemini provider |
| `AnthropicLLMClient` | `backend/services/llm/anthropic.py` | Anthropic Vertex provider |
| `LlamaLLMClient` | `backend/services/llm/llama.py` | Llama MaaS provider |
| `MacbookLLMClient` | `backend/services/llm/macbook.py` | Macbook provider |
| `MacbookRequestQueue` | `backend/services/llm/macbook_queue.py` | Macbook FIFO queue |
| `VLLMClient` | `backend/services/llm/vllm.py` | vLLM provider |
| `EvaluationService` | `backend/services/evaluation/evaluation_service.py` | evaluation orchestration |
| `EvaluationResultStorage` | `backend/services/evaluation/storage/result_storage.py` | JSON result storage |
| `CorrectnessMetricFactory` | `backend/services/evaluation/metrics/correctness.py` | metric factory |
| `CompletenessMetricFactory` | `backend/services/evaluation/metrics/completeness.py` | metric factory |
| `RelevanceMetricFactory` | `backend/services/evaluation/metrics/relevance.py` | metric factory |
| `SafetyMetricFactory` | `backend/services/evaluation/metrics/safety.py` | metric factory |
| `CustomMetricFactory` | `backend/services/evaluation/metrics/custom.py` | metric factory |
| `AzureOpenAIDeepEvalModel` | `backend/services/evaluation/adapters/azure_adapter.py` | evaluation adapter |
| `VertexAIDeepEvalModel` | `backend/services/evaluation/adapters/vertex_adapter.py` | evaluation adapter |
| `AnthropicVertexDeepEvalModel` | `backend/services/evaluation/adapters/anthropic_adapter.py` | evaluation adapter |
| `CallMetric` | `backend/services/telemetry/cost_tracker.py` | telemetry dataclass |
| `BatchMetric` | `backend/services/telemetry/cost_tracker.py` | telemetry dataclass |
| `SessionMetrics` | `backend/services/telemetry/cost_tracker.py` | telemetry dataclass |
| `CostTracker` | `backend/services/telemetry/cost_tracker.py` | cost/session metrics |

## Evaluation job dataclasses/classes

| Class | File | Purpose |
| --- | --- | --- |
| `EvalTask` | `backend/services/evaluation/job_queue.py` | One entity output to evaluate. |
| `ProviderConfig` | `backend/services/evaluation/job_queue.py` | Judge provider config. |
| `TaskResult` | `backend/services/evaluation/job_queue.py` | One task/provider result. |
| `EvalJob` | `backend/services/evaluation/job_queue.py` | Background job runtime state. |
| `_JobStatusProxy` | `backend/services/evaluation/job_queue.py` | DB-backed job status snapshot. |

## Provider structured-output helper schemas

| Class | File | Purpose |
| --- | --- | --- |
| `MarkdownReference` | `backend/services/llm/azure.py` | Azure structured reference. |
| `ExtractionResult` | `backend/services/llm/azure.py` | Azure structured extraction result. |
| `MarkdownReference` | `backend/services/llm/gemini.py` | Gemini structured reference. |
| `ExtractionResult` | `backend/services/llm/gemini.py` | Gemini structured extraction result. |
| `MarkdownReference` | `backend/services/llm/llama.py` | Llama structured reference. |
| `ExtractionResult` | `backend/services/llm/llama.py` | Llama structured extraction result. |
| `MarkdownReference` | `backend/services/llm/vllm.py` | vLLM structured reference. |
| `ExtractionResult` | `backend/services/llm/vllm.py` | vLLM structured extraction result. |
