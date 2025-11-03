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
    # Check if the essential Azure OpenAI env vars are set and not empty
    is_azure_openai_configured = all(
        [
            os.getenv("AZURE_OPENAI_ENDPOINT"),
            os.getenv("AZURE_OPENAI_API_KEY"),
            os.getenv("AZURE_OPENAI_DEPLOYMENT"),
        ]
    )

    is_gemini_configured = all(
        [
            os.getenv("GEMINI_PROJECT_ID"),
            os.getenv("GEMINI_LOCATION"),
            os.getenv("GEMINI_API_KEY"),
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
    
    # Add Gemini models if configured
    gemini_project_id = os.getenv("GEMINI_PROJECT_ID")
    gemini_location = os.getenv("GEMINI_LOCATION")
    gemini_api_key = os.getenv("GEMINI_API_KEY")
    if gemini_project_id and gemini_location and gemini_api_key:
        # Add the Gemini models that are available (using correct Vertex AI model IDs)
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
            {
                "id": "publishers/google/models/gemini-2.0-flash-lite-001",
                "name": "Gemini 2.0 Flash Lite",
                "provider": "Google Gemini",
                "description": "Google Gemini 2.0 Flash Lite model for entity extraction",
                "project_id": gemini_project_id,
                "location": gemini_location,
            },
            {
                "id": "publishers/google/models/gemini-2.0-flash-001",
                "name": "Gemini 2.0 Flash",
                "provider": "Google Gemini",
                "description": "Google Gemini 2.0 Flash model for entity extraction",
                "project_id": gemini_project_id,
                "location": gemini_location,
            },
        ]
        models.extend(gemini_models)
    
    return JSONResponse(status_code=200, content=models)
