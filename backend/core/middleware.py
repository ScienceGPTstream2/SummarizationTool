"""Application middleware configuration"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

def setup_cors(app: FastAPI):
    """Configure CORS middleware for the application"""
    # NOTE: During local development many people run the frontend on a public host
    # (vite --host) or access it via a machine IP. The frontend origin will then
    # be something like "http://<PUBLIC_IP>:3000" which is different from
    # "http://localhost:3000", and the browser will block responses unless that
    # origin is allowed by the backend CORS policy.
    #
    # For development, allow_origins is set to ["*"] so the dev frontend can call
    # the API regardless of how you're accessing the dev server. Do NOT use this
    # in production; restrict origins to a specific list there.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Dev-only: allow any origin. For production, restrict this.
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )