"""Server configuration API endpoints"""

import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from core.auth import get_current_user
from schemas.server import ServerConfig
from services.llm.macbook import MacbookLLMClient

logger = logging.getLogger(__name__)


class BatchMetricsRequest(BaseModel):
    session_id: str
    batch_number: int
    batch_latency: float
    document_count: int


# Repo root is two levels above this file (backend/api/server/router.py → repo/)
_REPO_ROOT = Path(__file__).resolve().parents[3]
_CLEAR_SCRIPT = _REPO_ROOT / "backend" / "scripts" / "clear_for_benchmarking.py"

router = APIRouter(prefix="/api", tags=["server"])


@router.get("/server/health", include_in_schema=False)
async def health_check():
    """Public liveness probe — no auth required. Used by container probes."""
    try:
        from models import get_db_session

        db = get_db_session()
        db.execute(__import__("sqlalchemy").text("SELECT 1"))
        db.close()
        return {"status": "ok", "db": "ok"}
    except Exception as exc:
        logger.error("Health check DB ping failed: %s", exc)
        return JSONResponse(
            status_code=503, content={"status": "degraded", "db": "error"}
        )


@router.post("/telemetry/traces", include_in_schema=False)
async def proxy_otlp_traces(request: Request):
    """Proxy OTLP/HTTP traces from the browser to Tempo (avoids CORS from browser)."""
    tempo_endpoint = os.getenv("OTLP_ENDPOINT")
    if not tempo_endpoint:
        return JSONResponse(status_code=204, content={})
    try:
        import httpx

        body = await request.body()
        headers = {
            "Content-Type": request.headers.get(
                "Content-Type", "application/x-protobuf"
            )
        }
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{tempo_endpoint.rstrip('/')}/v1/traces",
                content=body,
                headers=headers,
            )
    except Exception as exc:
        logger.debug("OTLP trace proxy error (non-fatal): %s", exc)
    return JSONResponse(status_code=200, content={})


@router.post("/server/client-error", include_in_schema=False)
async def record_client_error(request: Request):
    """Receive unhandled frontend errors from the React ErrorBoundary."""
    try:
        body = await request.json()
        logger.error(
            "Frontend error: %s | url=%s | stack=%s",
            body.get("error"),
            body.get("url"),
            (body.get("stack") or "")[:500],
        )
    except Exception:
        pass
    return JSONResponse(status_code=200, content={"ok": True})


