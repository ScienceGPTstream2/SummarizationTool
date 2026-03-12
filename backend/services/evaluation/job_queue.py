"""
Evaluation Job Queue
====================
Background asyncio-based job queue for processing entity evaluations.

Design goals:
- Single API call from frontend per "Run Evaluation" click
- Global semaphore caps total concurrent LLM calls across ALL users
  (prevents provider rate-limit storms under concurrent load)
- Per-job semaphore caps concurrent LLM calls per individual job
  (ensures fairness — no single user starves others who joined later)
- Job survives frontend disconnects (user closing tab doesn't kill the job)
- Clean cancellation: flip a flag, at most 1 in-flight task finishes
- In-memory registry (no Redis/Celery needed for single-machine A100 deployment)
"""

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from services.evaluation.evaluation_service import EvaluationService

# ---------------------------------------------------------------------------
# Error classification helpers
# ---------------------------------------------------------------------------
_RATE_LIMIT_KEYWORDS = (
    "rate limit",
    "ratelimit",
    "quota",
    "429",
    "too many requests",
    "resource exhausted",
    "requests per minute",
    "tokens per minute",
    "capacity",
)

# Errors that are deterministic — retrying the same call with the same model
# will produce the same failure.  Skip all retries so the user sees the result
# (or partial result from other judges) immediately instead of waiting N×delay.
_NON_RETRYABLE_KEYWORDS = (
    "invalid json",
    "please use a better evaluation model",
    "json",           # JSON parse / decode errors from DeepEval
    "unauthorized",
    "authentication",
    "api key",
    "invalid api",
    "not found",
    "deployment not found",
    "model not found",
    "does not exist",
    "bad request",
)


def _is_rate_limit_error(exc: Exception) -> bool:
    """Return True when the exception looks like a provider rate-limit."""
    msg = str(exc).lower()
    return any(kw in msg for kw in _RATE_LIMIT_KEYWORDS)


def _is_non_retryable_error(exc: Exception) -> bool:
    """Return True for errors that won't improve with a retry.

    JSON parse failures from weak eval models, auth errors, and missing
    deployments are deterministic — retrying only wastes time.
    Rate-limit errors are explicitly excluded so they still get their backoff.
    """
    if _is_rate_limit_error(exc):
        return False  # rate limits ARE worth retrying after a delay
    msg = str(exc).lower()
    return any(kw in msg for kw in _NON_RETRYABLE_KEYWORDS)


# Retry delays in seconds for TRANSIENT errors only.
# Rate-limit:  longer back-off so the quota window can recover.
# Other transient (network, server 5xx): short pause.
_RETRY_DELAYS_NORMAL = [3, 10]       # attempt 0→1, attempt 1→2
_RETRY_DELAYS_RATE_LIMIT = [15, 45]  # attempt 0→1, attempt 1→2

# ---------------------------------------------------------------------------
# Concurrency tuning
# ---------------------------------------------------------------------------
# GLOBAL_LLM_CONCURRENCY: max concurrent evaluate_extraction() calls across ALL jobs.
# Each call spawns N_metrics async LLM sub-calls; the per-provider API semaphores
# in the adapters (Azure=25, Vertex=25, Anthropic=8) are the real rate-limit guard.
# Set this high enough that the adapter semaphores — not this value — are always
# the bottleneck.  100 concurrent evals × 4 metrics = 400 queued a_generate calls,
# which keeps all provider semaphore slots fully saturated.
GLOBAL_LLM_CONCURRENCY: int = 100
_LLM_SEMAPHORE: asyncio.Semaphore = asyncio.Semaphore(GLOBAL_LLM_CONCURRENCY)

# PER_JOB_CONCURRENCY is computed dynamically at job-start time:
#   max(1, GLOBAL_LLM_CONCURRENCY // active_running_jobs)
# This means:
#   1 user  → 100 concurrent slots (all of it)
#   2 users →  50 each
#   4 users →  25 each
#  10 users →  10 each (minimum, prevents total starvation)
# No hardcoded user count needed.

