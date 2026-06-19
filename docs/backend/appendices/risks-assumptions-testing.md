# Risks, Assumptions, and Testing Strategy

This appendix captures implementation assumptions, technical risks, and recommended tests for the backend TDD.

## 1. Assumptions

### 1.1 Runtime assumptions

- PostgreSQL is available through `DATABASE_URL` or `POSTGRES_*` environment variables.
- Alembic migrations have been applied before the backend serves production traffic.
- Better Auth sidecar is running and shares the same PostgreSQL database.
- In production, `/api/auth/*` requests reach FastAPI first and are proxied to the auth sidecar.
- Azure Blob Storage connection string is present when using the organized file service.
- External model providers may be partially configured; unavailable providers should not prevent app startup.
- Production backend uses one Gunicorn worker per container replica to avoid duplicating heavyweight parser/model state.

### 1.2 Data assumptions

- File hash is the stable identity for uploaded file content.
- Processed artifact trees are organized by file hash and processor name.
- `document.md` is the strict signal that a file is fully processed.
- Partial artifact trees may still be useful for analysis/debug endpoints.
- Session extraction/evaluation persistence depends on matching document id or file hash, especially for multi-document sessions.
- Prompt template scopes are one of `user`, `group`, or `global`.

### 1.3 Provider assumptions

- Provider result dictionaries include enough metadata for token/cost tracking when calls succeed.
- Structured extraction providers may return `answer` and `references`, but downstream code must tolerate provider-specific shapes.
- Evaluation adapters can expose call history with token usage for cost estimation.
- Provider timeouts/retries vary by provider and are part of current behavior.

## 2. Technical risks

| Risk | Likelihood | Impact | Mitigation / management |
| --- | --- | --- | --- |
| ORM defaults differ from DB server defaults | Medium | Medium | Prefer ORM writes; add tests for direct migration schema; document model/migration mismatches. |
| File hash leakage allows artifact probing | Low/Medium | High | Keep file endpoints authenticated where possible; validate access model before public sharing. |
| Global template operations are too permissive | Medium | Medium | Review global-scope creation/folder management before enabling broad users. |
| Provider response shape drift | High | Medium | Normalize provider outputs in one place; add tests with recorded sample responses. |
| Evaluation combined JSON parsing fails | Medium | Medium | Keep per-metric fallback path; test malformed/fenced/partial JSON outputs. |
| Docling OOM or GPU pressure | Medium | High | VRAMGuard, worker peak reporting, OOM estimate bumping, one worker per container process. |
| Background jobs across replicas lose in-memory state | Medium | Medium | Persist `EvalJobRecord`; polling falls back to DB snapshot. |
| Cancellation is process-local for synchronous batch evaluation | Medium | Medium | Use job-based evaluation for cross-worker cancellation; document process-local limitation. |
| Blob/local cache inconsistency | Medium | Medium | Read from `/tmp` first but blob fallback; sync output tree only after successful processing. |
| Text with null bytes breaks PostgreSQL writes | Medium | Low/Medium | Use `sanitize_text()` in DB write paths. |
| CORS default is permissive | Medium | High in production | Set explicit `CORS_ALLOWED_ORIGINS` in production. |
| Telemetry write blocks request loop | Low | Medium | CostTracker schedules DB metrics updates through executor. |

## 3. Recommended test coverage

## 3.1 Auth and security tests

- `get_current_user` accepts valid Authorization bearer token.
- `get_current_user` rejects missing token, invalid token, expired token.
- `ALLOWED_EMAILS` denies non-allowlisted email.
- Auth proxy forwards headers and preserves `Set-Cookie` behavior.
- CORS uses `*` when unset and comma-separated origins when configured.
- File/figure/table endpoints reject unsafe filenames.
- `sanitize_text()` removes null bytes/control chars and preserves tab/newline/carriage return.

## 3.2 Database/model tests

- Alembic migrations create all expected tables, indexes, and constraints.
- ORM insert defaults populate expected fields for `AppSession`, `Document`, `ExtractionResult`, and `EvalJobRecord`.
- Unique upsert constraints work for:
  - extraction `(document_id, entity_name, model_id)`;
  - evaluation `(extraction_result_id, metric, judge_model)`;
  - template permission `(template_id, user_id)`;
  - template version `(template_id, version)`.
- `PromptTemplate.entities` model/migration nullability mismatch is either fixed or documented by tests.
- Direct SQL insert behavior is known for fields without server defaults.

## 3.3 File and document processing tests

- Upload same bytes twice returns same hash and dedupe flags.
- Upload metadata is written to expected blob path.
- DB document registration failure does not fail upload.
- `resolve_processed_processor()` respects preferred processor and fallback order.
- `is_file_processed()` requires `document.md`.
- `get_processing_file_bytes()` reads local cache before blob and caches blob downloads.
- `build_document_view()` returns stable top-level and `processingResult` fields.
- Artifact availability flags reflect blob state.
- Figure/table fallback enumeration works when metadata counts are missing.

## 3.4 Azure parser tests

- Azure unavailable returns false availability.
- File source and URL source build different Azure analyze requests.
- Successful conversion writes `document.md`, `raw_analysis.json`, `metadata.json`, figures, and tables.
- Table extraction from markdown HTML is correct.
- Missing Azure figure result id does not fail the whole conversion.
- Error path returns structured failure with conversion id.

## 3.5 Docling parser and VRAM tests

