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
from fastapi import FastAPI

# Load configuration before importing services
from core.config import load_config

load_config()

from core.middleware import setup_cors
from api import auth, files, documents, extractions, server


def create_app() -> FastAPI:
    """Create and configure the FastAPI application"""

    app = FastAPI(
        title="Document Summarization API",
        description="Backend API for the Document Summarization Tool",
        version="1.0.0",
    )

    # Setup middleware
    setup_cors(app)

    # Include API routers
    app.include_router(auth.router)
    app.include_router(files.router)
    app.include_router(documents.router)
    app.include_router(extractions.router)
    app.include_router(server.router)

    return app


app = create_app()

if __name__ == "__main__":
    # uvicorn main:app --reload --port 8000 --host 0.0.0.0
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
