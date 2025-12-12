"""
Evaluation API endpoints for G-Eval metrics

Provides endpoints to evaluate entity extractions using deepeval's G-Eval framework
with support for Azure OpenAI and Vertex AI evaluation models.
"""

import os
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from typing import List

from core.dependencies import get_current_user
from schemas.evaluations import (
    EvaluationRequest,
    BatchEvaluationRequest,
    CustomMetricRequest,
    EvaluationResponse,
    BatchEvaluationResponse,
)
from services.evaluation.evaluation_service import EvaluationService

router = APIRouter(prefix="/api/evaluations", tags=["evaluations"])

# Initialize evaluation service
evaluation_service = EvaluationService()


@router.post("/evaluate", dependencies=[Depends(get_current_user)])
async def evaluate_extraction(request: EvaluationRequest):
    """
    Evaluate a single entity extraction using G-Eval metrics

    This endpoint evaluates an entity extraction against expected output using
    LLM-as-a-judge with custom criteria. Supports multiple metrics:
    - **Correctness**: Factual accuracy compared to expected output
    - **Completeness**: Coverage of all key information
    - **Relevance**: Focus on requested entities
    - **Safety**: Checks for PII, bias, toxicity, and harmful content

    You can use either Azure OpenAI or Vertex AI as the evaluation model.

    **Example Request:**
    ```json
    {
        "entity_name": "Study Design",
        "extraction_prompt": "Extract the study design from this document",
        "actual_output": "This was a randomized controlled trial...",
        "expected_output": "Randomized controlled trial with placebo control...",
        "metrics": ["correctness", "completeness"],
        "provider": "azure_openai",
        "threshold": 0.7
    }
    ```
    """
    try:
        # Prepare model kwargs based on provider
        model_kwargs = {}
        if request.provider == "azure_openai":
            model_kwargs = {
                "deployment": request.azure_deployment
                or os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME"),
                "endpoint": request.azure_endpoint
                or os.getenv("AZURE_OPENAI_ENDPOINT"),
                "api_key": request.azure_api_key or os.getenv("AZURE_OPENAI_API_KEY"),
                "model_name": request.azure_model_name,
            }
        elif request.provider == "vertex_ai":
            model_kwargs = {
                "model_name": request.vertex_model_name,
                "project": request.vertex_project or os.getenv("GEMINI_PROJECT"),
                "location": request.vertex_location
                or os.getenv("GEMINI_LOCATION", "us-central1"),
            }
        elif request.provider == "anthropic":
            model_kwargs = {
                "model_name": request.model_name,
                "project": request.vertex_project or os.getenv("GEMINI_PROJECT"),
                "location": "global",  # Anthropic models must use 'global' location
            }

        result = await evaluation_service.evaluate_extraction(
            entity_name=request.entity_name,
            extraction_prompt=request.extraction_prompt,
            actual_output=request.actual_output,
            expected_output=request.expected_output,
            retrieval_context=request.retrieval_context,
            metrics=request.metrics,
            provider=request.provider,
            threshold=request.threshold,
            strict_mode=request.strict_mode,
            custom_evaluation_steps=request.custom_evaluation_steps,
            **model_kwargs,
        )

        if result.get("status") == "error":
            raise HTTPException(
                status_code=500, detail=f"Evaluation failed: {result.get('error')}"
            )

        return JSONResponse(status_code=200, content=result)

    except HTTPException:
        raise
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail=f"Error during evaluation: {str(e)}"
        )


@router.post("/evaluate/batch", dependencies=[Depends(get_current_user)])
async def evaluate_batch(request: BatchEvaluationRequest):
    """
    Evaluate multiple entity extractions in batch

    This endpoint evaluates multiple entity extractions in a single request,
    useful for evaluating all extractions from a document at once.

    Returns aggregate statistics and individual results for each extraction.

    **Example Request:**
    ```json
    {
        "extractions": [
            {
                "entity_name": "Study Design",
                "extraction_prompt": "Extract study design",
                "actual_output": "RCT",
                "expected_output": "Randomized controlled trial"
            },
            {
                "entity_name": "Sample Size",
                "extraction_prompt": "Extract sample size",
                "actual_output": "100 participants",
                "expected_output": "100"
            }
        ],
        "metrics": ["correctness"],
        "provider": "azure_openai",
        "threshold": 0.7
    }
    ```
    """
    try:
        # Prepare model kwargs
        model_kwargs = {}
        if request.provider == "azure_openai":
            model_kwargs = {
                "deployment": request.azure_deployment,
                "endpoint": request.azure_endpoint,
                "api_key": request.azure_api_key,
                "model_name": request.azure_model_name,
            }
        elif request.provider == "vertex_ai":
            model_kwargs = {
                "model_name": request.vertex_model_name,
                "project": request.vertex_project or os.getenv("GEMINI_PROJECT"),
                "location": request.vertex_location
                or os.getenv("GEMINI_LOCATION", "us-central1"),
            }
        elif request.provider == "anthropic":
            model_kwargs = {
                "model_name": request.model_name,
                "project": request.vertex_project or os.getenv("GEMINI_PROJECT"),
                "location": "global",  # Anthropic models must use 'global' location
            }

        # Convert extractions to dict format
        extractions_list = [extraction.dict() for extraction in request.extractions]

        result = await evaluation_service.evaluate_multiple_extractions(
            extractions=extractions_list,
            provider=request.provider,
            threshold=request.threshold,
            metrics=request.metrics,
            **model_kwargs,
        )

        return JSONResponse(status_code=200, content=result)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error during batch evaluation: {str(e)}"
        )


