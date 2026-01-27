"""
Custom Azure OpenAI adapter for DeepEval using LangChain
This follows the official DeepEval documentation pattern
"""

import os
import time
from pathlib import Path
from typing import Optional, Dict, Any, List
from deepeval.models.base_model import DeepEvalBaseLLM
from langchain_openai import AzureChatOpenAI


class AzureOpenAIDeepEvalModel(DeepEvalBaseLLM):
    """
    Custom DeepEval model adapter for Azure OpenAI using LangChain
    Follows official DeepEval documentation pattern for Azure OpenAI
    Always reads from backend/core/secrets.toml first, then falls back to environment variables
    """

    @staticmethod
    def _load_from_secrets_toml(
        deployment: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Load Azure OpenAI configuration from backend/core/secrets.toml

        Args:
            deployment: Optional deployment name to find specific model

        Returns:
            Dict with deployment, endpoint, api_key, api_version, model_name or None
        """
        try:
            import toml

            # Find secrets.toml in backend/core/ directory
            # Navigate from azure_adapter.py -> adapters/ -> evaluation/ -> services/ -> backend/ -> core/
            current_file = Path(__file__).resolve()
            # From file -> parent (adapters/) -> parent (evaluation/) -> parent (services/) -> parent (backend/)
            backend_path = current_file.parent.parent.parent.parent
            secrets_path = backend_path / "core" / "secrets.toml"

            # If not found, try alternative path resolution
            if not secrets_path.exists():
                # Walk up the directory tree to find backend/
                search_path = current_file.parent
                while search_path.parent != search_path:
                    if search_path.name == "backend":
                        secrets_path = search_path / "core" / "secrets.toml"
                        break
                    search_path = search_path.parent

            if not secrets_path.exists():
                return None

            with open(secrets_path, "r", encoding="utf-8") as f:
                cfg = toml.load(f)

            azure_cfg = cfg.get("azure_openai", {}) or {}

            # Support new format: [[azure_openai.models]] array
            models = azure_cfg.get("models", [])
            if models:
                # If deployment specified, find that model
                if deployment:
                    for model in models:
                        if model.get("deployment") == deployment:
                            return {
                                "deployment": model.get("deployment"),
                                "endpoint": model.get("endpoint"),
                                "api_key": model.get("api_key"),
                                "api_version": model.get("api_version"),
                                "model_name": model.get("model_name")
                                or model.get("deployment"),
                            }

                # If no deployment specified or not found, use first model
                if models:
                    first_model = models[0]
                    return {
                        "deployment": first_model.get("deployment"),
                        "endpoint": first_model.get("endpoint"),
                        "api_key": first_model.get("api_key"),
                        "api_version": first_model.get("api_version"),
                        "model_name": first_model.get("model_name")
                        or first_model.get("deployment"),
                    }

            # Fall back to old format: [azure_openai] section
            if azure_cfg:
                return {
                    "deployment": azure_cfg.get("deployment")
                    or azure_cfg.get("model_name"),
                    "endpoint": azure_cfg.get("endpoint"),
                    "api_key": azure_cfg.get("api_key"),
                    "api_version": azure_cfg.get("api_version"),
                    "model_name": azure_cfg.get("model_name"),
                }

        except Exception as e:
            # Silently fail and fall back to environment variables
            pass

        return None

    def __init__(
        self,
        deployment: Optional[str] = None,
        endpoint: Optional[str] = None,
        api_key: Optional[str] = None,
        api_version: Optional[str] = None,
        model_name: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: int = 2048,
    ):
        """
        Initialize Azure OpenAI adapter for DeepEval

        Always reads from backend/core/secrets.toml first, then falls back to:
        1. Provided parameters
        2. Environment variables

        Args:
            deployment: Azure deployment name
            endpoint: Azure OpenAI endpoint
            api_key: Azure OpenAI API key
            api_version: API version
            model_name: Model name (for display purposes)
            temperature: Temperature for generation (None = use model default, typically 1.0 for GPT-5 Mini)
            max_tokens: Max tokens for generation (default 2048)
        """
        # Load from secrets.toml first
        secrets_config = self._load_from_secrets_toml(deployment=deployment)

        # Use provided parameters, then secrets.toml, then environment variables
        self.deployment = (
            deployment
            or (secrets_config.get("deployment") if secrets_config else None)
            or os.getenv("AZURE_OPENAI_DEPLOYMENT")
            or os.getenv("AZURE_OPENAI_MODEL_NAME")
        )

        self.endpoint = (
            endpoint
            or (secrets_config.get("endpoint") if secrets_config else None)
            or os.getenv("AZURE_OPENAI_ENDPOINT")
        )

        self.api_key = (
            api_key
            or (secrets_config.get("api_key") if secrets_config else None)
            or os.getenv("AZURE_OPENAI_KEY")
        )

        self.api_version = (
            api_version
            or (secrets_config.get("api_version") if secrets_config else None)
            or os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")
        )

        self._model_name = (
            model_name
            or (secrets_config.get("model_name") if secrets_config else None)
            or os.getenv("AZURE_OPENAI_MODEL_NAME", "gpt-5-mini")
        )

        self.temperature = temperature
        self.max_tokens = max_tokens
        self.call_history: List[Dict[str, Any]] = []

        if not self.endpoint or not self.api_key or not self.deployment:
            raise ValueError(
                f"Azure OpenAI configuration incomplete. "
                f"Missing: endpoint={bool(self.endpoint)}, api_key={bool(self.api_key)}, deployment={bool(self.deployment)}. "
                f"Please check backend/core/secrets.toml or environment variables."
            )

        # Initialize LangChain Azure ChatOpenAI
        # Note: GPT-5 Mini only supports default temperature (1.0), so we omit it if not specified
        model_kwargs = {
            "openai_api_version": self.api_version,
            "azure_deployment": self.deployment,
            "azure_endpoint": self.endpoint,
            "openai_api_key": self.api_key,
            "max_tokens": self.max_tokens,
        }

        # Only set temperature if explicitly provided
        if self.temperature is not None:
            model_kwargs["temperature"] = self.temperature

        self.model = AzureChatOpenAI(**model_kwargs)

    def _record_call(self, duration: float, usage: Dict[str, Any]) -> None:
        prompt_tokens = usage.get("prompt_tokens")
        completion_tokens = usage.get("completion_tokens")
        total_tokens = usage.get("total_tokens")
        self.call_history.append(
            {
                "model": self._model_name,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
                "duration": duration,
            }
        )

    def _extract_usage(self, response) -> Dict[str, Any]:
        metadata = getattr(response, "response_metadata", {}) or {}
        token_usage = (
            metadata.get("token_usage")
            or metadata.get("usage")
            or metadata.get("usage_metadata")
            or {}
        )
        return {
            "prompt_tokens": token_usage.get("prompt_tokens")
            or token_usage.get("input_tokens")
            or token_usage.get("promptTokenCount")
            or token_usage.get("inputTokenCount"),
            "completion_tokens": token_usage.get("completion_tokens")
            or token_usage.get("output_tokens")
            or token_usage.get("completionTokenCount")
            or token_usage.get("outputTokenCount")
            or token_usage.get("candidatesTokenCount"),
            "total_tokens": token_usage.get("total_tokens")
            or token_usage.get("totalTokenCount"),
        }

    def load_model(self):
        """Load the LangChain model"""
        return self.model

    def generate(self, prompt: str) -> str:
        """
        Generate text using Azure OpenAI via LangChain

        Args:
            prompt: The prompt to send to the model

        Returns:
            Generated text response
        """
        chat_model = self.load_model()
        start_time = time.perf_counter()
        response = chat_model.invoke(prompt)
        duration = time.perf_counter() - start_time
        self._record_call(duration, self._extract_usage(response))
        return response.content

    async def a_generate(self, prompt: str) -> str:
        """
        Async generate text using Azure OpenAI via LangChain

        Args:
            prompt: The prompt to send to the model

        Returns:
            Generated text response
        """
        chat_model = self.load_model()
        start_time = time.perf_counter()
        response = await chat_model.ainvoke(prompt)
        duration = time.perf_counter() - start_time
        self._record_call(duration, self._extract_usage(response))
        return response.content

    def get_model_name(self) -> str:
        """Return the model name"""
        return self._model_name
