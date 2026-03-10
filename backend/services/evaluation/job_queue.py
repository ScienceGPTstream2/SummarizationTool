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
# Concurrency tuning
# ---------------------------------------------------------------------------
# GLOBAL_LLM_CONCURRENCY: hard ceiling on simultaneous LLM calls across ALL jobs.
# Tune based on your Azure OpenAI / Vertex AI quota.
GLOBAL_LLM_CONCURRENCY: int = 100
_LLM_SEMAPHORE: asyncio.Semaphore = asyncio.Semaphore(GLOBAL_LLM_CONCURRENCY)

# PER_JOB_CONCURRENCY is computed dynamically at job-start time:
#   max(1, GLOBAL_LLM_CONCURRENCY // active_running_jobs)
# This means:
#   1 user  → 10 concurrent slots (all of it)
#   2 users →  5 each
#   4 users →  2-3 each
#  10 users →  1 each (minimum, prevents total starvation)
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
    errors: List[str] = field(default_factory=list)
    cancelled: bool = False
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None
    error: Optional[str] = None

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
# Worker
# ---------------------------------------------------------------------------


async def _run_single_eval(
    job: EvalJob,
    task: EvalTask,
    provider: ProviderConfig,
    per_job_sem: asyncio.Semaphore,
) -> None:
    """Evaluate one task with one provider, respecting both semaphores."""
    if job.cancelled:
        return

    # Acquire per-job limit first (fairness across users),
    # then global limit (rate-limit protection).
    async with per_job_sem:
        async with _LLM_SEMAPHORE:
            # Re-check after acquiring — job may have been cancelled while waiting.
            if job.cancelled:
                return

            try:
                # Build model kwargs for the provider
                model_kwargs: Dict[str, Any] = {}
                if provider.provider == "azure_openai":
                    model_kwargs = {
                        "deployment": provider.deployment or provider.model_name,
                        "model_name": provider.model_name,
                        "endpoint": provider.endpoint,
                        "api_key": provider.api_key,
                    }
                elif provider.provider == "vertex_ai":
                    model_kwargs = {
                        "model_name": provider.model_name or "gemini-2.5-flash"
                    }
                elif provider.provider == "anthropic":
                    model_kwargs = {
                        "model_name": provider.model_name
                        or "claude-sonnet-4-5@20250929"
                    }

                result = await _eval_service.evaluate_extraction(
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
                )

                if result.get("status") == "error":
                    job.errors.append(
                        f"{task.entity_name}/{provider.provider_id}: {result.get('error', 'unknown error')}"
                    )
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
                            task_result.evaluation_cost
                            / len(result.get("metrics", [1]))
                            if result.get("metrics")
                            else None
                        ),
                        evaluation_time=(
                            task_result.evaluation_time
                            / len(result.get("metrics", [1]))
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
                job.errors.append(f"{task.entity_name}/{provider.provider_id}: {exc}")
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
    eval_tasks = [
        asyncio.create_task(_run_single_eval(job, task, provider, per_job_sem))
        for task, provider in work_items
    ]

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
    _JOBS[job.job_id] = job
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

    Sets cancelled=True; the worker loop checks this before every LLM call.
    At most one in-flight LLM call will still complete after this returns.
    """
    job = _JOBS.get(job_id)
    if job is None:
        return False
    job.cancelled = True
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
