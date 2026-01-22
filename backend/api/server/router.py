"""Server configuration API endpoints"""

import os
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from core.dependencies import get_current_user
from schemas.server import ServerConfig

router = APIRouter(prefix="/api", tags=["server"])


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

    return ServerConfig(
        is_azure_openai_configured=is_azure_openai_configured,
        is_gemini_configured=is_gemini_configured,
        is_azure_document_intelligence_configured=is_azure_document_intelligence_configured,
        is_llama_configured=is_llama_configured,
    )


@router.get("/models", dependencies=[Depends(get_current_user)])
async def get_available_models():
    """
    Return list of models configured via environment (secrets.toml)
    """
    models = []

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

                    model_data = {
                        "id": f"azure-{deployment}",
                        "name": model_name,
                        "provider": "Azure",
                        "description": description,
                        "deployment": deployment,
                        "api_version": api_version,
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

            models.append(
                {
                    "id": f"azure-{deployment}",
                    "name": model_name,
                    "provider": "Azure",
                    "description": description,
                    "deployment": deployment,
                    "api_version": api_version,
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
            },
            {
                "id": "publishers/google/models/gemini-2.5-flash-lite",
                "name": "Gemini 2.5 Flash Lite",
                "provider": "Google Gemini",
                "description": "Fast",
                "project_id": gemini_project_id,
                "location": gemini_location,
            },
            {
                "id": "publishers/google/models/gemini-2.5-flash",
                "name": "Gemini 2.5 Flash",
                "provider": "Google Gemini",
                "description": "Ultra-fast",
                "project_id": gemini_project_id,
                "location": gemini_location,
            },
            {
                "id": "publishers/google/models/gemini-3-flash-preview",
                "name": "Gemini 3 Flash",
                "provider": "Google Gemini",
                "description": "Ultra-fast + Ultra-Smart",
                "project_id": gemini_project_id,
                "location": gemini_location,
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
            },
            {
                "id": "claude-opus-4-1@20250805",
                "name": "Claude Opus 4.1",
                "provider": "Anthropic",
                "description": "Frontier reasoning",
                "project_id": anthropic_project_id,
                "location": anthropic_location,
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
            },
            {
                "id": "meta/llama-4-scout-17b-16e-instruct-maas",
                "name": "Llama 4 Scout 17B",
                "provider": "Meta Llama",
                "description": "Fast",
                "project_id": llama_project_id,
                "location": "us-east5",  # Llama 4 models available in us-east5
                "region": "us-east5",
            },
            {
                "id": "meta/llama-3.3-70b-instruct-maas",
                "name": "Llama 3.3 70B",
                "provider": "Meta Llama",
                "description": "Powerful",
                "project_id": llama_project_id,
                "location": "us-central1",  # Llama 3.x models available in us-central1
                "region": "us-central1",
            },
            {
                "id": "meta/llama-3.1-405b-instruct-maas",
                "name": "Llama 3.1 405B",
                "provider": "Meta Llama",
                "description": "Powerful",
                "project_id": llama_project_id,
                "location": "us-central1",  # Llama 3.x models available in us-central1
                "region": "us-central1",
            },
            # NOTE: Llama 3.1 70B and 8B models were tested but are not available
            # in either us-central1 or us-east5 regions for this project
            # - meta/llama-3.1-70b-instruct-maas (not available)
            # - meta/llama-3.1-8b-instruct-maas (not available)
        ]
        models.extend(llama_models)
        print(f"✅ Loaded {len(llama_models)} Llama model(s) from configuration (region-specific availability)")

    return JSONResponse(status_code=200, content=models)
