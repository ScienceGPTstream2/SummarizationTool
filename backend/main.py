"""
FastAPI Application Entry Point

This is the main application launcher that:
1. Loads configuration
2. Creates the FastAPI app
3. Sets up middleware
4. Includes all API routers
5. Starts the server
"""

# Logging must be configured before any other imports so all loggers inherit it
from core.logging_config import setup_logging
setup_logging()

import logging
import traceback
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import os
import toml

logger = logging.getLogger("app")

# Load configuration before importing services
from core.config import load_config


# Moved load_secrets_to_env here to ensure all secrets are loaded early
def load_secrets_to_env(secrets_path: str = None):
    """Loads secrets from a TOML file into environment variables."""
    if secrets_path is None:
        # Try relative path first (when running from backend directory)
        candidates = [
            "core/secrets.toml",
            os.path.join(os.path.dirname(__file__), "core", "secrets.toml"),
            os.path.join(
                os.path.dirname(__file__),
                "..",
                "core",
                "secrets.toml",
            ),
        ]
        secrets_path = None
        for candidate in candidates:
            if os.path.exists(candidate):
                secrets_path = candidate
                break

    try:
        if not secrets_path:
            raise FileNotFoundError("No secrets.toml found in expected locations")

        secrets = toml.load(secrets_path)
        if "Macbook" in secrets and isinstance(secrets.get("Macbook"), dict):
            macbook_url = secrets["Macbook"].get("macbook_llm_base_url")
            if macbook_url:
                os.environ["MACBOOK_LLM_BASE_URL"] = str(macbook_url)
        for section, keys in secrets.items():
            if isinstance(keys, dict):
                for key, value in keys.items():
                    env_key = f"{section.upper()}_{key.upper()}"
                    os.environ[env_key] = str(value)
            else:
                env_key = section.upper()
                os.environ[env_key] = str(keys)
        print(f"Successfully loaded secrets from {secrets_path}")
        print(
            f"MACBOOK_LLM_BASE_URL={os.environ.get('MACBOOK_LLM_BASE_URL', '') or '(not set)'}"
        )
    except FileNotFoundError:
        print(f"Secrets file not found at {secrets_path}. Skipping loading.")
    except Exception as e:
        print(f"Error loading secrets from {secrets_path}: {e}")


load_secrets_to_env()
load_config()

from core.middleware import setup_cors
from api import (
    auth,
    files,
    documents,
    extractions,
    server,
    paragraphgenerator,
    paragraph_evaluation,
    evaluations,
    sessions,
    groups,
    templates,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


def create_app() -> FastAPI:
    """Create and configure the FastAPI application"""

    app = FastAPI(
        title="Document Summarization API",
        description="Backend API for the Document Summarization Tool",
        version="1.0.0",
        lifespan=lifespan,
    )

    # Setup middleware
    setup_cors(app)

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        logger.error(
            "Unhandled %s on %s %s\n%s",
            type(exc).__name__,
            request.method,
            request.url.path,
            traceback.format_exc(),
        )
        return JSONResponse(
            status_code=500, content={"detail": str(exc)}
        )

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        response = await call_next(request)
        if response.status_code >= 500:
            logger.error("%s %s → %d", request.method, request.url.path, response.status_code)
        elif response.status_code >= 400:
            logger.warning("%s %s → %d", request.method, request.url.path, response.status_code)
        else:
            logger.info("%s %s → %d", request.method, request.url.path, response.status_code)
        return response

    # Include API routers
    app.include_router(auth.router)
    app.include_router(files.router)
    app.include_router(documents.router)
    app.include_router(extractions.router)
    app.include_router(evaluations.router)
    app.include_router(server.router)
    app.include_router(paragraphgenerator.router)
    app.include_router(paragraph_evaluation.router)
    app.include_router(sessions.router)
    app.include_router(groups.router)
    app.include_router(templates.router)

    return app


app = create_app()

if __name__ == "__main__":
    # uvicorn main:app --reload --port 8001 --host 0.0.0.0
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8001,
        reload=True,
        limit_max_request_size=25 * 1024 * 1024,  # 25MB limit
    )
