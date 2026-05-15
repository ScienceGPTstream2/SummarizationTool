# Evaluation Flow Technical Design

This document describes LLM-as-a-judge evaluation, DeepEval metric construction, batch evaluation, background job execution, cancellation, persistence, and cost tracking.

## 1. Scope

In scope:

- single extraction evaluation;
- batch evaluation;
- custom metric evaluation;
- built-in metric factories;
- provider adapters for Azure, Vertex/Gemini, and Anthropic Vertex;
- background evaluation jobs;
- cancellation;
- result storage;
- session evaluation persistence;
- judge-call cost tracking.

Out of scope:

- frontend evaluation table UI;
- external DeepEval library implementation;
- provider account setup.

## 2. Main classes and files

| Component | File | Responsibility |
| --- | --- | --- |
| `EvaluationService` | `backend/services/evaluation/evaluation_service.py` | Evaluation orchestration, metric creation, combined scoring, batch handling. |
| `EvaluationResultStorage` | `backend/services/evaluation/storage/result_storage.py` | JSON file storage for evaluation outputs. |
| metric factories | `backend/services/evaluation/metrics/*.py` | Create built-in/custom GEval metrics. |
| adapters | `backend/services/evaluation/adapters/*.py` | Wrap provider models for DeepEval. |
| job queue | `backend/services/evaluation/job_queue.py` | Async background evaluation job management. |
| API router | `backend/api/evaluations/router.py` | Synchronous evaluation endpoints. |
| jobs router | `backend/api/evaluations/jobs.py` | Background job submit/poll/cancel endpoints. |
| `EvalJobRecord` | `backend/models/eval_job.py` | Cross-worker job status persistence. |

## 3. API endpoints

Synchronous evaluation endpoints:

```text
POST /api/evaluations/evaluate
POST /api/evaluations/evaluate/batch
POST /api/evaluations/evaluate/custom
POST /api/evaluations/cancel
GET  /api/evaluations/results/{evaluation_id}
GET  /api/evaluations/results
GET  /api/evaluations/metrics/info
```

Background job endpoints:

```text
POST /api/evaluations/jobs
GET  /api/evaluations/jobs/{job_id}
POST /api/evaluations/jobs/{job_id}/cancel
```

## 4. Evaluation model creation

`EvaluationService.create_evaluation_model()` supports:

| Provider id | Adapter |
| --- | --- |
| `azure_openai` | `AzureOpenAIDeepEvalModel` |
| `vertex_ai` | `VertexAIDeepEvalModel` |
| `anthropic` | `AnthropicVertexDeepEvalModel` |

Default models:

- Vertex/Gemini: `EVAL_DEFAULT_GEMINI_MODEL` or `gemini-2.5-flash`.
- Anthropic: `EVAL_DEFAULT_ANTHROPIC_MODEL` or `claude-sonnet-4-5@20250929`.

Unsupported providers raise `ValueError`.

## 5. Built-in metric factories

Metric factory map:

| Metric key | Factory | Evaluation focus |
| --- | --- | --- |
| `correctness` | `CorrectnessMetricFactory` | Factual accuracy against ground truth. |
| `completeness` | `CompletenessMetricFactory` | Coverage of expected key information. |
| `relevance` | `RelevanceMetricFactory` | Focus on the requested entity/task. |
| `safety` | `SafetyMetricFactory` | PII, toxicity, bias, unsupported/harmful claims. |

All built-in metrics are GEval metrics with async mode enabled.

Correctness and completeness require expected output. If no expected output is provided, the service skips those metrics.

## 6. Custom metrics

`CustomMetricFactory.create()` accepts:

- metric name;
- evaluation steps;
- evaluation model;
- evaluation params;
- threshold;
- strict mode.

Default evaluation params are input, actual output, and expected output.

## 7. Combined scoring algorithm

`EvaluationService._evaluate_combined()` is the preferred scoring path for multiple metrics.

Purpose:

- score all metrics in one judge-model call;
- reduce repeated prompt context;
- lower latency/cost compared with one call per metric.