@router.get("/server-config", response_model=ServerConfig)
async def get_server_config():
    """
    Return server-side configuration status for features like Azure OpenAI.
    """
    # Check if Azure OpenAI is configured
    # Either global endpoint/key exists, or models with their own endpoints/keys exist
    has_global_config = all(
        [
            os.getenv("AZURE_OPENAI_ENDPOINT"),
            os.getenv("AZURE_OPENAI_API_KEY"),
        ]
    )
    # Check if models are configured (they may have their own endpoints/keys)
    import json

    azure_models_json = os.getenv("AZURE_OPENAI_MODELS")
    has_models = False
    if azure_models_json:
        try:
            models_list = json.loads(azure_models_json)
            # Check if at least one model has endpoint and api_key
            for model_cfg in models_list:
                if model_cfg.get("endpoint") and model_cfg.get("api_key"):
                    has_models = True
                    break
        except (json.JSONDecodeError, TypeError):
            pass

    is_azure_openai_configured = has_global_config or has_models

    # Check for Gemini configuration: project, location, and service account file
    gemini_project_id = os.getenv("GEMINI_PROJECT_ID") or os.getenv("GEMINI_PROJECT")
    gemini_location = os.getenv("GEMINI_LOCATION", "us-central1")

    # Check if service account file exists
    from pathlib import Path

    service_account_path = None
    # Check GOOGLE_APPLICATION_CREDENTIALS env var first
    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if creds_path and Path(creds_path).exists():
        service_account_path = Path(creds_path)
    else:
        # Try to find in backend/core/ directory
        try:
            core_dir = Path(__file__).resolve().parents[2] / "core"
            if core_dir.exists():
                json_files = list(core_dir.glob("*.json"))
                if json_files:
                    service_account_path = json_files[0]
        except Exception:
            pass

    is_gemini_configured = all(
        [
            gemini_project_id,
            gemini_location,
            service_account_path is not None,
        ]
    )

    is_azure_document_intelligence_configured = all(
        [
            os.getenv("AZURE_DOC_INTELLIGENCE_ENDPOINT"),
            os.getenv("AZURE_DOC_INTELLIGENCE_KEY"),
        ]
    )

    # Check for Llama configuration: project, location, region, and service account file
    llama_project_id = os.getenv("LLAMA_PROJECT_ID") or os.getenv("GEMINI_PROJECT_ID")
    llama_location = os.getenv("LLAMA_LOCATION", "us-east5")
    llama_region = os.getenv("LLAMA_REGION", "us-east5")

    # Reuse the same service account path check (same service account for all GCP models)
    # service_account_path is already checked above for Gemini

    is_llama_configured = all(
        [
            llama_project_id,
            llama_location,
            llama_region,
            service_account_path is not None,
        ]
    )

    macbook_base_url = os.getenv("MACBOOK_LLM_BASE_URL")
    macbook_client = MacbookLLMClient() if macbook_base_url else None
    is_macbook_configured = bool(macbook_base_url)
    is_macbook_healthy = False
    # For server-config, avoid short health gate; defer to model fetch in /models
    if macbook_client:
        try:
            is_macbook_healthy = True  # optimistic; real fetch happens in /models
        except Exception:
            is_macbook_healthy = False
    return ServerConfig(
        is_azure_openai_configured=is_azure_openai_configured,
        is_gemini_configured=is_gemini_configured,
        is_azure_document_intelligence_configured=is_azure_document_intelligence_configured,
        is_llama_configured=is_llama_configured,
        is_macbook_configured=is_macbook_configured,
        is_macbook_healthy=is_macbook_healthy,
    )