# ---------------------------------------------------------------------------
# Job data structures
# ---------------------------------------------------------------------------


@dataclass
class EvalTask:
    """One atomic unit of work: evaluate a single entity extraction."""

    entity_name: str
    source_model: str
    actual_output: str
    extraction_prompt: str
    expected_output: Optional[str] = None
    file_hash: Optional[str] = None
    file_id: Optional[str] = None  # frontend fileId for UI state updates


@dataclass
class ProviderConfig:
    """Configuration for a single judge LLM."""

    provider_id: str  # e.g. "azure-gpt4o"
    provider: str  # "azure_openai" | "vertex_ai" | "anthropic"
    model_name: Optional[str] = None
    deployment: Optional[str] = None
    endpoint: Optional[str] = None
    api_key: Optional[str] = None


@dataclass
class TaskResult:
    """Result of evaluating one task with one provider."""

    entity_name: str
    source_model: str
    file_id: Optional[str]
    file_hash: Optional[str]
    provider_id: str
    provider: str
    model: str
    aggregate_score: float
    all_passed: bool
    evaluation_time: float
    evaluation_cost: float
    metrics: List[Dict[str, Any]]
    ground_truth: Optional[str] = None


@dataclass
class EvalJob:
    """A batch evaluation job submitted by a user."""

    job_id: str
    session_id: str
    user_id: str
    tasks: List[EvalTask]
    providers: List[ProviderConfig]
    metrics: List[str]
    custom_evaluation_steps: Dict[str, List[str]]
    threshold: float = 0.7

    # Runtime state
    status: str = "pending"  # pending | running | completed | cancelled | failed
    progress: int = 0
    total: int = 0
    results: List[TaskResult] = field(default_factory=list)
    errors: List[Dict[str, str]] = field(default_factory=list)  # {entity_name, provider_id, error}
    cancelled: bool = False
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
    # Internal: live asyncio Task handles so cancel_job() can stop in-flight calls.
    # Not serialised — excluded from to_status_dict().
    _asyncio_tasks: List[Any] = field(default_factory=list, repr=False)

    def to_status_dict(self) -> Dict[str, Any]:
        """Serialise for the status polling endpoint."""
        return {
            "job_id": self.job_id,
            "status": self.status,
            "progress": self.progress,
            "total": self.total,
            "results": [
                {
                    "entity_name": r.entity_name,
                    "source_model": r.source_model,
                    "file_id": r.file_id,
                    "file_hash": r.file_hash,
                    "provider_id": r.provider_id,
                    "provider": r.provider,
                    "model": r.model,
                    "aggregate_score": r.aggregate_score,
                    "all_passed": r.all_passed,
                    "evaluation_time": r.evaluation_time,
                    "evaluation_cost": r.evaluation_cost,
                    "metrics": r.metrics,
                    "ground_truth": r.ground_truth,
                }
                for r in self.results
            ],
            # Structured errors so the frontend can identify which entity/provider
            # failed and flip its badge from "Evaluating" to a visible error state.
            "errors": self.errors,
            "error": self.error,
            "created_at": self.created_at.isoformat(),
            "completed_at": (
                self.completed_at.isoformat() if self.completed_at else None
            ),
        }


# ---------------------------------------------------------------------------
# In-memory job registry
# ---------------------------------------------------------------------------
_JOBS: Dict[str, EvalJob] = {}
_eval_service = EvaluationService()

# ---------------------------------------------------------------------------
# Background job cleanup
# ---------------------------------------------------------------------------
_JOB_TTL_SECONDS: int = 3600        # evict terminal jobs after 1 hour
_CLEANUP_INTERVAL_SECONDS: int = 600 # run cleanup every 10 minutes
_cleanup_task: Optional[asyncio.Task] = None


