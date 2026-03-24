import os
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional
from .azure import AzureLLMClient
from .gemini import GeminiLLMClient
from .anthropic import AnthropicLLMClient
from .llama import LlamaLLMClient
from .macbook import MacbookLLMClient
from .retry_utils import CircuitBreaker, CircuitState
import toml

# The load_secrets_to_env function is moved to backend/main.py to ensure early loading.
# def load_secrets_to_env(secrets_path: str = "Summarization_tool/backend/core/secrets.toml"):
#     """Loads secrets from a TOML file into environment variables."""
#     try:
#         secrets = toml.load(secrets_path)
#         for section, keys in secrets.items():
#             for key, value in keys.items():
#                 env_key = f"{section.upper()}_{key.upper()}"
#                 os.environ[env_key] = str(value)
#     except FileNotFoundError:
#         print(f"Secrets file not found at {secrets_path}. Skipping loading.")
#     except Exception as e:
#         print(f"Error loading secrets from {secrets_path}: {e}")

# # Load secrets when the module is imported
# load_secrets_to_env()


class LLMService:
    """
    LLM Service for entity extraction and paragraph generation.
    Supports Azure OpenAI and Gemini models.
    """

    def __init__(self):
        self.azure_client = AzureLLMClient()
        self.gemini_client = GeminiLLMClient()
        self.anthropic_client = AnthropicLLMClient()
        self.llama_client = LlamaLLMClient()
        self.macbook_client = MacbookLLMClient()

        # One circuit breaker per provider
        self.circuit_breakers: Dict[str, CircuitBreaker] = {
            "azure": CircuitBreaker(name="azure"),
            "gemini": CircuitBreaker(name="gemini"),
            "anthropic": CircuitBreaker(name="anthropic"),
            "llama": CircuitBreaker(name="llama"),
            "macbook": CircuitBreaker(name="macbook"),
        }

        # Inject circuit breakers into clients so they can call check/record
        self.azure_client.circuit_breaker = self.circuit_breakers["azure"]
        self.gemini_client.circuit_breaker = self.circuit_breakers["gemini"]
        self.anthropic_client.circuit_breaker = self.circuit_breakers["anthropic"]
        self.llama_client.circuit_breaker = self.circuit_breakers["llama"]
        self.macbook_client.circuit_breaker = self.circuit_breakers["macbook"]

        # Timeout logging setup
        self.timeout_log_dir = (
            Path(__file__).resolve().parents[2] / "output" / "timeout_logs"
        )
        self.timeout_log_dir.mkdir(parents=True, exist_ok=True)
        self.timeout_log_file = self.timeout_log_dir / "timeout_log.txt"

    def _log_timeout(self, operation: str, details: str, duration: float = None):
        """
        Log timeout events to a file for monitoring API request issues.

        Args:
            operation: The operation that timed out (e.g., "entity_extraction", "figure_ocr")
            details: Additional details about the timeout
            duration: How long it took before timing out (if available)
        """
        timestamp = datetime.now().isoformat()
        duration_str = f" ({duration:.2f}s)" if duration else ""

        log_entry = f"[{timestamp}] TIMEOUT - {operation}{duration_str}: {details}\n"

        try:
            with open(self.timeout_log_file, "a", encoding="utf-8") as f:
                f.write(log_entry)
            print(f"[TIMEOUT_LOG] {log_entry.strip()}")
        except Exception as e:
            print(f"[TIMEOUT_LOG_ERROR] Failed to write to log file: {e}")

    async def _call_with_timeout_logging(
        self, operation: str, coro, timeout_seconds: int = 240
    ):
        """
        Call an async function with timeout detection and logging.

        Args:
            operation: Name of the operation for logging
            coro: The coroutine to call
            timeout_seconds: Timeout in seconds

        Returns:
            The result of the coroutine
        """
        start_time = datetime.now()

        try:
            result = await asyncio.wait_for(coro, timeout=timeout_seconds)
            return result
        except asyncio.TimeoutError:
            duration = (datetime.now() - start_time).total_seconds()
            self._log_timeout(
                operation, f"Request timed out after {timeout_seconds}s", duration
            )
            raise
        except Exception as e:
            # For other errors, also log if they seem timeout-related
            duration = (datetime.now() - start_time).total_seconds()
            error_msg = str(e).lower()
            if any(
                keyword in error_msg
                for keyword in ["timeout", "timed out", "deadline", "connection"]
            ):
                self._log_timeout(
                    operation, f"Timeout-related error: {str(e)}", duration
                )
            raise

    async def extract_entities_from_markdown(
        self,
        markdown: str,
        extraction_prompt: str,
        model_type: str,  # e.g., "azure", "gemini"
        model_id: Optional[str] = None,  # for Gemini
        deployment: Optional[str] = None,  # for Azure
        api_version: Optional[str] = None,  # for Azure
        endpoint_override: Optional[str] = None,  # for Azure
        api_key_override: Optional[str] = None,  # for Azure
        gemini_api_key_override: Optional[str] = None,  # for Gemini
        gemini_project_id_override: Optional[str] = None,  # for Gemini
        gemini_location_override: Optional[str] = None,  # for Gemini
        max_tokens: int = 8048,
        temperature: float = 0.0,
        system_message: Optional[str] = None,  # Custom system prompt
        max_input_length: int = 128000,  # Max input length for Llama (128K tokens ≈ 96K chars)
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Extract entities from markdown using the specified LLM.
        """
        operation_name = f"entity_extraction_{model_type}"

        try:
            if model_type == "azure":
                if self.azure_client.disabled:
                    return {
                        "success": False,
                        "error": "Azure OpenAI is not configured.",
                    }
                result = await self._call_with_timeout_logging(
                    operation_name,
                    self.azure_client.extract_entities_with_azure(
                        markdown,
                        extraction_prompt,
                        deployment,
                        api_version,
                        endpoint_override,
                        api_key_override,
                        max_tokens,
                        temperature,
                        system_message,
                    ),
                )
                self._record_session_metrics(session_id, "azure", result)
                return result
            elif model_type == "gemini":
                if self.gemini_client.disabled:
                    return {"success": False, "error": "Gemini is not configured."}
                result = await self._call_with_timeout_logging(
                    operation_name,
                    self.gemini_client.extract_entities_with_gemini(
                        markdown,
                        extraction_prompt,
                        model_id,
                        max_tokens,
                        temperature,
                        gemini_project_id_override,
                        gemini_location_override,
                        system_instruction=system_message,
                    ),
                )
                # Gemini responses include usageMetadata; ensure meta has tokens for downstream UI
                meta = result.get("meta") if isinstance(result, dict) else None
                if meta is not None:
                    usage = (
                        result.get("raw", {}).get("usageMetadata", {})
                        if isinstance(result.get("raw"), dict)
                        else {}
                    )
                    prompt_tokens = meta.get("prompt_tokens") or usage.get(
                        "promptTokenCount"
                    )
                    completion_tokens = meta.get("completion_tokens") or usage.get(
                        "candidatesTokenCount"
                    )
                    meta["prompt_tokens"] = prompt_tokens
                    meta["completion_tokens"] = completion_tokens
                self._record_session_metrics(session_id, "gcp", result)
                return result
            elif model_type == "anthropic":
                if self.anthropic_client.disabled:
                    return {"success": False, "error": "Anthropic is not configured."}
                result = await self._call_with_timeout_logging(
                    operation_name,
                    self.anthropic_client.extract_entities_with_anthropic(
                        markdown,
                        extraction_prompt,
                        model_id,
                        max_tokens,
                        temperature,
                    ),
                )
                self._record_session_metrics(session_id, "gcp", result)
                return result
            elif model_type == "llama":
                if self.llama_client.disabled:
                    return {"success": False, "error": "Llama is not configured."}
                # Allow 300s for Llama: Vertex AI MaaS has cold-start latency of 90-150s
                # when the model instance has been idle. Warm instances respond in 2-5s.
                result = await self._call_with_timeout_logging(
                    operation_name,
                    self.llama_client.extract_entities_with_llama(
                        markdown,
                        extraction_prompt,
                        model_id,
                        max_tokens,
                        temperature,
                        max_input_length,
                    ),
                    timeout_seconds=300,
                )
                self._record_session_metrics(session_id, "gcp", result)
                return result
            elif model_type == "azure-llama":
                if self.azure_client.disabled:
                    return {
                        "success": False,
                        "error": "Azure OpenAI is not configured.",
                    }
                result = await self._call_with_timeout_logging(
                    operation_name,
                    self.azure_client.extract_entities_with_azure(
                        markdown,
                        extraction_prompt,
                        deployment,
                        api_version,
                        endpoint_override,
                        api_key_override,
                        max_tokens,
                        temperature,
                        system_message,
                    ),
                )
                self._record_session_metrics(session_id, "azure", result)
                return result
            elif model_type == "macbook":
                if self.macbook_client.disabled:
                    return {"success": False, "error": "Macbook LLM is not configured."}
                # Macbook models are serialized through a FIFO queue (one request
                # at a time). Large documents can take >600s for local inference,
                # so the outer timeout must exceed per_attempt_timeout (1800s).
                # Use 1900s here to give the inner requests room to breathe.
                result = await self._call_with_timeout_logging(
                    operation_name,
                    self.macbook_client.extract_entities_with_macbook(
                        markdown,
                        extraction_prompt,
                        model_id,
                        max_tokens,
                        temperature,
                        system_message,
                    ),
                    timeout_seconds=1900,
                )
                self._record_session_metrics(session_id, "macbook", result)
                return result
            else:
                return {
                    "success": False,
                    "error": f"Unsupported model type: {model_type}",
                }
        except asyncio.TimeoutError:
            return {
                "success": False,
                "error": f"Request timed out for {model_type} model",
            }
        except Exception as e:
            from .retry_utils import CircuitOpenError
            if isinstance(e, CircuitOpenError):
                return {
                    "success": False,
                    "error": f"Circuit breaker OPEN for {model_type} — provider appears to be down. Retry in ~30s.",
                }
            # Log other errors that might be timeout-related
            error_msg = str(e).lower()
            if any(
                keyword in error_msg
                for keyword in ["timeout", "timed out", "deadline", "connection"]
            ):
                # This was already logged by _call_with_timeout_logging
                pass
            return {"success": False, "error": str(e)}

    async def extract_content_from_image(
        self,
        image_path: str,
        extraction_prompt: str,
        model_type: str,  # e.g., "gemini", "azure"
        model_id: Optional[str] = None,  # for Gemini
        deployment: Optional[str] = None,  # for Azure
        api_version: Optional[str] = None,  # for Azure
        endpoint_override: Optional[str] = None,  # for Azure
        api_key_override: Optional[str] = None,  # for Azure
        gemini_project_id_override: Optional[str] = None,  # for Gemini
        gemini_location_override: Optional[str] = None,  # for Gemini
        max_tokens: int = 8048,
        temperature: float = 0.0,
        system_message: Optional[str] = None,  # Custom system prompt
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Extract content from an image using vision-capable LLMs.
        """
        if model_type == "gemini":
            if self.gemini_client.disabled:
                return {"success": False, "error": "Gemini is not configured."}
            result = await self.gemini_client.extract_content_from_image(
                image_path,
                extraction_prompt,
                model_id,
                max_tokens,
                temperature,
                gemini_project_id_override,
                gemini_location_override,
                system_instruction=system_message,
            )
            self._record_session_metrics(session_id, "gcp", result)
            return result
        elif model_type == "azure":
            if self.azure_client.disabled:
                return {"success": False, "error": "Azure OpenAI is not configured."}
            result = await self.azure_client.extract_content_from_image(
                image_path,
                extraction_prompt,
                deployment,
                api_version,
                endpoint_override,
                api_key_override,
                max_tokens,
                temperature,
                system_message,
            )
            self._record_session_metrics(session_id, "azure", result)
            return result
        else:
            return {
                "success": False,
                "error": f"Unsupported model type for vision: {model_type}",
            }

    async def generate_paragraph(
        self,
        user_prompt: str,
        model_type: str,  # e.g., "azure", "gemini"
        model_id: Optional[str] = None,  # for Gemini
        deployment: Optional[str] = None,  # for Azure
        api_version: Optional[str] = None,  # for Azure
        endpoint_override: Optional[str] = None,  # for Azure
        api_key_override: Optional[str] = None,  # for Azure
        gemini_api_key_override: Optional[str] = None,  # for Gemini
        gemini_project_id_override: Optional[str] = None,  # for Gemini
        gemini_location_override: Optional[str] = None,  # for Gemini
        max_tokens: int = 8048,
        temperature: Optional[float] = None,
        system_message: Optional[str] = None,  # Custom system prompt
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate a paragraph using the specified LLM.
        """
        if model_type in ("azure", "azure-llama"):
            if self.azure_client.disabled:
                return {"success": False, "error": "Azure OpenAI is not configured."}
            result = await self.azure_client.generate_paragraph_with_azure(
                user_prompt,
                deployment,
                api_version,
                endpoint_override,
                api_key_override,
                max_tokens,
                temperature,
                system_message,
            )
            self._record_session_metrics(session_id, "azure", result)
            return result
        elif model_type == "gemini":
            if self.gemini_client.disabled:
                return {"success": False, "error": "Gemini is not configured."}
            result = await self.gemini_client.generate_paragraph_with_gemini(
                user_prompt,
                model_id,
                max_tokens,
                temperature,
                gemini_project_id_override,
                gemini_location_override,
                system_instruction=system_message,
            )
            self._record_session_metrics(session_id, "gcp", result)
            return result
        elif model_type == "anthropic":
            if self.anthropic_client.disabled:
                return {"success": False, "error": "Anthropic is not configured."}
            result = await self.anthropic_client.generate_paragraph_with_anthropic(
                user_prompt,
                model_id,
                max_tokens,
                temperature,
            )
            self._record_session_metrics(session_id, "gcp", result)
            return result
        elif model_type == "llama":
            if self.llama_client.disabled:
                return {"success": False, "error": "Llama is not configured."}
            # Wrap with timeout logging — same 300s budget as extraction
            result = await self._call_with_timeout_logging(
                "paragraph_llama",
                self.llama_client.generate_paragraph_with_llama(
                    user_prompt,
                    model_id,
                    max_tokens,
                    temperature,
                ),
                timeout_seconds=300,
            )
            self._record_session_metrics(session_id, "gcp", result)
            return result
        elif model_type == "macbook":
            if self.macbook_client.disabled:
                return {"success": False, "error": "Macbook LLM is not configured."}
            # Macbook requests are serialized through a FIFO queue; generous
            # timeout to accommodate queue wait time (same rationale as extraction).
            result = await self._call_with_timeout_logging(
                "paragraph_macbook",
                self.macbook_client.generate_paragraph_with_macbook(
                    user_prompt,
                    model_id,
                    max_tokens,
                    temperature,
                    system_message,
                ),
                timeout_seconds=1900,
            )
            self._record_session_metrics(session_id, "macbook", result)
            return result
        else:
            return {"success": False, "error": f"Unsupported model type: {model_type}"}

    def get_circuit_breaker_states(self) -> Dict[str, Any]:
        """Return a snapshot of each provider's circuit breaker state."""
        return {
            name: cb.as_dict()
            for name, cb in self.circuit_breakers.items()
        }

    def _record_session_metrics(
        self, session_id: Optional[str], provider: str, result: Dict[str, Any]
    ) -> None:
        if not result or not result.get("success"):
            return
        try:
            from services.telemetry.cost_tracker import cost_tracker

            meta = result.get("meta", {}) if isinstance(result, dict) else {}
            model = meta.get("model") or meta.get("deployment") or "unknown"
            if provider == "macbook":
                cost_tracker.record_call(
                    session_id=session_id,
                    provider=provider,
                    model=model,
                    prompt_tokens=meta.get("prompt_tokens"),
                    completion_tokens=meta.get("completion_tokens"),
                    duration=meta.get("duration"),
                )
                return
            cost_tracker.record_call(
                session_id=session_id,
                provider=provider,
                model=model,
                prompt_tokens=meta.get("prompt_tokens"),
                completion_tokens=meta.get("completion_tokens"),
                duration=meta.get("duration"),
            )
        except Exception as e:
            print(f"[COST_TRACKER] Failed to record session metrics: {e}")