Algorithm:

1. Build a prompt containing extraction task, actual output, optional expected output, and one criteria block per metric.
2. Ask the judge model for a strict JSON object with metric entries.
3. Parse output using multiple recovery strategies:
   - direct `json.loads()`;
   - strip Markdown code fences;
   - extract outermost JSON block with regex;
   - salvage per-metric entries with regex.
4. Clamp scores to `[0, 1]`.
5. Set metric score/reason/success fields.
6. Return list of metric result dictionaries.

If combined scoring fails, `evaluate_extraction()` falls back to per-metric evaluation with `asyncio.gather()`.

## 8. Single extraction evaluation

`EvaluationService.evaluate_extraction()` inputs:

- `entity_name`
- `extraction_prompt`
- `actual_output`
- optional `expected_output`
- optional `metrics`
- `provider`
- `threshold`
- `strict_mode`
- optional `custom_evaluation_steps`
- optional `session_id`
- provider-specific model kwargs

Flow:

```text
create evaluation id
  -> create evaluation model
  -> decide metric set
  -> skip metrics requiring missing expected output
  -> build DeepEval LLMTestCase
  -> try combined scoring
  -> fallback to per-metric concurrent scoring if needed
  -> collect adapter call history
  -> estimate and record cost
  -> compute aggregate score and all_passed
  -> return result dict
```

Success result includes:

- `evaluation_id`
- `entity_name`
- `provider`
- `model`
- `timestamp`
- `evaluation_time`
- `evaluation_cost`
- `metrics`
- `aggregate_score`
- `all_passed`
- `threshold`
- `strict_mode`
- `status='success'`

Error result includes:

- evaluation id;
- entity/provider/timestamp;
- `status='error'`;
- error text.

## 9. Batch evaluation

`EvaluationService.evaluate_multiple_extractions()` accepts a list of extraction dictionaries and runs them in chunks.

Behavior:

1. Clear stale cancellation flag for the session.
2. Default metrics to all four built-ins if omitted.
3. Process extraction mini-batches with `asyncio.gather()`.
4. Check session cancellation between batches.
5. Fill remaining results with `status='cancelled'` if cancelled.
6. Compute batch summary statistics.
7. Save batch result to `EvaluationResultStorage`.

Batch result includes:

- `batch_id`
- `timestamp`
- `batch_time`
- `total_evaluations`
- `successful_evaluations`
- `failed_evaluations`
- `avg_aggregate_score`
- `all_passed`
- `threshold`
- `provider`
- `results`

## 10. Cancellation

`EvaluationService` uses a process-local `CANCELLED_SESSIONS` set.

Helpers:

- `cancel_session(session_id)`
- `clear_cancelled_session(session_id)`
- `is_session_cancelled(session_id)`

`POST /api/evaluations/cancel` reads `X-Session-Id` and marks the session as cancelled.

Limitations:

- This cancellation set is process-local.
- Background job cancellation also uses `EvalJobRecord` DB state for cross-worker cancellation.

## 11. Provider adapters

### 11.1 Azure adapter

`AzureOpenAIDeepEvalModel` wraps `AzureChatOpenAI`.

Configuration order:

1. `backend/core/secrets.toml`
2. constructor args
3. environment variables

Concurrency:

- module-level semaphore of 35.

Important behavior:

- Extracts JSON from prose/code fences.
- Records call history with duration and token usage.
- Supports both sync and async `generate` methods required by DeepEval.

### 11.2 Vertex adapter

`VertexAIDeepEvalModel` wraps `ChatVertexAI`.

Behavior:

- Requires GCP project.
- Sets safety settings to `BLOCK_NONE` for major harm categories.
- Uses module-level semaphore of 25.
- Retries rate-limit/server errors with exponential backoff and jitter.
- Records call history.

### 11.3 Anthropic Vertex adapter

`AnthropicVertexDeepEvalModel` wraps Anthropic Vertex clients.

Behavior:

