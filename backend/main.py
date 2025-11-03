"""
FastAPI Application Entry Point

This is the main application launcher that:
1. Loads configuration
2. Creates the FastAPI app
3. Sets up middleware
4. Includes all API routers
5. Starts the server
"""

import uvicorn
from fastapi import FastAPI, Request
import os
import toml

# Load configuration before importing services
from core.config import load_config

# Moved load_secrets_to_env here to ensure all secrets are loaded early
def load_secrets_to_env(secrets_path: str = None):
    """Loads secrets from a TOML file into environment variables."""
    if secrets_path is None:
        # Try relative path first (when running from backend directory)
        secrets_path = "core/secrets.toml"
        if not os.path.exists(secrets_path):
            # Try absolute path (when running from project root)
            secrets_path = "Summarization_tool/backend/core/secrets.toml"
    
    try:
        secrets = toml.load(secrets_path)
        for section, keys in secrets.items():
            for key, value in keys.items():
                env_key = f"{section.upper()}_{key.upper()}"
                os.environ[env_key] = str(value)
        print(f"Successfully loaded secrets from {secrets_path}")
    except FileNotFoundError:
        print(f"Secrets file not found at {secrets_path}. Skipping loading.")
    except Exception as e:
        print(f"Error loading secrets from {secrets_path}: {e}")

load_secrets_to_env()
load_config()

from core.middleware import setup_cors
from api import auth, files, documents, extractions, server, paragraphgenerator


def create_app() -> FastAPI:
    """Create and configure the FastAPI application"""

    app = FastAPI(
        title="Document Summarization API",
        description="Backend API for the Document Summarization Tool",
        version="1.0.0",
    )

    # Setup middleware
    setup_cors(app)

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        print(f"Incoming request: {request.method} {request.url.path}")
        response = await call_next(request)
        return response

    # Include API routers
    app.include_router(auth.router)
    app.include_router(files.router)
    app.include_router(documents.router)
    app.include_router(extractions.router)
    app.include_router(server.router)
    app.include_router(paragraphgenerator.router)

    return app


app = create_app()

if __name__ == "__main__":
    # uvicorn main:app --reload --port 8000 --host 0.0.0.0
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        reload=True,
        limit_max_request_size=25 * 1024 * 1024,  # 25MB limit
    )