@router.get("/models", dependencies=[Depends(get_current_user)])
async def get_available_models():
    """
    Return list of models configured via environment (secrets.toml)
    """
    models = []

    # Azure models that do NOT support custom temperature values.
    # These models only accept the default temperature (1.0) or reject the param entirely.
    # Based on live API testing (2026-02).
    AZURE_NO_TEMP_MODELS = {
        "gpt-5",
        "gpt-5-mini",
        "gpt-5-nano",
        "o3-mini",
        "o4-mini",
        "o3",
    }

    # Add Azure OpenAI models if configured
    # Support multiple models from secrets.toml
    import json

    azure_models_json = os.getenv("AZURE_OPENAI_MODELS")
    if azure_models_json:
        try:
            azure_models_list = json.loads(azure_models_json)
            for model_cfg in azure_models_list:
                deployment = model_cfg.get("deployment")
                model_name = model_cfg.get("model_name")
                api_version = model_cfg.get("api_version")
                endpoint = model_cfg.get(
                    "endpoint"
                )  # Optional: model-specific endpoint
                api_key = model_cfg.get("api_key")  # Optional: model-specific key
                if deployment and model_name:
                    # model_family = "meta" → emit under Meta Llama group (Azure-hosted Llama)
                    model_family = model_cfg.get("model_family", "")
                    if model_family == "meta":
                        models.append(
                            {
                                "id": f"azure-{deployment}",
                                "name": f"{model_name} (Azure)",
                                "provider": "Meta Llama",
                                "model_type": "azure-llama",
                                "description": "Fast (Azure)",
                                "deployment": deployment,
                                "api_version": api_version,
                                "supports_temperature": True,
                                "default_temperature": 0.5,
                            }
                        )
                        continue

                    # Map model names to their characteristics
                    model_descriptions = {
                        "gpt-4o": "Ultra-fast",
                        "gpt-5-mini": "Fast",
                        "gpt-5-nano": "Fast",
                        "o3-mini": "Reasoning",
                        "o4-mini": "Fast",
                        "o3": "Reasoning",
                    }
                    description = model_descriptions.get(
                        model_name, f"Azure deployment of {model_name}"
                    )

                    supports_temp = model_name not in AZURE_NO_TEMP_MODELS
                    vision_capable = bool(model_cfg.get("vision_capable", False))
                    model_data = {
                        "id": f"azure-{deployment}",
                        "name": model_name,
                        "provider": "Azure",
                        "description": description,
                        "deployment": deployment,
                        "api_version": api_version,
                        "supports_temperature": supports_temp,
                        "default_temperature": 0.5 if supports_temp else 1.0,
                        "vision_capable": vision_capable,
                    }
                    # Only include endpoint and api_key if they're model-specific (not in response, but for reference)
                    models.append(model_data)
        except (json.JSONDecodeError, TypeError) as e:
            print(f"⚠️  Warning: Failed to parse AZURE_OPENAI_MODELS: {e}")

    # Backward compatibility: support old single model format
    if not azure_models_json:
        deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT")
        model_name = os.getenv("AZURE_OPENAI_MODEL_NAME")
        api_version = os.getenv("AZURE_OPENAI_API_VERSION")
        if deployment and model_name:
            # Map model names to their characteristics
            model_descriptions = {
                "gpt-4o": "Ultra-fast",
                "gpt-5-mini": "Fast",
                "gpt-5-nano": "Fast",
                "o3-mini": "Reasoning",
                "o4-mini": "Fast",
                "o3": "Reasoning",
            }
            description = model_descriptions.get(
                model_name, f"Azure deployment of {model_name}"
            )

            supports_temp = model_name not in AZURE_NO_TEMP_MODELS
            models.append(
                {
                    "id": f"azure-{deployment}",
                    "name": model_name,
                    "provider": "Azure",
                    "description": description,
                    "deployment": deployment,
                    "api_version": api_version,
                    "supports_temperature": supports_temp,
                    "default_temperature": 0.5 if supports_temp else 1.0,
                }
            )

    # Add Gemini models if configured (using service account authentication)
    gemini_project_id = os.getenv("GEMINI_PROJECT_ID") or os.getenv("GEMINI_PROJECT")
    gemini_location = os.getenv("GEMINI_LOCATION", "us-central1")

    # Check if service account file exists
    from pathlib import Path

    service_account_path = None
    # Check GOOGLE_APPLICATION_CREDENTIALS env var first
    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if creds_path and Path(creds_path).exists():
        service_account_path = Path(creds_path)
    else:
        # Try to find in backend/core/ directory
        try:
            core_dir = Path(__file__).resolve().parents[2] / "core"
            if core_dir.exists():
                json_files = list(core_dir.glob("*.json"))
                if json_files:
                    service_account_path = json_files[0]
        except Exception:
            pass

    if gemini_project_id and gemini_location and service_account_path:
        # Add only Gemini 2.5 models (using correct Vertex AI model IDs)
        gemini_models = [
            {
                "id": "publishers/google/models/gemini-2.5-pro",
                "name": "Gemini 2.5 Pro",
                "provider": "Google Gemini",
                "description": "Reasoning",
                "project_id": gemini_project_id,
                "location": gemini_location,
                "supports_temperature": True,
                "default_temperature": 0.5,
                "vision_capable": True,
            },
            {
                "id": "publishers/google/models/gemini-2.5-flash-lite",
                "name": "Gemini 2.5 Flash Lite",
                "provider": "Google Gemini",
                "description": "Fast",
                "project_id": gemini_project_id,
                "location": gemini_location,
                "supports_temperature": True,
                "default_temperature": 0.5,
                "vision_capable": True,
            },
            {
                "id": "publishers/google/models/gemini-2.5-flash",
                "name": "Gemini 2.5 Flash",
                "provider": "Google Gemini",
                "description": "Ultra-fast",
                "project_id": gemini_project_id,
                "location": gemini_location,
                "supports_temperature": True,
                "default_temperature": 0.5,
                "vision_capable": True,
            },
            {
                "id": "publishers/google/models/gemini-3-pro-preview",
                "name": "Gemini 3 Pro Preview",
                "provider": "Google Gemini",
                "description": "Next-gen reasoning",
                "project_id": gemini_project_id,
                "location": gemini_location,
                "supports_temperature": True,
                "default_temperature": 0.5,
                "vision_capable": True,
            },
        ]
        models.extend(gemini_models)

    # Add Anthropic models if configured (using service account authentication via Vertex AI)
    # Check for Anthropic configuration: project, location, and service account file
    anthropic_project_id = (
        os.getenv("ANTHROPIC_PROJECT_ID")
        or os.getenv("GEMINI_PROJECT_ID")
        or os.getenv("GEMINI_PROJECT")
    )
    anthropic_location = os.getenv("ANTHROPIC_LOCATION", "global")

    # Reuse the same service account path check (same service account for both Gemini and Anthropic)
    # service_account_path is already checked above for Gemini

    if anthropic_project_id and anthropic_location and service_account_path:
        # Add only the two models that support structured outputs
        # According to Anthropic docs: "Structured outputs are currently available as a public beta
        # feature in the Claude API for Claude Sonnet 4.5 and Claude Opus 4.1."
        anthropic_models = [
            {
                "id": "claude-sonnet-4-5@20250929",
                "name": "Claude Sonnet 4.5",
                "provider": "Anthropic",
                "description": "Reasoning",
                "project_id": anthropic_project_id,
                "location": anthropic_location,
                "supports_temperature": True,
                "default_temperature": 0.5,
            },
            {
                "id": "claude-opus-4-1@20250805",
                "name": "Claude Opus 4.1",
                "provider": "Anthropic",
                "description": "Frontier reasoning",
                "project_id": anthropic_project_id,
                "location": anthropic_location,
                "supports_temperature": True,
                "default_temperature": 0.5,
            },
        ]
        models.extend(anthropic_models)

    # Add Llama models if configured (using service account authentication via Vertex AI)
    # Check for Llama configuration: project, location, region, and service account file
    llama_project_id = os.getenv("LLAMA_PROJECT_ID") or os.getenv("GEMINI_PROJECT_ID")
    llama_location = os.getenv("LLAMA_LOCATION", "us-east5")
    llama_region = os.getenv("LLAMA_REGION", "us-east5")

    # Reuse the same service account path check (same service account for all GCP models)
    # service_account_path is already checked above for Gemini

    if llama_project_id and llama_location and llama_region and service_account_path:
        # Add all available Llama models with correct region assignments
        # Llama 4 models work in us-east5, Llama 3.x models work in us-central1
        llama_models = [
            {
                "id": "meta/llama-4-maverick-17b-128e-instruct-maas",
                "name": "Llama 4 Maverick 17B",
                "provider": "Meta Llama",
                "description": "Reasoning",
                "project_id": llama_project_id,
                "location": "us-east5",  # Llama 4 models available in us-east5
                "region": "us-east5",
                "supports_temperature": True,
                "default_temperature": 0.5,
            },
            {
                "id": "meta/llama-4-scout-17b-16e-instruct-maas",
                "name": "Llama 4 Scout 17B",
                "provider": "Meta Llama",
                "description": "Fast",
                "project_id": llama_project_id,
                "location": "us-east5",  # Llama 4 models available in us-east5
                "region": "us-east5",
                "supports_temperature": True,
                "default_temperature": 0.5,
            },
            {
                "id": "meta/llama-3.3-70b-instruct-maas",
                "name": "Llama 3.3 70B",
                "provider": "Meta Llama",
                "description": "Powerful",
                "project_id": llama_project_id,
                "location": "us-central1",  # Llama 3.x models available in us-central1
                "region": "us-central1",
                "supports_temperature": True,
                "default_temperature": 0.5,
            },
            {
                "id": "meta/llama-3.1-405b-instruct-maas",
                "name": "Llama 3.1 405B",
                "provider": "Meta Llama",
                "description": "Powerful",
                "project_id": llama_project_id,
                "location": "us-central1",  # Llama 3.x models available in us-central1
                "region": "us-central1",
                "supports_temperature": True,
                "default_temperature": 0.5,
            },
            # NOTE: Llama 3.1 70B and 8B models were tested but are not available
            # in either us-central1 or us-east5 regions for this project
            # - meta/llama-3.1-70b-instruct-maas (not available)
            # - meta/llama-3.1-8b-instruct-maas (not available)
        ]
        models.extend(llama_models)
        print(
            f"✅ Loaded {len(llama_models)} Llama model(s) from configuration (region-specific availability)"
        )

    macbook_base_url = os.getenv("MACBOOK_LLM_BASE_URL")
    if macbook_base_url:
        # Keep a simple static cache in the router scope to avoid hammering tags
        # across rapid successive calls.
        global _MACBOOK_MODELS_CACHE  # type: ignore
        global _MACBOOK_MODELS_CACHE_TS  # type: ignore

        if "_MACBOOK_MODELS_CACHE" not in globals():
            _MACBOOK_MODELS_CACHE = []
            _MACBOOK_MODELS_CACHE_TS = 0.0

        cache_ttl = 120  # seconds
        now_ts = __import__("time").time()

        use_cache = (
            _MACBOOK_MODELS_CACHE and now_ts - _MACBOOK_MODELS_CACHE_TS < cache_ttl
        )

        if use_cache:
            macbook_models = _MACBOOK_MODELS_CACHE
        else:
            macbook_client = MacbookLLMClient()
            macbook_models = await macbook_client.fetch_available_models()
            if macbook_models:
                _MACBOOK_MODELS_CACHE = macbook_models
                _MACBOOK_MODELS_CACHE_TS = now_ts

        if macbook_models:
            for model in macbook_models:
                models.append(
                    {
                        "id": model["id"],
                        "name": model["name"],
                        "provider": "Macbook LLM",
                        "description": "Self-hosted model",
                        "supports_temperature": True,
                        "default_temperature": 0.5,
                    }
                )
        else:
            # If no models returned and we have a cached version, keep them to avoid UI drop
            if _MACBOOK_MODELS_CACHE:
                print("[MacbookLLM] Using cached macbook models after fetch failure")
                for model in _MACBOOK_MODELS_CACHE:
                    models.append(
                        {
                            "id": model["id"],
                            "name": model["name"],
                            "provider": "Macbook LLM",
                            "description": "Self-hosted model",
                            "supports_temperature": True,
                            "default_temperature": 0.5,
                        }
                    )
            else:
                print("[MacbookLLM] No models returned; skipping Macbook models")

    # Add VLLM models if configured
    vllm_base_url = os.getenv("VLLM_BASE_URL")
    if vllm_base_url:
        try:
            from services.llm.vllm import VLLMClient

            vllm_client = VLLMClient()
            vllm_models = await vllm_client.fetch_available_models()
            if vllm_models:
                for model in vllm_models:
                    models.append(
                        {
                            "id": model["id"],
                            "name": model.get("name", model["id"]),
                            "provider": "VLLM",
                            "description": "Self-hosted model (VLLM)",
                            "supports_temperature": True,
                            "default_temperature": 0.5,
                        }
                    )
                print(f"✅ Loaded {len(vllm_models)} VLLM model(s)")
            else:
                print("[VLLM] No models returned from VLLM server")
        except Exception as e:
            print(f"[VLLM] Failed to fetch models: {e}")

    return JSONResponse(status_code=200, content=models)