- Defaults to Claude Sonnet model.
- Uses module-level semaphore of 8.
- Sends user prompt through Anthropic messages API.
- Extracts usage objects with attribute access.
- Records call history.

## 12. Background evaluation jobs

File: `backend/services/evaluation/job_queue.py`

### 12.1 Dataclasses

| Dataclass/class | Purpose |
| --- | --- |
| `EvalTask` | One entity output to evaluate. |
| `ProviderConfig` | Judge provider/model configuration. |
| `TaskResult` | One task/provider evaluation result. |
| `EvalJob` | Job state and serialization. |
| `_JobStatusProxy` | DB-backed read-only job status for non-local jobs. |

### 12.2 Job lifecycle

```text
create_job()
  -> EvalJob(job_id, tasks, providers, session/user id)
  -> submit_job()
       -> store in _JOBS
       -> create EvalJobRecord asynchronously
       -> start _process_job(job) background task

_process_job()
  -> mark running and sync DB
  -> flatten tasks x providers
  -> compute per-job concurrency
  -> run work items with global and per-job semaphores
  -> mark completed/cancelled/failed
  -> final DB sync
```

### 12.3 Concurrency

- Global LLM concurrency cap: `GLOBAL_LLM_CONCURRENCY = 30`.
- `_LLM_SEMAPHORE` protects total concurrent judge calls.
- Per-job concurrency is computed as:

```text
max(1, GLOBAL_LLM_CONCURRENCY // active_running_jobs)
```

Each individual evaluation is wrapped in `asyncio.wait_for(..., timeout=60.0)`.

### 12.4 Job persistence

`EvalJobRecord` stores:

- job id;
- session id;
- user id;
- status;
- progress/total;
- results/errors;
- top-level error;
- created/completed timestamps.

`get_job(job_id)` checks in-memory `_JOBS` first, then falls back to DB status through `_JobStatusProxy`.

### 12.5 Job cancellation

`cancel_job(job_id)`:

- if job is local, sets `cancelled=True` and cancels live asyncio tasks;
- if job is not local, marks the DB record cancelled.

## 13. Session persistence of evaluation results

During background jobs, successful task results are converted into `schemas.sessions.EvaluationScore` and `schemas.sessions.EvaluationResult`, then persisted through:

```python
SessionService.add_evaluation_result_fast(...)
```

`SessionService` matches the evaluation to an extraction by:

- entity name;
- model id;
- document id or file hash when available;
- paragraph-summary fallback for `__paragraph_summary__`.

Evaluation DB upsert target:

```text
(extraction_result_id, metric, judge_model)
```

Constraint name:

```text
uq_eval_extraction_metric_judge
```

## 14. Result storage

`EvaluationResultStorage` saves JSON files under:

```text
backend/output/evaluations/{evaluation_id}.json
```

Methods:

- `save(evaluation_id, result)`
- `get(evaluation_id)`
- `list_all()` sorted by timestamp descending
- `delete(evaluation_id)`
- `get_storage_path()`

This storage is separate from normalized DB persistence of per-extraction evaluation scores.

## 15. Cost tracking

Evaluation service records judge-call costs from adapter call history.

For each adapter call:

1. estimate cost with `cost_tracker.estimate_call_cost()`;
2. record call with `cost_tracker.record_call()` when session id exists;
3. sum costs into `evaluation_cost`.

The returned evaluation result includes total evaluation cost and evaluation time.

## 16. Error classification

The job queue includes helpers for classifying errors:

- `_is_timeout_error()`
- `_is_rate_limit_error()`
- `_is_non_retryable_error()`

Retry delay constants are defined for normal and rate-limit failures, but current `MAX_ATTEMPTS` is 1 for single job tasks.

## 17. Related docs

- [02-api-surface.md](02-api-surface.md)
- [04-schemas.md](04-schemas.md)
- [06-llm-layer.md](06-llm-layer.md)
- [09-session-sharing-groups.md](09-session-sharing-groups.md)
- [appendices/risks-assumptions-testing.md](appendices/risks-assumptions-testing.md)
