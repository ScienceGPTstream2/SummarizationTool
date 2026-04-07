"""Application middleware configuration"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def setup_cors(app: FastAPI):
    """Configure CORS middleware for the application"""
    # In production, set CORS_ALLOWED_ORIGINS to a comma-separated list of
    # allowed origins (e.g. "https://myapp.azurestaticapps.net").
    # Defaults to "*" for local development.
    allowed = os.environ.get("CORS_ALLOWED_ORIGINS", "*")
    origins = [o.strip() for o in allowed.split(",")] if allowed != "*" else ["*"]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