@router.get("/server/session-metrics", dependencies=[Depends(get_current_user)])
async def get_session_metrics(http_request: Request):
    session_id = http_request.headers.get("X-Session-Id")
    if not session_id:
        return JSONResponse(
            status_code=200, content={"message": "No session id", "metrics": None}
        )

    from services.telemetry.cost_tracker import cost_tracker

    metrics = cost_tracker.get_session_metrics(session_id)
    if not metrics:
        return JSONResponse(
            status_code=200, content={"session_id": session_id, "metrics": None}
        )

    return JSONResponse(
        status_code=200,
        content={
            "session_id": session_id,
            "metrics": {
                "total_cost": round(metrics.total_cost, 6),
                "total_latency": round(metrics.total_latency, 3),
                "total_calls": metrics.total_calls,
                "calls": [
                    {
                        "provider": call.provider,
                        "model": call.model,
                        "prompt_tokens": call.prompt_tokens,
                        "completion_tokens": call.completion_tokens,
                        "duration": call.duration,
                        "cost": round(call.cost, 6),
                        "timestamp": call.timestamp,
                        "document_name": call.document_name,
                        "page_count": call.page_count,
                        "figure_count": call.figure_count,
                        "table_count": call.table_count,
                        "batch_number": call.batch_number,
                    }
                    for call in metrics.calls
                ],
                "batches": {
                    str(b.batch_number): {
                        "batch_number": b.batch_number,
                        "batch_latency": round(b.batch_latency, 3),
                        "document_count": b.document_count,
                    }
                    for b in metrics.batches.values()
                },
            },
        },
    )


