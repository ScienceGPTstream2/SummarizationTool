# Backend Data-Flow Diagrams

Text diagrams for major backend flows. See the module docs for field-level details.

For visual architecture diagrams, start with the [visual workflow map](../README.md#visual-workflow-map). The SVG diagrams under [`../images/`](../images/) are the primary visual companion to this appendix; the text flows below remain useful for exact request-by-request sequencing.

## 1. Authenticated API request

```text
Frontend
  |
  | Authorization: Bearer <Better Auth token>
  v
FastAPI route
  |
  | Depends(get_current_user)
  v
core.auth.get_current_user()
  |
  | SELECT AuthSession JOIN User WHERE token = ...
  v
PostgreSQL
  |
  | session row + user row
  v
expiry check + optional ALLOWED_EMAILS check
  |
  v
route receives current_user dict
```

## 2. Better Auth proxy

```text
Browser
  |
  | /api/auth/sign-in/*, /api/auth/callback/*, etc.
  v
FastAPI auth proxy router
  |
  | forwards request to localhost/auth sidecar
  v
Better Auth sidecar
  |
  | reads/writes Better Auth DB tables
  v
PostgreSQL
  |
  | Set-Cookie / redirect / JSON response
  v
Browser
```

## 3. File upload

```text
POST /api/upload multipart file
  |
  v
files router
  |
  v
OrganizedFileService.save_uploaded_file()
  |
  +-- compute SHA-256 hash
  +-- infer extension and mime type
  +-- check blob exists: global/{hash}/original.{ext}
  |
  +-- if missing:
  |      upload original bytes
  |      upload global/{hash}/metadata.json
  |
  +-- if user_id:
  |      create Document DB row best-effort
  v
response: file_hash, blob path, dedupe flags, filename, size
```

## 4. Document processing

```text
POST /api/documents/process/file/{file_hash}
  |
  v
documents router
  |
  +-- check existing processed document.md
  |      global/{hash}/processed/{processor}/document.md
  |
  +-- if cache hit:
  |      build document view from metadata/artifacts
  |
  +-- if cache miss:
         get original file from blob to /tmp/summarization/{hash}/original.{ext}
         choose processor
         write local artifacts to /tmp/summarization/{hash}/processed/{processor}/
         sync local artifact tree to blob
         update Document DB processing metadata
         build document view
```

## 5. Azure Document Intelligence processing

```text
local original file or URL
  |
  v
AzureDocIntelligenceService.convert_document_to_markdown()
  |
  +-- begin_analyze_document(..., output markdown + figures)
  +-- wait for poller.result()
  +-- save raw_analysis.json
  +-- save document.md
  +-- regex-extract HTML tables to tables/table-N.html
  +-- download figure PNGs to figures/{figure_id}.png
  +-- save metadata.json
  v
organized processor syncs output tree to blob
```

## 6. Docling processing

```text
local original file
  |
  v
DoclingService / DoclingRemoteClient
  |
  +-- acquire VRAM slot if local Docling path
  +-- worker process converts PDF
  +-- save document.md
  +-- save raw_analysis.json
  +-- save figures/picture-N.png
  +-- save tables/table-N.html
  +-- save metadata.json
  +-- report peak VRAM / OOM to VRAMGuard
  v
organized processor syncs output tree to blob
```

## 7. Document content/read path

```text
GET /api/documents/{file_hash}/content
  |
  v
DocumentService.get_markdown_content()
  |
  +-- resolve processor:
  |      preferred -> azure_doc_intelligence -> docling
  |
  +-- get_processed_content(file_hash, processor)
  |      /tmp cache first
  |      blob fallback
  |
  +-- optional raw_analysis.content fallback
  v
return markdown_content
```

## 8. Entity extraction

```text
POST /api/extract
  |
  v
load markdown + optional figure context
  |
  v
for each Entity concurrently:
  |
  +-- LLMService.extract_entities_from_markdown()
  |      provider dispatch by model_type
  |      provider call + timeout logging
  |      record cost/session metrics on success
  |
  +-- normalize answer/references/meta
  |
  +-- if references and raw analysis available:
  |      match references to bounding boxes
  |
  +-- build extraction result
  |
  +-- if session_id:
         SessionService.add_extraction_result_fast()
         DB upsert by (document_id, entity_name, model_id)
  v
return all entity results
```

## 9. Figure summary generation

```text
POST /api/documents/{file_hash}/figures/{figure_id}/generate-summary
  |
  v
resolve processor + metadata
  |
  v
find figure metadata and image path
  |
  v
read figure image bytes from /tmp cache or blob
  |
  v
LLMService.extract_content_from_image()
  |
  v
update metadata.json with extracted_content / summary
  |
  v
return figure summary result
```

## 10. Single evaluation

```text
POST /api/evaluations/evaluate
  |
  v
EvaluationService.evaluate_extraction()
  |
  +-- create evaluation model adapter
  +-- select metrics
  +-- skip correctness/completeness if no expected_output
  +-- create LLMTestCase
  +-- try combined JSON scoring prompt
  |      parse direct JSON / fenced JSON / extracted JSON / salvaged metric entries
  +-- fallback to per-metric async GEval scoring if needed
  +-- collect call history
  +-- estimate and record cost
  +-- compute aggregate score/all_passed
  v
return evaluation result
```

## 11. Background evaluation job

```text
POST /api/evaluations/jobs
  |
  v
create EvalJob(tasks, providers, session_id, user_id)
  |
  v
submit_job()
  |
  +-- store in in-memory _JOBS
  +-- create EvalJobRecord asynchronously
  +-- start _process_job background task
  |
  v
_process_job()
  |
  +-- status=running, sync DB
  +-- flatten tasks x providers
  +-- compute per-job concurrency
  +-- run _run_single_eval under per-job and global semaphores
  +-- persist session evaluation result
  +-- status=completed/cancelled/failed, sync DB

GET /api/evaluations/jobs/{job_id}
  |
  +-- check _JOBS
  +-- else load EvalJobRecord and return _JobStatusProxy snapshot
```

## 12. Session restore view

```text
GET /api/sessions/{session_id}/restore-view
  |
  v
SessionService.get_session()
  |
  +-- DB session + documents + extractions + evaluations
  +-- convert to Pydantic Session
  |
  v
SessionService.build_restore_view()
  |
  +-- merge files_config sources
  +-- for each document:
         OrganizedFileService.build_document_view()
         check artifact availability
         enumerate figure/table artifacts if needed
  v
return primary file ids + uploadedFiles restore payload
```

## 13. Shared session read

```text
GET /api/sessions/shared/{session_id}
  |
  v
SQLAlchemyDBService.get_session_for_shared_view()
  |
  +-- load AppSession
  +-- require shared_with_group_id is not null
  +-- require UserGroup row for requesting user/group
  +-- load docs/extractions/evaluations
  v
SessionService._db_to_session()
  |
  v
return shared Session
```

## 14. Template update/versioning

```text
PUT /api/templates/{template_id}
  |
  v
TemplateService.update_template()
  |
  +-- load template
  +-- _can_read()
  +-- _can_edit()
  +-- insert TemplateVersion snapshot of current content
  +-- update allowed fields
  +-- increment template.version
  +-- update timestamp
  v
return updated template
```

## 15. Cost recording

```text
provider call succeeds
  |
  v
LLMService._record_session_metrics()
  |
  v
cost_tracker.record_call(session_id, provider, model, tokens, duration)
  |
  +-- update in-memory SessionMetrics
  +-- emit Prometheus metrics if available
  +-- DB increment_session_metrics through executor when event loop exists
  v
session totals visible through server/session-metrics endpoints
```
