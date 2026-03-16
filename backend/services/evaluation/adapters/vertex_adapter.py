"""
Custom Vertex AI (Gemini) adapter for DeepEval using LangChain
This follows the official DeepEval documentation pattern with safety settings
"""

import os
import asyncio
import time
import random
from typing import Optional, Dict, Any, List
from deepeval.models.base_model import DeepEvalBaseLLM
from langchain_google_vertexai import (
    ChatVertexAI,
    HarmBlockThreshold,
    HarmCategory,
)

# Limit concurrent Vertex AI API calls. Gemini has much higher quotas than Azure,
# but still benefits from throttling to avoid 429s under heavy parallel load.
_VERTEX_API_SEMAPHORE: Optional[asyncio.Semaphore] = None


def _get_vertex_semaphore() -> asyncio.Semaphore:
    global _VERTEX_API_SEMAPHORE
    if _VERTEX_API_SEMAPHORE is None:
        _VERTEX_API_SEMAPHORE = asyncio.Semaphore(25)
    return _VERTEX_API_SEMAPHORE


class VertexAIDeepEvalModel(DeepEvalBaseLLM):
    """
    Custom DeepEval model adapter for Vertex AI using LangChain
    Follows official DeepEval documentation pattern for Google Vertex AI

    Includes safety settings to ensure evaluation responses are not blocked
    """

    def __init__(
        self,
        model_name: str = "gemini-2.0-flash-exp",
        project: Optional[str] = None,
        location: Optional[str] = None,
        temperature: Optional[float] = None,
        max_output_tokens: int = 2048,
    ):
        """
        Initialize Vertex AI adapter for DeepEval

        Args:
            model_name: Gemini model name (e.g., 'gemini-2.0-flash-exp', 'gemini-1.5-pro')
            project: GCP project ID
            location: GCP location (e.g., 'us-central1')
            temperature: Temperature for generation (None = use model default)
            max_output_tokens: Max tokens for generation (default 2048)
        """
        self._model_name = model_name
        self.project = project or os.getenv("GEMINI_PROJECT")
        self.location = location or os.getenv("GEMINI_LOCATION", "us-central1")
        self.temperature = temperature
        self.call_history: List[Dict[str, Any]] = []

        if not self.project:
            raise ValueError(
                "GCP project must be provided or set via GEMINI_PROJECT env var"
            )

        # Initialize safety filters for vertex model
        # This is CRITICAL to ensure no evaluation responses are blocked
        # As per official DeepEval documentation
        safety_settings = {
            HarmCategory.HARM_CATEGORY_UNSPECIFIED: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
        }

        # Initialize LangChain ChatVertexAI
        model_kwargs = {
            "model_name": model_name,
            "safety_settings": safety_settings,
            "project": self.project,
            "location": self.location,
            "max_output_tokens": max_output_tokens,
        }

        # Only set temperature if explicitly provided
        if self.temperature is not None:
            model_kwargs["temperature"] = self.temperature

        self.model = ChatVertexAI(**model_kwargs)

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
        usage = {
            "prompt_tokens": token_usage.get("prompt_tokens")
            or token_usage.get("input_tokens")
            or token_usage.get("prompt_token_count")
            or token_usage.get("promptTokenCount")
            or token_usage.get("inputTokenCount"),
            "completion_tokens": token_usage.get("completion_tokens")
            or token_usage.get("output_tokens")
            or token_usage.get("candidates_token_count")
            or token_usage.get("completionTokenCount")
            or token_usage.get("outputTokenCount")
            or token_usage.get("candidatesTokenCount"),
            "total_tokens": token_usage.get("total_tokens")
            or token_usage.get("total_token_count")
            or token_usage.get("totalTokenCount"),
        }
        if not usage.get("prompt_tokens") and not usage.get("completion_tokens"):
            print(
                "[VertexAdapter] Missing token usage in response metadata",
                {"metadata": metadata, "model": self._model_name},
            )
        return usage

    def load_model(self):
        """Load the LangChain model"""
        return self.model

    def generate(self, prompt: str) -> str:
        """
        Generate text using Vertex AI via LangChain with retry logic for rate limits

        Args:
            prompt: The prompt to send to the model

        Returns:
            Generated text response
        """
        # Retry configuration
        max_retries = 5
        base_delay = 1.0  # Start with 1 second
        max_delay = 30.0  # Cap at 30 seconds

        chat_model = self.load_model()
        last_error = None

        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    # Calculate exponential backoff with jitter
                    delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
                    jitter = random.uniform(0, 1)
                    total_delay = delay + jitter
                    print(
                        f"[VertexAdapter] Retry attempt {attempt + 1}/{max_retries} after {total_delay:.2f}s delay..."
                    )
                    time.sleep(total_delay)

                start_time = time.perf_counter()
                response = chat_model.invoke(prompt)
                duration = time.perf_counter() - start_time
                self._record_call(duration, self._extract_usage(response))
                return response.content

            except Exception as e:
                error_str = str(e).lower()
                error_code = getattr(e, "status_code", None)

                # Check if it's a retryable error (429, 500, 503, 504)
                is_rate_limit = (
                    error_code == 429
                    or "429" in error_str
                    or "rate limit" in error_str
                    or "resource_exhausted" in error_str
                    or "quota" in error_str
                )
                is_server_error = (
                    error_code in [500, 503, 504]
                    or "500" in error_str
                    or "503" in error_str
                    or "504" in error_str
                    or "internal" in error_str
                    or "unavailable" in error_str
                    or "deadline_exceeded" in error_str
                )

                if (is_rate_limit or is_server_error) and attempt < max_retries - 1:
                    error_type = "rate limit" if is_rate_limit else "server error"
                    print(
                        f"[VertexAdapter] Received {error_type} error, will retry. Error: {str(e)}"
                    )
                    last_error = e
                    continue
                else:
                    # Non-retryable error or max retries reached
                    if attempt >= max_retries - 1:
                        print(
                            f"[VertexAdapter] Max retries reached. Final error: {str(e)}"
                        )
                    raise

    async def a_generate(self, prompt: str) -> str:
        """
        Async generate text using Vertex AI via LangChain with retry logic for rate limits

        Args:
            prompt: The prompt to send to the model

        Returns:
            Generated text response
        """
        # Retry configuration
        max_retries = 5
        base_delay = 1.0  # Start with 1 second
        max_delay = 30.0  # Cap at 30 seconds

        chat_model = self.load_model()
        last_error = None

        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    # Calculate exponential backoff with jitter.
                    # Sleep OUTSIDE the semaphore so a waiting task does not
                    # park a concurrency slot while other callers could use it.
                    delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
                    jitter = random.uniform(0, 1)
                    total_delay = delay + jitter
                    print(
                        f"[VertexAdapter] Retry attempt {attempt + 1}/{max_retries} after {total_delay:.2f}s delay..."
                    )
                    await asyncio.sleep(total_delay)

                async with _get_vertex_semaphore():
                    start_time = time.perf_counter()
                    response = await chat_model.ainvoke(prompt)
                    duration = time.perf_counter() - start_time
                    self._record_call(duration, self._extract_usage(response))
                    return response.content

            except Exception as e:
                error_str = str(e).lower()
                error_code = getattr(e, "status_code", None)

                # Check if it's a retryable error (429, 500, 503, 504)
                is_rate_limit = (
                    error_code == 429
                    or "429" in error_str
                    or "rate limit" in error_str
                    or "resource_exhausted" in error_str
                    or "quota" in error_str
                )
                is_server_error = (
                    error_code in [500, 503, 504]
                    or "500" in error_str
                    or "503" in error_str
                    or "504" in error_str
                    or "internal" in error_str
                    or "unavailable" in error_str
                    or "deadline_exceeded" in error_str
                )

                if (is_rate_limit or is_server_error) and attempt < max_retries - 1:
                    error_type = "rate limit" if is_rate_limit else "server error"
                    print(
                        f"[VertexAdapter] Received {error_type} error, will retry. Error: {str(e)}"
                    )
                    last_error = e
                    continue
                else:
                    # Non-retryable error or max retries reached
                    if attempt >= max_retries - 1:
                        print(
                            f"[VertexAdapter] Max retries reached. Final error: {str(e)}"
                        )
                    raise

    def get_model_name(self) -> str:
        """Return the model name"""
        return self._model_name
