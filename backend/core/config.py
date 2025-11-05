"""Application configuration loading"""

import os
from pathlib import Path


def load_config():
    """Load configuration from secrets.toml file"""
    try:
        import toml

        # Load secrets.toml from backend/core/ directory
        config_path = Path(__file__).resolve().parent / "secrets.toml"
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = toml.load(f)
                azure_cfg = cfg.get("azure_openai", {}) or {}
                endpoint = azure_cfg.get("endpoint")
                api_key = azure_cfg.get("api_key")
                api_version = azure_cfg.get("api_version")
                if endpoint:
                    os.environ.setdefault("AZURE_OPENAI_ENDPOINT", endpoint)
                if api_key:
                    os.environ.setdefault("AZURE_OPENAI_KEY", api_key)
                if api_version:
                    os.environ.setdefault("AZURE_OPENAI_API_VERSION", api_version)
                # Optional: set default deployment/model name so LLMService can pick it up
                deployment = azure_cfg.get("deployment") or azure_cfg.get("model_name")
                model_name = azure_cfg.get("model_name")
                if deployment:
                    os.environ.setdefault("AZURE_OPENAI_DEPLOYMENT", deployment)
                if model_name:
                    os.environ.setdefault("AZURE_OPENAI_MODEL_NAME", model_name)

                # Azure Document Intelligence configuration
                azure_doc_cfg = cfg.get("azure_doc_intelligence", {}) or {}
                doc_endpoint = azure_doc_cfg.get("endpoint")
                doc_key = azure_doc_cfg.get("key")
                if doc_endpoint:
                    os.environ.setdefault(
                        "AZURE_DOC_INTELLIGENCE_ENDPOINT", doc_endpoint
                    )
                if doc_key:
                    os.environ.setdefault("AZURE_DOC_INTELLIGENCE_KEY", doc_key)

                # Vertex AI configuration (for Gemini evaluation)
                vertex_cfg = cfg.get("vertex_ai", {}) or {}
                project = vertex_cfg.get("project")
                location = vertex_cfg.get("location")
                if project:
                    os.environ.setdefault("GEMINI_PROJECT", project)
                if location:
                    os.environ.setdefault("GEMINI_LOCATION", location)

                # Set up Google Cloud credentials for Vertex AI
                # Look for service account key in backend/core/ directory
                service_account_path = (
                    Path(__file__).parent
                    / "hcsx-scigpt2-innocentrhino-acm-f87f8026be3d.json"
                )
                if service_account_path.exists():
                    os.environ.setdefault(
                        "GOOGLE_APPLICATION_CREDENTIALS", str(service_account_path)
                    )
                    print(
                        f"✅ Google Cloud credentials loaded from: {service_account_path.name}"
                    )

                # Security configuration (JWT)
                security_cfg = cfg.get("security", {}) or {}
                jwt_secret = security_cfg.get("jwt_secret")
                jwt_expiration_hours = security_cfg.get("jwt_expiration_hours")
                if jwt_secret:
                    os.environ.setdefault("JWT_SECRET", jwt_secret)
                if jwt_expiration_hours:
                    os.environ.setdefault(
                        "JWT_EXPIRATION_HOURS", str(jwt_expiration_hours)
                    )

    except Exception:
        pass