@router.post("/server/session-metrics/load", dependencies=[Depends(get_current_user)])
async def load_session_metrics_from_db(http_request: Request):
    """Load session metrics from database (used when restoring a session)"""
    body = await http_request.json()
    session_id = body.get("session_id")
    if not session_id:
        return JSONResponse(
            status_code=200, content={"message": "No session id", "metrics": None}
        )

    from services.telemetry.cost_tracker import cost_tracker

    # Load from database and cache in memory
    metrics = cost_tracker.load_session_metrics_from_db(session_id)
    if not metrics:
        return JSONResponse(
            status_code=200, content={"session_id": session_id, "metrics": None}
        )

    return JSONResponse(
        status_code=200,
        content={
            "session_id": session_id,
            "metrics": {
                "total_cost": round(metrics.total_cost, 6),
                "total_latency": round(metrics.total_latency, 3),
                "total_calls": metrics.total_calls,
                "calls": [],  # Individual calls not stored in DB anymore
            },
        },
    )


@router.delete("/server/session-metrics", dependencies=[Depends(get_current_user)])
async def clear_session_metrics(http_request: Request):
    session_id = http_request.headers.get("X-Session-Id")
    if not session_id:
        return JSONResponse(status_code=200, content={"message": "No session id"})

    from services.telemetry.cost_tracker import cost_tracker

    cost_tracker.clear_session(session_id)
    return JSONResponse(
        status_code=200, content={"session_id": session_id, "cleared": True}
    )