- Worker returns structured success with markdown, raw analysis, image info, page count, peak VRAM.
- Worker returns structured failure on exception.
- Markdown table replacement preserves intended table order.
- `VRAMGuard.acquire_slot()` handles admission, queue count, release, and timeout.
- `VRAMGuard.report_worker_result()` updates per-worker estimate and max workers.
- `VRAMGuard.report_oom()` bumps estimate and can shrink max workers.
- Persisted VRAM state loads only when version and age are valid.

## 3.6 Bounding-box tests

- Azure normalization converts inch page dimensions and polygons to points.
- Azure paragraph match works for exact and fuzzy references.
- Azure line fallback works when paragraph match is absent.
- Azure figure-reference extraction detects Figure/Fig variants.
- Docling normalization returns expected page/paragraph/table/figure shape.
- Docling polygon extraction handles valid and malformed polygons.
- Unknown processor raw analysis passes through unchanged.

## 3.7 LLM provider tests

Use mocked provider responses, not live API calls, for unit tests.

- `LLMService` dispatches correctly by `model_type`.
- Disabled provider returns `success=False` without crashing.
- Timeout wrapper logs and re-raises timeout.
- Azure structured extraction success maps answer/references/meta.
- Azure fallback path handles structured-output failure.
- Gemini structured output parses JSON and records retry metadata.
- Anthropic JSON-prompt mode parses answer/references.
- Llama primary and fallback strategies return expected strategy metadata.
- Macbook queue serializes concurrent requests.
- vLLM strips `vllm-` prefix before sending model id.
- Successful provider calls record session metrics.

## 3.8 Extraction flow tests

- Missing markdown returns API error.
- One request with multiple entities runs all entity tasks and returns per-entity results.
- Entity-level system prompt is passed to provider call.
- Figure context includes generated figure summaries when present.
- Provider references are matched to bbox data when raw analysis exists.
- Extraction persistence upserts existing result instead of duplicating.
- Multi-document session without file hash refuses to guess target document.
- Failed entity extraction can coexist with successful entities in one response.

## 3.9 Evaluation tests

- Metric factory map creates correctness/completeness/relevance/safety metrics.
- Correctness/completeness are skipped without expected output.
- Combined scoring parses direct JSON, fenced JSON, extracted JSON block, and partial salvaged metric entries.
- Combined scoring clamps scores to `[0,1]`.
- Per-metric fallback runs when combined parse fails.
- Batch evaluation honors cancellation between chunks.
- Evaluation cost is computed from adapter call history.
- Result storage saves, reads, lists, and deletes JSON files.

## 3.10 Evaluation job tests

- `create_job()` builds expected total from tasks x providers.
- `submit_job()` stores in memory and creates DB record.
- `get_job()` returns memory job first, DB proxy second.
- `cancel_job()` cancels local task handles when local.
- `cancel_job()` marks DB cancelled when non-local.
- `_run_single_eval()` persists session evaluation result on success.
- Per-job concurrency changes when multiple jobs run.
- Completed jobs are cleaned after TTL.

## 3.11 Session tests

- Create session with no docs, one doc, partial doc failures, and all doc failures.
- Config-only update returns lightweight session.
- `evaluation_config` and `files_config` merge instead of replace nested values unexpectedly.
- Extraction result matching uses file hash/document id correctly.
- Evaluation result matching preserves document-specific results.
- Human-score update applies to intended judge/model metrics.
- Restore-view returns expected primary file and uploaded files.
- Shared session requires group membership.

## 3.12 Group tests

- Group creation creates owner membership.
- Non-member cannot read group detail.
- System admin can read/update/delete according to service logic.
- Admin/owner can add members.
- Adding owner role normalizes to admin for new members.
- Cannot change to/from owner through role update endpoint.
- Only owner can promote member to admin.
- Only-owner self-removal is blocked.
- Membership responses are enriched with user profile data.

## 3.13 Template/folder tests

- Create template validates scope.
- Group-scope create requires group id and membership.
- Get/list templates enforce `_can_read()`.
- `_can_edit()` denies immutable templates.
- Update creates `TemplateVersion` snapshot before mutation.
- Revert creates a new version through update path.
- Fork creates user-scope mutable copy.
- Scope transitions enforce old/new scope permission rules.
- Explicit permission upsert uses unique constraint.
- Folder create validates parent scope/group.
- Folder delete refuses non-empty folders.

## 4. Manual smoke tests

For integrated backend verification:

1. Start Postgres, auth sidecar, backend, and frontend.
2. Log in through Better Auth.
3. Upload a PDF.
4. Process with Azure Document Intelligence.
5. Fetch markdown/content/analysis/figures.
6. Extract at least two entities with one model.
7. Save session and reload restore view.
8. Run evaluation for one extraction.
9. Submit background evaluation job and poll until completed.
10. Create group, share session, verify another group member can open shared restore view.
11. Create template, update it, verify version history, fork it, and change scope.
12. Check `/api/server/session-metrics` and `/api/server/logs`.

## 5. Documentation maintenance checklist

When backend changes:

- New route: update `../02-api-surface.md` and `api-endpoint-index.md`.
- New ORM model/migration: update `../03-data-models.md` and `class-index.md`.
- New schema: update `../04-schemas.md` and `class-index.md`.
- New parser/artifact: update `../05-document-processing.md` and data-flow diagrams.
- New model provider: update `../06-llm-layer.md`, security/config docs, and tests.
- New evaluation metric/provider: update `../08-evaluation-flow.md`.
- New auth/permission behavior: update `../11-auth-security-observability.md` and risk table.
