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

    return ServerConfig(
        is_azure_openai_configured=is_azure_openai_configured,
        is_gemini_configured=is_gemini_configured,
        is_azure_document_intelligence_configured=is_azure_document_intelligence_configured,
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
                    model_data = {
                        "id": f"azure-{deployment}",
                        "name": model_name,
                        "provider": "Azure",
                        "description": f"Azure deployment of {model_name}",
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
            models.append(
                {
                    "id": f"azure-{deployment}",
                    "name": model_name,
                    "provider": "Azure",
                    "description": f"Azure deployment of {model_name}",
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
                "description": "Google Gemini 2.5 Pro model for entity extraction",
                "project_id": gemini_project_id,
                "location": gemini_location,
            },
            {
                "id": "publishers/google/models/gemini-2.5-flash-lite",
                "name": "Gemini 2.5 Flash Lite",
                "provider": "Google Gemini",
                "description": "Google Gemini 2.5 Flash Lite model for entity extraction",
                "project_id": gemini_project_id,
                "location": gemini_location,
            },
            {
                "id": "publishers/google/models/gemini-2.5-flash",
                "name": "Gemini 2.5 Flash",
                "provider": "Google Gemini",
                "description": "Google Gemini 2.5 Flash model for entity extraction",
                "project_id": gemini_project_id,
                "location": gemini_location,
            },
        ]
        models.extend(gemini_models)

    return JSONResponse(status_code=200, content=models)