@router.post("/server/batch-metrics", dependencies=[Depends(get_current_user)])
async def record_batch_metrics(body: BatchMetricsRequest):
    """Record wall-clock batch latency for a group of documents processed together."""
    from services.telemetry.cost_tracker import cost_tracker

    cost_tracker.record_batch(
        session_id=body.session_id,
        batch_number=body.batch_number,
        batch_latency=body.batch_latency,
        document_count=body.document_count,
    )
    return JSONResponse(status_code=200, content={"ok": True})


@router.get("/server/document-metrics", dependencies=[Depends(get_current_user)])
async def get_document_metrics(http_request: Request):
    """
    Return per-document parse metrics from the documents table for the current session.
    Reads from DB so the data is available even after session restoration.

    Returns:
        { documents: [ { document_name, provider, model, duration, cost,
                          page_count, figure_count, table_count } ] }
    """
    session_id = http_request.headers.get("X-Session-Id")
    if not session_id:
        return JSONResponse(status_code=200, content={"documents": []})

    try:
        from services.database import get_db_service

        db = get_db_service()
        docs = db.get_documents_by_session(session_id)

        _DOC_PROCESSORS = {"docling", "azure_doc_intelligence"}
        return JSONResponse(
            status_code=200,
            content={
                "documents": [
                    {
                        "document_name": doc.get("filename"),
                        "provider": "azure",
                        "model": doc.get("processor_used") or "docling",
                        "duration": doc.get("parse_duration_seconds"),
                        "cost": doc.get("parse_cost"),
                        "page_count": doc.get("page_count") or 0,
                        "figure_count": doc.get("figure_count") or 0,
                        "table_count": doc.get("table_count") or 0,
                    }
                    for doc in docs
                    if (doc.get("processor_used") or "docling") in _DOC_PROCESSORS
                ]
            },
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"documents": [], "error": str(e)},
        )


