"""
Eval Job Queue API Router
=========================
Provides endpoints to submit, poll, and cancel background evaluation jobs.

Frontend flow:
  1. POST /api/evaluations/jobs          → returns {job_id} immediately
  2. GET  /api/evaluations/jobs/{id}     → poll for progress + results
  3. POST /api/evaluations/jobs/{id}/cancel  → stop the job
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional

from core.auth import get_current_user
from services.evaluation.job_queue import (
    create_job,
    get_job,
    cancel_job,
    EvalTask,
    ProviderConfig,
)

router = APIRouter(prefix="/api/evaluations/jobs", tags=["eval_jobs"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class EvalTaskRequest(BaseModel):
    entity_name: str
    source_model: str
    actual_output: str
    extraction_prompt: str
    expected_output: Optional[str] = None
    file_hash: Optional[str] = None
    file_id: Optional[str] = None  # frontend fileId for UI state updates


class ProviderConfigRequest(BaseModel):
    provider_id: str = Field(..., description="e.g. 'azure-gpt4o'")
    provider: str = Field(..., description="'azure_openai' | 'vertex_ai' | 'anthropic'")
    model_name: Optional[str] = None
    deployment: Optional[str] = None
    endpoint: Optional[str] = None
    api_key: Optional[str] = None


class SubmitJobRequest(BaseModel):
    session_id: str
    tasks: List[EvalTaskRequest]
    providers: List[ProviderConfigRequest]
    metrics: List[str] = Field(
        default=["correctness", "completeness", "relevance", "safety"]
    )
    custom_evaluation_steps: Optional[Dict[str, List[str]]] = None
    threshold: float = Field(default=0.7, ge=0.0, le=1.0)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("", dependencies=[Depends(get_current_user)])
async def submit_job(
    request: SubmitJobRequest,
    user: Dict = Depends(get_current_user),
):
    """
    Submit a batch evaluation job.

    Returns immediately with a job_id. The job runs in the background.
    Poll GET /api/evaluations/jobs/{job_id} for progress.
    """
    if not request.tasks:
        raise HTTPException(status_code=400, detail="No tasks provided")
    if not request.providers:
        raise HTTPException(status_code=400, detail="No providers provided")

    tasks = [
        EvalTask(
            entity_name=t.entity_name,
            source_model=t.source_model,
            actual_output=t.actual_output,
            extraction_prompt=t.extraction_prompt,
            expected_output=t.expected_output,
            file_hash=t.file_hash,
            file_id=t.file_id,
        )
        for t in request.tasks
    ]

    providers = [
        ProviderConfig(
            provider_id=p.provider_id,
            provider=p.provider,
            model_name=p.model_name,
            deployment=p.deployment,
            endpoint=p.endpoint,
            api_key=p.api_key,
        )
        for p in request.providers
    ]

    job = create_job(
        session_id=request.session_id,
        user_id=user["id"],
        tasks=tasks,
        providers=providers,
        metrics=request.metrics,
        custom_evaluation_steps=request.custom_evaluation_steps,
        threshold=request.threshold,
    )

    total = len(tasks) * len(providers)
    print(
        f"[JobQueue] Submitted job {job.job_id}: "
        f"{len(tasks)} tasks × {len(providers)} providers = {total} evals "
        f"(session={request.session_id})"
    )

    return {
        "job_id": job.job_id,
        "total": total,
        "status": job.status,
    }


@router.get("/{job_id}", dependencies=[Depends(get_current_user)])
async def get_job_status(job_id: str):
    """
    Poll for job status and results.

    Returns all results collected so far. The frontend should
    poll every 3–5 seconds while status is 'pending' or 'running'.
    """
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return job.to_status_dict()


@router.post("/{job_id}/cancel", dependencies=[Depends(get_current_user)])
async def cancel_job_endpoint(job_id: str):
    """
    Request cancellation of a running job.

    Sets the cancelled flag. The worker checks this between LLM calls —
    at most one in-flight call will still finish after this returns.
    """
    found = cancel_job(job_id)
    if not found:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return {"ok": True, "job_id": job_id}