async def _cleanup_loop() -> None:
    """Background coroutine: evict completed/cancelled/failed jobs older than TTL."""
    while True:
        await asyncio.sleep(_CLEANUP_INTERVAL_SECONDS)
        now = datetime.now(timezone.utc)
        to_delete = [
            job_id
            for job_id, job in list(_JOBS.items())
            if job.status in ("completed", "cancelled", "failed")
            and job.completed_at is not None
            and (now - job.completed_at).total_seconds() > _JOB_TTL_SECONDS
        ]
        for job_id in to_delete:
            del _JOBS[job_id]
        if to_delete:
            print(f"[JobQueue] Evicted {len(to_delete)} expired job(s) (TTL={_JOB_TTL_SECONDS}s)")


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------


async def _run_single_eval(
    job: EvalJob,
    task: EvalTask,
    provider: ProviderConfig,
    per_job_sem: asyncio.Semaphore,
) -> None:
    """Evaluate one task with one provider, respecting both semaphores.

    Retry back-off sleeps happen OUTSIDE both semaphores so a sleeping task
    never parks a concurrency slot — other users keep making progress during
    the wait.  Each retry re-acquires both semaphores independently.
    """
    if job.cancelled:
        return

    # Build model kwargs once — identical for every attempt.
    model_kwargs: Dict[str, Any] = {}
    if provider.provider == "azure_openai":
        model_kwargs = {
            "deployment": provider.deployment or provider.model_name,
            "model_name": provider.model_name,
            "endpoint": provider.endpoint,
            "api_key": provider.api_key,
        }
    elif provider.provider == "vertex_ai":
        model_kwargs = {"model_name": provider.model_name or "gemini-2.5-flash"}
    elif provider.provider == "anthropic":
        model_kwargs = {
            "model_name": provider.model_name or "claude-sonnet-4-5@20250929"
        }

    MAX_ATTEMPTS = 3
    last_exc: Optional[Exception] = None
    result = None

    for attempt in range(MAX_ATTEMPTS):
        # Back-off sleep BEFORE re-acquiring — semaphore slots are free while waiting.
        if attempt > 0 and last_exc is not None:
            is_rl = _is_rate_limit_error(last_exc)
            delay = (
                _RETRY_DELAYS_RATE_LIMIT[attempt - 1]
                if is_rl
                else _RETRY_DELAYS_NORMAL[attempt - 1]
            )
            print(
                f"[JobQueue] Attempt {attempt}/{MAX_ATTEMPTS} failed "
                f"({'rate-limit' if is_rl else 'error'}) "
                f"for {task.entity_name}/{provider.provider_id}: "
                f"{last_exc}. Retrying in {delay}s…"
            )
            await asyncio.sleep(delay)  # semaphores NOT held here

        if job.cancelled:
            return

        try:
            async with per_job_sem:
                async with _LLM_SEMAPHORE:
                    if job.cancelled:
                        return
                    result = await asyncio.wait_for(
                        _eval_service.evaluate_extraction(
                            entity_name=task.entity_name,
                            extraction_prompt=task.extraction_prompt,
                            actual_output=task.actual_output,
                            expected_output=task.expected_output,
                            metrics=job.metrics,
                            provider=provider.provider,
                            threshold=job.threshold,
                            custom_evaluation_steps=job.custom_evaluation_steps or None,
                            session_id=job.session_id,
                            **model_kwargs,
                        ),
                        timeout=90.0,
                    )
            last_exc = None
            break  # success — exit retry loop
        except asyncio.CancelledError:
            # Task was cancelled via cancel_job() — exit immediately without
            # recording an error. The finally block still increments progress.
            return
        except Exception as exc:
            last_exc = exc
            is_rl = _is_rate_limit_error(exc)
            is_final = attempt == MAX_ATTEMPTS - 1 or _is_non_retryable_error(exc)
            if is_final:
                # Record error and stop retrying.
                job.errors.append({
                    "entity_name": task.entity_name,
                    "source_model": task.source_model,
                    "file_id": task.file_id,
                    "provider_id": provider.provider_id,
                    "error": str(exc),
                    "error_type": "rate_limit" if is_rl else "error",
                })
                break  # exit retry loop immediately for non-retryable errors

    # -----------------------------------------------------------------------
    # Post-retry: persist result or propagate terminal error
    # -----------------------------------------------------------------------
    try:
        if last_exc is not None:
            raise last_exc  # already recorded in job.errors above

        if result is None:
            return  # cancelled mid-flight

        if result.get("status") == "error":
            err_msg = result.get("error", "unknown error")
            job.errors.append({
                "entity_name": task.entity_name,
                "source_model": task.source_model,
                "file_id": task.file_id,
                "provider_id": provider.provider_id,
                "error": err_msg,
                "error_type": "rate_limit" if _is_rate_limit_error(Exception(err_msg)) else "error",
            })
            return

        task_result = TaskResult(
            entity_name=task.entity_name,
            source_model=task.source_model,
            file_id=task.file_id,
            file_hash=task.file_hash,
            provider_id=provider.provider_id,
            provider=result.get("provider", provider.provider),
            model=result.get("model", provider.model_name or ""),
            aggregate_score=result.get("aggregate_score", 0.0),
            all_passed=result.get("all_passed", False),
            evaluation_time=result.get("evaluation_time", 0.0),
            evaluation_cost=result.get("evaluation_cost", 0.0),
            metrics=result.get("metrics", []),
            ground_truth=task.expected_output,
        )
        job.results.append(task_result)

        # Persist to DB immediately so progress is durable
        from services.session.session_service import get_session_service
        from schemas.sessions import EvaluationResult, EvaluationScore

        metric_name_map = {
            "Entity Extraction Correctness": "correctness",
            "Entity Extraction Completeness": "completeness",
            "Entity Extraction Relevance": "relevance",
            "Entity Extraction Safety": "safety",
            "correctness": "correctness",
            "completeness": "completeness",
            "relevance": "relevance",
            "safety": "safety",
        }

        scores = [
            EvaluationScore(
                metric=metric_name_map.get(
                    m.get("metric_name", ""),
                    m.get("metric_name", "unknown").lower().split()[-1],
                ),
                score=m.get("score"),
                reasoning=m.get("reason"),
                judge_model=result.get("model"),
                human_score=None,
                evaluation_cost=(
                    task_result.evaluation_cost / len(result.get("metrics", [1]))
                    if result.get("metrics")
                    else None
                ),
                evaluation_time=(
                    task_result.evaluation_time / len(result.get("metrics", [1]))
                    if result.get("metrics")
                    else None
                ),
            )
            for m in result.get("metrics", [])
        ]

        eval_result = EvaluationResult(
            entity_name=task.entity_name,
            model_id=task.source_model,
            file_hash=task.file_hash,
            ground_truth=task.expected_output,
            scores=scores,
            evaluation_cost=task_result.evaluation_cost,
            evaluation_time=task_result.evaluation_time,
        )

        svc = get_session_service()
        svc.add_evaluation_result_fast(job.user_id, job.session_id, eval_result)

    except Exception as exc:
        # Only record if the retry loop didn't already write an error entry.
        if not any(
            e.get("entity_name") == task.entity_name
            and e.get("source_model") == task.source_model
            and e.get("file_id") == task.file_id
            and e.get("provider_id") == provider.provider_id
            for e in job.errors
        ):
            is_rl = _is_rate_limit_error(exc)
            job.errors.append({
                "entity_name": task.entity_name,
                "source_model": task.source_model,
                "file_id": task.file_id,
                "provider_id": provider.provider_id,
                "error": str(exc),
                "error_type": "rate_limit" if is_rl else "error",
            })
    finally:
        job.progress += 1