@router.post("/server/benchmark/clear", dependencies=[Depends(get_current_user)])
async def clear_benchmark_cache(http_request: Request):
    """
    Run backend/scripts/clear_for_benchmarking.py to wipe cached processed outputs
    and DB rows so the next upload forces fresh Docling/Azure conversions.

    Body:
        mode      "dry_run" | "execute"
        processor null | "docling" | "azure_doc_intelligence"

    Returns:
        { ok, output, errors, exit_code }
    """
    body = await http_request.json()
    mode = body.get("mode")
    processor = body.get("processor")

    if mode not in ("dry_run", "execute"):
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "output": "",
                "errors": "mode must be 'dry_run' or 'execute'",
                "exit_code": 1,
            },
        )
    if processor not in (None, "docling", "azure_doc_intelligence"):
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "output": "",
                "errors": "processor must be null, 'docling', or 'azure_doc_intelligence'",
                "exit_code": 1,
            },
        )

    args = [sys.executable, str(_CLEAR_SCRIPT)]
    args.append("--fs-only")  # Never touch the DB — only clear processed/ dirs
    if mode == "dry_run":
        args.append("--dry-run")
    else:
        args.append("--yes")
    if processor:
        args.extend(["--processor", processor])

    try:
        proc = subprocess.run(
            args,
            capture_output=True,
            text=True,
            cwd=str(_REPO_ROOT),
            timeout=120,
        )
        return JSONResponse(
            content={
                "ok": proc.returncode == 0,
                "output": proc.stdout,
                "errors": proc.stderr,
                "exit_code": proc.returncode,
            }
        )
    except subprocess.TimeoutExpired:
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "output": "",
                "errors": "Script timed out after 120s",
                "exit_code": 1,
            },
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "output": "", "errors": str(e), "exit_code": 1},
        )


_LOG_FILE = Path(__file__).resolve().parents[2] / "output" / "logs" / "app.log"


@router.get("/server/logs", dependencies=[Depends(get_current_user)])
async def get_server_logs(lines: int = 200, level: str = "ALL", format: str = "json"):
    """
    Return recent lines from the server log file (backend/output/logs/app.log).

    Query params:
      lines  – how many tail lines to return (default 200)
      level  – filter to a log level: ERROR, WARNING, INFO, or ALL (default)
      format – "json" (default) or "text" (returns plain .txt, good for curl -o)
    """
    from fastapi.responses import PlainTextResponse

    if not _LOG_FILE.exists():
        msg = "No log file yet — errors will appear here after the first request."
        if format.lower() == "text":
            return PlainTextResponse(msg)
        return {
            "lines": [],
            "total_lines": 0,
            "message": msg,
            "log_path": str(_LOG_FILE),
        }

    with open(_LOG_FILE, encoding="utf-8") as f:
        all_lines = f.readlines()

    filtered = all_lines
    if level.upper() != "ALL":
        tag = f"[{level.upper()}]"
        filtered = [ln for ln in all_lines if tag in ln]

    tail = filtered[-lines:]

    if format.lower() == "text":
        header = f"# ScienceGPT Logs — level={level.upper()} lines={lines} of {len(filtered)} ({len(all_lines)} total)\n# {_LOG_FILE}\n\n"
        return PlainTextResponse(header + "".join(tail))

    return {
        "lines": tail,
        "total_lines": len(all_lines),
        "filtered_lines": len(filtered),
        "log_path": str(_LOG_FILE),
    }