@router.post("/evaluate/custom", dependencies=[Depends(get_current_user)])
async def evaluate_with_custom_metric(request: CustomMetricRequest):
    """
    Evaluate extraction with a custom G-Eval metric

    This endpoint allows you to define your own evaluation criteria and steps
    for domain-specific or specialized evaluation needs.

    **Example Request:**
    ```json
    {
        "metric_name": "Medical Accuracy",
        "evaluation_steps": [
            "Verify medical terminology is used correctly",
            "Check that dosages and units are accurate",
            "Ensure clinical guidelines are followed",
            "Heavily penalize any medical inaccuracies"
        ],
        "entity_name": "Treatment Protocol",
        "extraction_prompt": "Extract treatment protocol",
        "actual_output": "Administer 500mg twice daily",
        "expected_output": "500mg administered twice per day",
        "provider": "azure_openai"
    }
    ```
    """
    try:
        # Prepare model kwargs
        model_kwargs = {}
        if request.provider == "azure_openai":
            model_kwargs = {
                "deployment": request.azure_deployment,
                "endpoint": request.azure_endpoint,
                "api_key": request.azure_api_key,
                "model_name": request.azure_model_name,
            }
        elif request.provider == "vertex_ai":
            model_kwargs = {
                "model_name": request.vertex_model_name,
                "project": request.vertex_project or os.getenv("GEMINI_PROJECT"),
                "location": request.vertex_location
                or os.getenv("GEMINI_LOCATION", "us-central1"),
            }

        # Create evaluation model
        eval_model = evaluation_service._create_evaluation_model(
            provider=request.provider, **model_kwargs
        )

        # Create custom metric
        custom_metric = evaluation_service.create_custom_metric(
            name=request.metric_name,
            evaluation_steps=request.evaluation_steps,
            model=eval_model,
            threshold=request.threshold,
            strict_mode=request.strict_mode,
        )

        # Run evaluation
        from deepeval.test_case import LLMTestCase

        test_case = LLMTestCase(
            input=request.extraction_prompt,
            actual_output=request.actual_output,
            expected_output=request.expected_output,
            retrieval_context=(
                [request.retrieval_context] if request.retrieval_context else None
            ),
        )

        await custom_metric.a_measure(test_case)

        result = {
            "evaluation_id": f"custom_{request.metric_name}",
            "entity_name": request.entity_name,
            "metric_name": custom_metric.name,
            "score": custom_metric.score,
            "threshold": custom_metric.threshold,
            "success": custom_metric.is_successful(),
            "reason": custom_metric.reason,
            "provider": request.provider,
            "model": eval_model.get_model_name(),
        }

        return JSONResponse(status_code=200, content=result)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error during custom evaluation: {str(e)}"
        )


@router.get("/results/{evaluation_id}", dependencies=[Depends(get_current_user)])
async def get_evaluation_result(evaluation_id: str):
    """
    Get evaluation result by ID

    Retrieves a previously completed evaluation result.
    """
    try:
        result = await evaluation_service.get_evaluation_result(evaluation_id)

        if not result:
            raise HTTPException(status_code=404, detail="Evaluation not found")

        return JSONResponse(status_code=200, content=result)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error retrieving evaluation: {str(e)}"
        )


@router.get("/results", dependencies=[Depends(get_current_user)])
async def list_evaluation_results():
    """
    List all evaluation results

    Returns a list of all evaluation results, sorted by timestamp (newest first).
    """
    try:
        results = await evaluation_service.list_evaluations()
        return JSONResponse(
            status_code=200, content={"total": len(results), "results": results}
        )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error listing evaluations: {str(e)}"
        )


@router.get("/metrics/info", dependencies=[Depends(get_current_user)])
async def get_metrics_info():
    """
    Get information about available G-Eval metrics

    Returns descriptions of built-in metrics and their use cases.
    """
    metrics_info = {
        "built_in_metrics": {
            "correctness": {
                "name": "Entity Extraction Correctness",
                "description": "Evaluates factual accuracy of extracted entities compared to expected output",
                "requires": ["actual_output", "expected_output"],
                "use_case": "Verify that extracted information matches ground truth",
            },
            "completeness": {
                "name": "Entity Extraction Completeness",
                "description": "Evaluates whether all key information is extracted",
                "requires": ["actual_output", "expected_output"],
                "use_case": "Ensure no critical information is missed",
            },
            "relevance": {
                "name": "Entity Extraction Relevance",
                "description": "Evaluates whether extraction stays focused on requested entities",
                "requires": ["input", "actual_output"],
                "use_case": "Verify extraction doesn't include irrelevant information",
            },
            "safety": {
                "name": "Entity Extraction Safety",
                "description": "Evaluates whether output contains PII, bias, toxicity, or harmful content",
                "requires": ["actual_output"],
                "use_case": "Ensure output aligns with ethical guidelines and doesn't leak sensitive information",
            },
        },
        "providers": {
            "azure_openai": {
                "name": "Azure OpenAI",
                "models": ["gpt-5-mini", "gpt-4", "gpt-4-turbo"],
                "required_config": [
                    "azure_deployment",
                    "azure_endpoint",
                    "azure_api_key",
                ],
            },
            "vertex_ai": {
                "name": "Google Vertex AI",
                "models": ["gemini-2.0-flash-exp", "gemini-1.5-pro"],
                "required_config": ["vertex_project", "vertex_model_name"],
            },
            "anthropic": {
                "name": "Anthropic (via Vertex AI)",
                "models": ["claude-sonnet-4-5@20250929"],
                "required_config": [],
                "note": "Uses server-side service account authentication - no user config needed",
            },
        },
        "custom_metrics": {
            "description": "Create domain-specific metrics with custom evaluation steps",
            "endpoint": "/api/evaluations/evaluate/custom",
        },
    }

    return JSONResponse(status_code=200, content=metrics_info)