async def _process_job(job: EvalJob) -> None:
    """Process all tasks in a job, respecting cancellation."""
    job.status = "running"

    # Build flat list of (task, provider) pairs — one per LLM call
    work_items = [(task, provider) for task in job.tasks for provider in job.providers]
    job.total = len(work_items)

    # Dynamically compute per-job concurrency based on active running jobs.
    # This is fair regardless of how many users are connected:
    #   1 user  → all 10 global slots
    #   4 users → ~2-3 each
    #   10 users → 1 each (minimum)
    active_running = max(1, sum(1 for j in _JOBS.values() if j.status == "running"))
    per_job_slots = max(1, GLOBAL_LLM_CONCURRENCY // active_running)
    per_job_sem = asyncio.Semaphore(per_job_slots)
    print(
        f"[JobQueue] Job {job.job_id[:8]}: {per_job_slots} slots/job ({active_running} active jobs)"
    )

    # Launch all work items as asyncio tasks competing for both semaphores.
    # Store handles so cancel_job() can forcibly stop in-flight tasks.
    eval_tasks = [
        asyncio.create_task(_run_single_eval(job, task, provider, per_job_sem))
        for task, provider in work_items
    ]
    job._asyncio_tasks = eval_tasks

    await asyncio.gather(*eval_tasks, return_exceptions=True)

    job.status = "cancelled" if job.cancelled else "completed"
    job.completed_at = datetime.now(timezone.utc)

    # Mark session as completed in DB
    if not job.cancelled and job.session_id:
        try:
            from services.session.session_service import get_session_service
            from schemas.sessions import UpdateSessionRequest

            svc = get_session_service()
            svc.update_session(
                job.user_id,
                job.session_id,
                UpdateSessionRequest(user_id=job.user_id, status="completed"),
            )
        except Exception as exc:
            print(f"[JobQueue] Failed to mark session completed: {exc}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def submit_job(job: EvalJob) -> EvalJob:
    """
    Register a job and start processing it as a background asyncio task.

    The job is returned immediately with status='pending'. The caller should
    poll GET /api/evaluations/jobs/{job_id} for status updates.
    """
    global _cleanup_task
    _JOBS[job.job_id] = job

    # Start the cleanup loop once, the first time any job is submitted.
    if _cleanup_task is None or _cleanup_task.done():
        _cleanup_task = asyncio.create_task(_cleanup_loop())

    # asyncio.create_task schedules the coroutine on the running event loop
    # without blocking the caller. Multiple jobs run concurrently, all sharing
    # _LLM_SEMAPHORE.
    asyncio.create_task(_process_job(job))
    return job


def get_job(job_id: str) -> Optional[EvalJob]:
    """Return the job, or None if not found."""
    return _JOBS.get(job_id)


def cancel_job(job_id: str) -> bool:
    """
    Request cancellation of a job.

    Sets cancelled=True AND cancels all live asyncio tasks, which propagates
    CancelledError through wait_for → evaluate_extraction → ainvoke, aborting
    any in-flight HTTP requests to the LLM provider immediately.
    """
    job = _JOBS.get(job_id)
    if job is None:
        return False
    job.cancelled = True
    cancelled_count = 0
    for task in job._asyncio_tasks:
        if not task.done():
            task.cancel()
            cancelled_count += 1
    if cancelled_count:
        print(f"[JobQueue] Cancelled {cancelled_count} in-flight tasks for job {job_id[:8]}")
    return True


def create_job(
    session_id: str,
    user_id: str,
    tasks: List[EvalTask],
    providers: List[ProviderConfig],
    metrics: List[str],
    custom_evaluation_steps: Optional[Dict[str, List[str]]] = None,
    threshold: float = 0.7,
) -> EvalJob:
    """Factory: create and submit a new evaluation job."""
    job = EvalJob(
        job_id=str(uuid.uuid4()),
        session_id=session_id,
        user_id=user_id,
        tasks=tasks,
        providers=providers,
        metrics=metrics,
        custom_evaluation_steps=custom_evaluation_steps or {},
        threshold=threshold,
    )
    return submit_job(job)
