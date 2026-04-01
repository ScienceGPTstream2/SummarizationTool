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
                macbook_base_url = cfg.get("macbook_llm_base_url")
                if macbook_base_url:
                    os.environ.setdefault("MACBOOK_LLM_BASE_URL", macbook_base_url)
                    print(
                        f"✅ Macbook LLM base URL loaded from secrets.toml: {macbook_base_url}"
                    )
                azure_cfg = cfg.get("azure_openai", {}) or {}
                endpoint = azure_cfg.get("endpoint")
                api_key = azure_cfg.get("api_key")
                if endpoint:
                    os.environ.setdefault("AZURE_OPENAI_ENDPOINT", endpoint)
                if api_key:
                    os.environ.setdefault("AZURE_OPENAI_KEY", api_key)
                    os.environ.setdefault(
                        "AZURE_OPENAI_API_KEY", api_key
                    )  # Also set for compatibility

                # Support multiple models (new format)
                models = azure_cfg.get("models", [])
                if models:
                    # Store models as JSON string for the API endpoint to parse
                    import json

                    try:
                        # Verify each model has the required fields
                        for i, model in enumerate(models):
                            deployment = model.get("deployment")
                            endpoint = model.get("endpoint")
                            api_key = model.get("api_key")
                            if not deployment:
                                print(
                                    f"⚠️  Warning: Model {i} is missing 'deployment' field"
                                )
                            if not endpoint:
                                print(
                                    f"⚠️  Warning: Model '{deployment}' is missing 'endpoint' field"
                                )
                            if not api_key:
                                print(
                                    f"⚠️  Warning: Model '{deployment}' is missing 'api_key' field"
                                )

                        models_json = json.dumps(models, ensure_ascii=False)
                        os.environ["AZURE_OPENAI_MODELS"] = models_json
                        print(
                            f"✅ Loaded {len(models)} Azure OpenAI models from secrets.toml"
                        )
                        # Print summary of loaded models
                        for model in models:
                            dep = model.get("deployment", "unknown")
                            ep = model.get("endpoint", "missing")
                            has_key = "✓" if model.get("api_key") else "✗"
                            print(
                                f"   - {dep}: endpoint={ep[:50]}..., api_key={has_key}"
                            )
                    except Exception as e:
                        print(
                            f"⚠️  Failed to serialize Azure OpenAI models to JSON: {e}"
                        )
                    # Set first model as default for backward compatibility
                    if models and len(models) > 0:
                        first_model = models[0]
                        os.environ.setdefault(
                            "AZURE_OPENAI_DEPLOYMENT", first_model.get("deployment", "")
                        )
                        os.environ.setdefault(
                            "AZURE_OPENAI_MODEL_NAME", first_model.get("model_name", "")
                        )
                        os.environ.setdefault(
                            "AZURE_OPENAI_API_VERSION",
                            first_model.get("api_version", ""),
                        )
                else:
                    # Backward compatibility: support old single model format
                    api_version = azure_cfg.get("api_version")
                    if api_version:
                        os.environ.setdefault("AZURE_OPENAI_API_VERSION", api_version)
                    deployment = azure_cfg.get("deployment") or azure_cfg.get(
                        "model_name"
                    )
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
                    os.environ.setdefault("GEMINI_PROJECT_ID", project)
                if location:
                    os.environ.setdefault("GEMINI_LOCATION", location)

                # Anthropic configuration (for Claude models via Vertex AI)
                anthropic_cfg = cfg.get("anthropic", {}) or {}
                anthropic_project = anthropic_cfg.get("project_id")
                anthropic_location = anthropic_cfg.get("location")
                if anthropic_project:
                    os.environ.setdefault("ANTHROPIC_PROJECT_ID", anthropic_project)
                if anthropic_location:
                    os.environ.setdefault("ANTHROPIC_LOCATION", anthropic_location)

                # Set up Google Cloud credentials for Vertex AI (shared by Gemini and Anthropic)
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


    except Exception:
        pass
