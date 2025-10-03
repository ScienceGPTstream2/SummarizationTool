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
    is_configured = all([
        os.getenv("AZURE_OPENAI_ENDPOINT"),
        os.getenv("AZURE_OPENAI_KEY"),
        os.getenv("AZURE_OPENAI_DEPLOYMENT")
    ])

    return ServerConfig(is_azure_openai_configured=is_configured)

@router.get("/models", dependencies=[Depends(get_current_user)])
async def get_available_models():
    """
    Return list of Azure models configured via environment (secrets.toml)
    """
    models = []
    deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT")
    model_name = os.getenv("AZURE_OPENAI_MODEL_NAME")
    api_version = os.getenv("AZURE_OPENAI_API_VERSION")
    if deployment and model_name:
        models.append({
            "id": f"azure-{deployment}",
            "name": model_name,
            "provider": "Azure",
            "description": f"Azure deployment of {model_name}",
            "deployment": deployment,
            "api_version": api_version
        })
    return JSONResponse(status_code=200, content=models)