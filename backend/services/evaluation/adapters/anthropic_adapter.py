"""
Custom Anthropic Vertex AI adapter for DeepEval
This follows the official DeepEval documentation pattern using Anthropic Vertex SDK
"""

import os
import time
from typing import Optional, Dict, Any, List
from deepeval.models.base_model import DeepEvalBaseLLM
from anthropic import AnthropicVertex, AsyncAnthropicVertex


class AnthropicVertexDeepEvalModel(DeepEvalBaseLLM):
    """
    Custom DeepEval model adapter for Anthropic via Vertex AI
    Follows official DeepEval documentation pattern

    Uses AnthropicVertex SDK with service account authentication
    """

    def __init__(
        self,
        model_name: str = "claude-sonnet-4-5@20250929",
        project: Optional[str] = None,
        location: str = "global",
        temperature: Optional[float] = None,
        max_tokens: int = 2048,
    ):
        """
        Initialize Anthropic Vertex adapter for DeepEval

        Args:
            model_name: Claude model name (default: claude-sonnet-4-5@20250929)
            project: GCP project ID (defaults to hcsx-scigpt2-innocentrhino-acm)
            location: GCP location (default: global for Anthropic)
            temperature: Temperature for generation (None = use model default)
            max_tokens: Max tokens for generation (default 2048)
        """
        # Set the Google Application Credentials environment variable
        credentials_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "..",
            "core",
            "hcsx-scigpt2-innocentrhino-acm-f87f8026be3d.json",
        )
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path

        self._model_name = model_name
        self.project = project or "hcsx-scigpt2-innocentrhino-acm"
        self.location = location
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.call_history: List[Dict[str, Any]] = []

        # Initialize Anthropic Vertex client
        self.client = AnthropicVertex(region=self.location, project_id=self.project)
        self.async_client = AsyncAnthropicVertex(
            region=self.location, project_id=self.project
        )

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

    def _extract_usage(self, message) -> Dict[str, Any]:
        usage = getattr(message, "usage", None) or {}
        extracted = {
            "prompt_tokens": getattr(usage, "input_tokens", None)
            or usage.get("input_tokens")
            or usage.get("prompt_tokens"),
            "completion_tokens": getattr(usage, "output_tokens", None)
            or usage.get("output_tokens")
            or usage.get("completion_tokens"),
            "total_tokens": getattr(usage, "total_tokens", None)
            or usage.get("total_tokens"),
        }
        if not extracted.get("prompt_tokens") and not extracted.get(
            "completion_tokens"
        ):
            print(
                "[AnthropicAdapter] Missing token usage in response",
                {"usage": usage, "model": self._model_name},
            )
        return extracted

    def load_model(self):
        """Load the Anthropic Vertex client"""
        return self.client

    def generate(self, prompt: str) -> str:
        """
        Generate text using Anthropic Vertex AI

        Args:
            prompt: The prompt to send to the model

        Returns:
            Generated text response
        """
        client = self.load_model()

        # Prepare request parameters
        request_params = {
            "max_tokens": self.max_tokens,
            "messages": [{"role": "user", "content": prompt}],
            "model": self._model_name,
        }

        # Add temperature if explicitly provided
        if self.temperature is not None:
            request_params["temperature"] = self.temperature

        # Make the API call
        start_time = time.perf_counter()
        message = client.messages.create(**request_params)
        duration = time.perf_counter() - start_time
        self._record_call(duration, self._extract_usage(message))

        # Extract content from response
        if message.content and len(message.content) > 0:
            return message.content[0].text
        return ""

    async def a_generate(self, prompt: str) -> str:
        """
        Async generate text using Anthropic Vertex AI

        Args:
            prompt: The prompt to send to the model

        Returns:
            Generated text response
        """
        # Prepare request parameters
        request_params = {
            "max_tokens": self.max_tokens,
            "messages": [{"role": "user", "content": prompt}],
            "model": self._model_name,
        }

        # Add temperature if explicitly provided
        if self.temperature is not None:
            request_params["temperature"] = self.temperature

        # Make the API call
        start_time = time.perf_counter()
        message = await self.async_client.messages.create(**request_params)
        duration = time.perf_counter() - start_time
        self._record_call(duration, self._extract_usage(message))

        # Extract content from response
        if message.content and len(message.content) > 0:
            return message.content[0].text
        return ""

    def get_model_name(self) -> str:
        """Return the model name"""
        return self._model_name
