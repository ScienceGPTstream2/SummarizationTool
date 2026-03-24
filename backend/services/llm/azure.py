import os
import json
import asyncio
import time
import random
from typing import Dict, Any, Optional, List
from datetime import datetime
import requests
from pydantic import BaseModel, Field
from openai import OpenAI
from .retry_utils import CircuitBreaker, CircuitOpenError


# Pydantic models for structured output
class MarkdownReference(BaseModel):
    """A reference to a specific section of the markdown that was used"""

    text: str = Field(
        description="The exact text excerpt from the markdown that was referenced"
    )


class ExtractionResult(BaseModel):
    """Structured result containing both the extracted answer and its references"""

    answer: str = Field(
        description="The extracted information or answer based on the prompt"
    )
    references: List[MarkdownReference] = Field(
        description="List of specific text excerpts from the markdown that were used to generate this answer"
    )


class AzureLLMClient:
    def __init__(self):
        self.endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")
        self.api_key = os.environ.get("AZURE_OPENAI_KEY")
        self.api_version = os.environ.get(
            "AZURE_OPENAI_API_VERSION", "2024-08-01-preview"
        )
        self.default_deployment = os.environ.get("AZURE_OPENAI_DEPLOYMENT")
        self.default_model_name = os.environ.get("AZURE_OPENAI_MODEL_NAME")
        # Load configured models to look up API versions, endpoints, and keys
        self._load_configured_models()
        # Client is disabled only if there's no global endpoint/key AND no configured models
        # (models can have their own endpoints/keys, so we check if any models exist)
        has_global_creds = self.endpoint and self.api_key
        has_configured_models = len(self.configured_models) > 0
        self.disabled = not has_global_creds and not has_configured_models

        # Circuit breaker injected by LLMService after construction
        self.circuit_breaker: Optional[CircuitBreaker] = None

    def _load_configured_models(self):
        """Load configured models from environment to enable API version, endpoint, and key lookup"""
        import json

        self.configured_models = {}  # deployment -> {api_version, endpoint, api_key}
        azure_models_json = os.environ.get("AZURE_OPENAI_MODELS")
        if azure_models_json:
            try:
                models_list = json.loads(azure_models_json)
                print(
                    f"[AzureLLMClient] Loading {len(models_list)} configured models..."
                )
                for model_cfg in models_list:
                    deployment = model_cfg.get("deployment")
                    if deployment:
                        endpoint = model_cfg.get("endpoint")
                        api_key = model_cfg.get("api_key")
                        api_version = model_cfg.get("api_version")
                        model_info = {
                            "api_version": api_version,
                            "endpoint": endpoint,  # Model-specific endpoint
                            "api_key": api_key,  # Model-specific key
                        }
                        self.configured_models[deployment] = model_info
                        # Verify we have the required fields
                        if not endpoint:
                            print(
                                f"⚠️  Warning: Model '{deployment}' has no endpoint configured"
                            )
                        if not api_key:
                            print(
                                f"⚠️  Warning: Model '{deployment}' has no api_key configured"
                            )
                        else:
                            # Show first few chars of endpoint for verification
                            ep_preview = (
                                endpoint[:50] + "..."
                                if endpoint and len(endpoint) > 50
                                else endpoint
                            )
                            print(
                                f"   ✓ {deployment}: endpoint={ep_preview}, api_version={api_version}, api_key={'✓' if api_key else '✗'}"
                            )
            except Exception as e:
                print(f"⚠️  Failed to load configured models for lookup: {e}")

    def _get_api_version_for_deployment(
        self, deployment: str, provided_api_version: Optional[str] = None
    ) -> str:
        """Get the API version for a specific deployment, with fallback logic"""
        # If API version is explicitly provided, use it
        if provided_api_version:
            return provided_api_version
        # Try to look up from configured models
        if deployment in self.configured_models:
            model_info = self.configured_models[deployment]
            if model_info.get("api_version"):
                return model_info["api_version"]
        # Fall back to default API version
        return self.api_version or "2024-08-01-preview"

    def _get_endpoint_for_deployment(
        self, deployment: str, provided_endpoint: Optional[str] = None
    ) -> Optional[str]:
        """Get the endpoint for a specific deployment, with fallback logic"""
        # If endpoint is explicitly provided, use it
        if provided_endpoint:
            return provided_endpoint
        # Try to look up from configured models
        if deployment in self.configured_models:
            model_info = self.configured_models[deployment]
            if model_info.get("endpoint"):
                return model_info["endpoint"]
        # Fall back to default endpoint
        return self.endpoint

    def _get_api_key_for_deployment(
        self, deployment: str, provided_api_key: Optional[str] = None
    ) -> Optional[str]:
        """Get the API key for a specific deployment, with fallback logic"""
        # If API key is explicitly provided, use it
        if provided_api_key:
            return provided_api_key
        # Try to look up from configured models
        if deployment in self.configured_models:
            model_info = self.configured_models[deployment]
            if model_info.get("api_key"):
                return model_info["api_key"]
        # Fall back to default API key
        return self.api_key

    def _is_foundry_endpoint(self, endpoint: str) -> bool:
        """Azure AI Foundry serverless endpoints use a different URL/payload format."""
        return ".services.ai.azure.com" in (endpoint or "")

    async def generate_paragraph_with_azure(
        self,
        user_prompt: str,
        deployment: Optional[str] = None,
        api_version: Optional[str] = None,
        endpoint_override: Optional[str] = None,
        api_key_override: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: Optional[float] = None,
        system_message: Optional[str] = None,
    ) -> Dict[str, Any]:
        used_deployment = (
            deployment or self.default_deployment or self.default_model_name
        )
        if not used_deployment:
            return {"success": False, "error": "Azure deployment name missing."}

        # Get endpoint and API key for this specific deployment
        used_endpoint = endpoint_override or self._get_endpoint_for_deployment(
            used_deployment
        )
        used_api_key = api_key_override or self._get_api_key_for_deployment(
            used_deployment
        )
        if not used_endpoint or not used_api_key:
            return {"success": False, "error": "Azure endpoint or api key missing."}

        # Use provided system message or default for paragraph generation
        used_system_message = (
            system_message
            or "You are a scientific writing assistant. Your task is to synthesize extracted information into a cohesive, well-structured paragraph while maintaining complete accuracy. Follow the instructions exactly and preserve all factual details from the provided entities."
        )
        messages = [
            {"role": "system", "content": used_system_message},
            {"role": "user", "content": user_prompt},
        ]

        used_deployment = (
            deployment or self.default_deployment or self.default_model_name
        )
        if not used_deployment:
            return {"success": False, "error": "Azure deployment name missing."}

        # Get API version for this specific deployment
        used_api_version = self._get_api_version_for_deployment(
            used_deployment, api_version
        )
        is_foundry = self._is_foundry_endpoint(used_endpoint)
        if is_foundry:
            url = f"{used_endpoint.rstrip('/')}/models/chat/completions?api-version={used_api_version}"
        else:
            url = f"{used_endpoint.rstrip('/')}/openai/deployments/{used_deployment}/chat/completions?api-version={used_api_version}"

        print(
            f"[LLMService] Using deployment: {used_deployment}, API version: {used_api_version}"
        )

        payload = {
            "messages": messages,
            "max_completion_tokens": max_tokens,
            "n": 1,
            "stop": None,
        }
        # Only include temperature if explicitly provided (some models like GPT-5 don't support it)
        if temperature is not None:
            payload["temperature"] = temperature
        # AI Foundry serverless API requires model name in the request body
        if is_foundry:
            payload["model"] = used_deployment

        headers = {"Content-Type": "application/json", "api-key": used_api_key}

        # Check circuit breaker before attempting any network calls
        cb = self.circuit_breaker
        if cb is not None:
            try:
                cb.check()
            except CircuitOpenError as e:
                return {"success": False, "error": str(e)}

        # Retry configuration
        max_retries = 3
        base_delay = 1.0  # Start with 1 second
        max_delay = 30.0  # Cap at 30 seconds
        retryable_status_codes = [429, 500, 503, 504]  # Rate limit and server errors

        last_error = None
        resp = None
        raw = None
        duration = None

        for attempt in range(max_retries):
            try:
                if attempt > 0:
                    # Calculate exponential backoff with jitter
                    delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
                    jitter = random.uniform(0, 1)
                    total_delay = delay + jitter
                    print(
                        f"[LLMService] Retry attempt {attempt + 1}/{max_retries} after {total_delay:.2f}s delay..."
                    )
                    await asyncio.sleep(total_delay)
                else:
                    redacted_key = used_api_key
                    if isinstance(redacted_key, str) and len(redacted_key) > 8:
                        redacted_key = redacted_key[:4] + "..." + redacted_key[-4:]
                    redacted_headers = {
                        "Content-Type": headers.get("Content-Type"),
                        "api-key": redacted_key,
                    }
                    print(f"[LLMService] Request URL: {url}")
                    print(f"[LLMService] Headers: {redacted_headers}")
                    try:
                        msg_count = len(messages)
                    except Exception:
                        msg_count = "unknown"
                    print(
                        f"[LLMService] Payload messages: {msg_count}, max_tokens={max_tokens}"
                    )

                start_time = time.time()
                resp = await asyncio.to_thread(
                    lambda: requests.post(
                        url, headers=headers, json=payload, timeout=120
                    )
                )
                duration = time.time() - start_time
                print(
                    f"[LLMService] HTTP status: {getattr(resp, 'status_code', 'no-status')}"
                )
                print(f"[LLMService] Request duration: {duration:.2f}s")

                try:
                    raw = resp.json()
                except Exception:
                    if not resp.ok:
                        return {
                            "success": False,
                            "error": f"Non-JSON response: {resp.text}",
                        }

                # Check for retryable errors
                if resp.status_code in retryable_status_codes:
                    error_msg = (
                        raw.get("error", {}).get("message", "")
                        if isinstance(raw, dict)
                        else str(raw)
                    )
                    status_text = {
                        429: "RESOURCE_EXHAUSTED (rate limit)",
                        500: "INTERNAL (server error)",
                        503: "UNAVAILABLE (service overloaded)",
                        504: "DEADLINE_EXCEEDED (timeout)",
                    }.get(resp.status_code, f"HTTP {resp.status_code}")

                    if attempt < max_retries - 1:
                        print(
                            f"[LLMService] Received {status_text}, will retry. Error: {error_msg}"
                        )
                        if cb is not None:
                            await cb.record_failure()
                        last_error = error_msg
                        continue  # Retry
                    else:
                        # Last attempt failed
                        print(
                            f"[LLMService] Max retries reached. Final error: {status_text}"
                        )
                        if cb is not None:
                            await cb.record_failure()
                        err = raw.get("error") if isinstance(raw, dict) else resp.text
                        error_msg = (
                            f"Azure API error (status {resp.status_code}): {err}"
                        )
                        print(f"[LLMService] Error response: {raw}")
                        return {"success": False, "error": error_msg, "raw": raw}

                # Non-retryable error or success
                if not resp.ok:
                    err = raw.get("error") if isinstance(raw, dict) else resp.text

                    # Handle models that don't support custom temperature (e.g., GPT-5)
                    # Retry once without temperature parameter
                    if (
                        resp.status_code == 400
                        and isinstance(raw, dict)
                        and "temperature"
                        in raw.get("error", {}).get("message", "").lower()
                        and "temperature" in payload
                    ):
                        print(
                            f"[LLMService] Model does not support custom temperature, retrying without temperature..."
                        )
                        payload.pop("temperature", None)
                        continue  # Retry without temperature

                    if cb is not None:
                        await cb.record_failure()
                    error_msg = f"Azure API error (status {resp.status_code}): {err}"
                    if resp.status_code == 404:
                        error_msg += f"\n⚠️  Deployment '{used_deployment}' with API version '{used_api_version}' not found. "
                        error_msg += f"Please verify the deployment name and API version are correct in secrets.toml"
                    print(f"[LLMService] Error response: {raw}")
                    print(f"[LLMService] {error_msg}")
                    return {"success": False, "error": error_msg, "raw": raw}

                # Success - break out of retry loop
                break

            except requests.exceptions.Timeout as e:
                if cb is not None:
                    await cb.record_failure()
                if attempt < max_retries - 1:
                    print(f"[LLMService] Request timeout, will retry. Error: {str(e)}")
                    last_error = str(e)
                    continue
                else:
                    print(f"[LLMService] Max retries reached after timeout")
                    return {
                        "success": False,
                        "error": f"Request timeout after {max_retries} attempts: {str(e)}",
                    }

            except requests.exceptions.RequestException as e:
                if cb is not None:
                    await cb.record_failure()
                if attempt < max_retries - 1:
                    print(
                        f"[LLMService] Request exception, will retry. Error: {str(e)}"
                    )
                    last_error = str(e)
                    continue
                else:
                    print(f"[LLMService] Max retries reached after request exception")
                    return {
                        "success": False,
                        "error": f"Request failed after {max_retries} attempts: {str(e)}",
                    }

            except Exception as e:
                print(f"[LLMService] Request failed with exception: {e}")
                return {"success": False, "error": f"Request failed: {str(e)}"}

        # Extract content safely (we should have a successful response at this point)
        if not resp or not raw:
            return {
                "success": False,
                "error": "Failed to get valid response after retries",
            }

        try:
            content = raw.get("choices", [])[0].get("message", {}).get("content", "")
        except Exception:
            content = json.dumps(raw)

        usage = raw.get("usage", {})
        prompt_tokens = usage.get("prompt_tokens")
        completion_tokens = usage.get("completion_tokens")

        if cb is not None:
            await cb.record_success()
        return {
            "success": True,
            "content": content,
            "raw": raw,
            "meta": {
                "timestamp": datetime.utcnow().isoformat(),
                "deployment": used_deployment,
                "duration": duration,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            },
        }

    async def extract_entities_with_azure(
        self,
        markdown: str,
        extraction_prompt: str,
        deployment: Optional[str] = None,
        api_version: Optional[str] = None,
        endpoint_override: Optional[str] = None,
        api_key_override: Optional[str] = None,
        max_tokens: int = 1024,
        temperature: float = 0.0,
        system_message: Optional[str] = None,
    ) -> Dict[str, Any]:
        used_deployment = (
            deployment or self.default_deployment or self.default_model_name
        )
        if not used_deployment:
            return {"success": False, "error": "Azure deployment name missing."}

        # Get endpoint and API key for this specific deployment
        used_endpoint = endpoint_override or self._get_endpoint_for_deployment(
            used_deployment
        )
        used_api_key = api_key_override or self._get_api_key_for_deployment(
            used_deployment
        )
        if not used_endpoint or not used_api_key:
            return {"success": False, "error": "Azure endpoint or api key missing."}

        # Get API version for this specific deployment
        used_api_version = self._get_api_version_for_deployment(
            used_deployment, api_version
        )

        # Check circuit breaker before attempting any network calls
        cb = self.circuit_breaker
        if cb is not None:
            try:
                cb.check()
            except CircuitOpenError as e:
                return {"success": False, "error": str(e)}

        # Use structured outputs with OpenAI SDK
        # Check if API version supports structured outputs (2024-08-01-preview or later)
        try:
            # Create OpenAI client for Azure
            is_foundry = self._is_foundry_endpoint(used_endpoint)
            if is_foundry:
                client = OpenAI(
                    base_url=f"{used_endpoint.rstrip('/')}/models",
                    api_key=used_api_key,
                    default_query={"api-version": used_api_version},
                )
            else:
                client = OpenAI(
                    base_url=f"{used_endpoint.rstrip('/')}/openai/v1/",
                    api_key=used_api_key,
                )

            # Use provided system message or default
            default_system_message = "You are an expert toxicologist, your job is to take the study below and extract key information as explained in the prompt. For each piece of extracted information, you must provide the exact text excerpt from the markdown that you used as evidence."
            used_system_message = (
                system_message if system_message else default_system_message
            )
            user_message = f"""<markdown study>
{markdown}
</markdown study>

Prompt:
{extraction_prompt}
"""

            print(
                f"[LLMService] Using structured outputs with deployment: {used_deployment}"
            )
            print(f"[LLMService] API version: {used_api_version}")

            # Retry configuration for OpenAI SDK calls
            max_retries = 3
            base_delay = 1.0  # Start with 1 second
            max_delay = 30.0  # Cap at 30 seconds

            completion = None
            duration = None
            last_error = None

            for attempt in range(max_retries):
                try:
                    if attempt > 0:
                        # Calculate exponential backoff with jitter
                        delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
                        jitter = random.uniform(0, 1)
                        total_delay = delay + jitter
                        print(
                            f"[LLMService] Retry attempt {attempt + 1}/{max_retries} after {total_delay:.2f}s delay..."
                        )
                        await asyncio.sleep(total_delay)

                    start_time = time.time()

                    # Use structured outputs with parse method
                    # Note: Structured outputs do not support custom temperature on many
                    # Azure models (gpt-5, gpt-5-mini, o3, etc.), so we omit it here.
                    # Temperature adjustment is only applied to paragraph generation.
                    completion = await asyncio.to_thread(
                        lambda: client.beta.chat.completions.parse(
                            model=used_deployment,
                            messages=[
                                {"role": "system", "content": used_system_message},
                                {"role": "user", "content": user_message},
                            ],
                            response_format=ExtractionResult,
                            max_completion_tokens=max_tokens,
                        )
                    )

                    duration = time.time() - start_time
                    print(f"[LLMService] Request duration: {duration:.2f}s")
                    break  # Success - exit retry loop

                except Exception as e:
                    error_str = str(e).lower()
                    # Check if it's a retryable error (rate limit, server errors)
                    is_rate_limit = (
                        "429" in error_str
                        or "rate limit" in error_str
                        or "rate_limit" in error_str
                        or "quota" in error_str
                        or "too many requests" in error_str
                    )
                    is_server_error = (
                        "500" in error_str
                        or "503" in error_str
                        or "504" in error_str
                        or "internal" in error_str
                        or "unavailable" in error_str
                        or "timeout" in error_str
                    )

                    if (is_rate_limit or is_server_error) and attempt < max_retries - 1:
                        error_type = "rate limit" if is_rate_limit else "server error"
                        print(
                            f"[LLMService] Received {error_type} error, will retry. Error: {str(e)}"
                        )
                        if cb is not None:
                            await cb.record_failure()
                        last_error = str(e)
                        continue
                    else:
                        # Non-retryable error or max retries reached
                        if attempt >= max_retries - 1:
                            print(
                                f"[LLMService] Max retries reached. Final error: {str(e)}"
                            )
                        if cb is not None:
                            await cb.record_failure()
                        raise  # Re-raise to be caught by outer try/except

            # Parse the structured result
            result = completion.choices[0].message.parsed

            # Extract usage information
            usage = completion.usage
            prompt_tokens = usage.prompt_tokens if usage else None
            completion_tokens = usage.completion_tokens if usage else None

            # Build references list
            references = [{"text": ref.text} for ref in result.references]

            if cb is not None:
                await cb.record_success()
            return {
                "success": True,
                "content": result.answer,  # Keep for backward compatibility
                "answer": result.answer,  # New structured field
                "references": references,  # New references field
                "raw": completion.model_dump(),
                "meta": {
                    "timestamp": datetime.utcnow().isoformat(),
                    "deployment": used_deployment,
                    "duration": duration,
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                },
            }

        except Exception as e:
            print(f"[LLMService] Structured output request failed: {e}")
            # Fallback to regular API call if structured outputs fail
            print(f"[LLMService] Falling back to regular API call...")

            # Use provided system message or default for fallback
            default_fallback_message = "You are an expert toxicologist, your job is to take the study below and extract key information as explained in the prompt."
            used_system_message = (
                system_message if system_message else default_fallback_message
            )
            user_message = f"""<markdown study>
{markdown}
</markdown study>

Prompt:
{extraction_prompt}
"""
            messages = [
                {"role": "system", "content": used_system_message},
                {"role": "user", "content": user_message},
            ]

            is_foundry = self._is_foundry_endpoint(used_endpoint)
            if is_foundry:
                url = f"{used_endpoint.rstrip('/')}/models/chat/completions?api-version={used_api_version}"
            else:
                url = f"{used_endpoint.rstrip('/')}/openai/deployments/{used_deployment}/chat/completions?api-version={used_api_version}"

            # Omit temperature for extraction fallback path — structured output
            # models generally reject custom temperature values.
            payload = {
                "messages": messages,
                "max_completion_tokens": max_tokens,
                "n": 1,
                "stop": None,
            }
            # AI Foundry serverless API requires model name in the request body
            if is_foundry:
                payload["model"] = used_deployment

            headers = {"Content-Type": "application/json", "api-key": used_api_key}

            # Retry configuration
            max_retries = 3
            base_delay = 1.0  # Start with 1 second
            max_delay = 30.0  # Cap at 30 seconds
            retryable_status_codes = [
                429,
                500,
                503,
                504,
            ]  # Rate limit and server errors

            last_error = None
            resp = None
            raw = None
            duration = None

            for attempt in range(max_retries):
                try:
                    if attempt > 0:
                        # Calculate exponential backoff with jitter
                        delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
                        jitter = random.uniform(0, 1)
                        total_delay = delay + jitter
                        print(
                            f"[LLMService] Retry attempt {attempt + 1}/{max_retries} after {total_delay:.2f}s delay..."
                        )
                        await asyncio.sleep(total_delay)
                    else:
                        redacted_key = used_api_key
                        if isinstance(redacted_key, str) and len(redacted_key) > 8:
                            redacted_key = redacted_key[:4] + "..." + redacted_key[-4:]
                        redacted_headers = {
                            "Content-Type": headers.get("Content-Type"),
                            "api-key": redacted_key,
                        }
                        print(f"[LLMService] Request URL: {url}")
                        print(f"[LLMService] Headers: {redacted_headers}")
                        try:
                            msg_count = len(messages)
                        except Exception:
                            msg_count = "unknown"
                        print(
                            f"[LLMService] Payload messages: {msg_count}, max_tokens={max_tokens}"
                        )

                    start_time = time.time()
                    resp = await asyncio.to_thread(
                        lambda: requests.post(
                            url, headers=headers, json=payload, timeout=120
                        )
                    )
                    duration = time.time() - start_time
                    print(
                        f"[LLMService] HTTP status: {getattr(resp, 'status_code', 'no-status')}"
                    )
                    print(f"[LLMService] Request duration: {duration:.2f}s")

                    try:
                        raw = resp.json()
                    except Exception:
                        if not resp.ok:
                            return {
                                "success": False,
                                "error": f"Non-JSON response: {resp.text}",
                            }

                    # Check for retryable errors
                    if resp.status_code in retryable_status_codes:
                        error_msg = (
                            raw.get("error", {}).get("message", "")
                            if isinstance(raw, dict)
                            else str(raw)
                        )
                        status_text = {
                            429: "RESOURCE_EXHAUSTED (rate limit)",
                            500: "INTERNAL (server error)",
                            503: "UNAVAILABLE (service overloaded)",
                            504: "DEADLINE_EXCEEDED (timeout)",
                        }.get(resp.status_code, f"HTTP {resp.status_code}")

                        if attempt < max_retries - 1:
                            print(
                                f"[LLMService] Received {status_text}, will retry. Error: {error_msg}"
                            )
                            if cb is not None:
                                await cb.record_failure()
                            last_error = error_msg
                            continue  # Retry
                        else:
                            # Last attempt failed
                            print(
                                f"[LLMService] Max retries reached. Final error: {status_text}"
                            )
                            if cb is not None:
                                await cb.record_failure()
                            err = (
                                raw.get("error") if isinstance(raw, dict) else resp.text
                            )
                            return {"success": False, "error": err, "raw": raw}

                    # Non-retryable error or success
                    if not resp.ok:
                        if cb is not None:
                            await cb.record_failure()
                        err = raw.get("error") if isinstance(raw, dict) else resp.text
                        return {"success": False, "error": err, "raw": raw}

                    # Success - break out of retry loop
                    break

                except requests.exceptions.Timeout as e:
                    if cb is not None:
                        await cb.record_failure()
                    if attempt < max_retries - 1:
                        print(
                            f"[LLMService] Request timeout, will retry. Error: {str(e)}"
                        )
                        last_error = str(e)
                        continue
                    else:
                        print(f"[LLMService] Max retries reached after timeout")
                        return {
                            "success": False,
                            "error": f"Request timeout after {max_retries} attempts: {str(e)}",
                        }

                except requests.exceptions.RequestException as e:
                    if cb is not None:
                        await cb.record_failure()
                    if attempt < max_retries - 1:
                        print(
                            f"[LLMService] Request exception, will retry. Error: {str(e)}"
                        )
                        last_error = str(e)
                        continue
                    else:
                        print(
                            f"[LLMService] Max retries reached after request exception"
                        )
                        return {
                            "success": False,
                            "error": f"Request failed after {max_retries} attempts: {str(e)}",
                        }

                except Exception as req_e:
                    print(f"[LLMService] Request failed with exception: {req_e}")
                    return {"success": False, "error": f"Request failed: {str(req_e)}"}

            # Extract content safely (we should have a successful response at this point)
            if not resp or not raw:
                return {
                    "success": False,
                    "error": "Failed to get valid response after retries",
                }

            try:
                content = (
                    raw.get("choices", [])[0].get("message", {}).get("content", "")
                )
            except Exception:
                content = json.dumps(raw)

            usage = raw.get("usage", {})
            prompt_tokens = usage.get("prompt_tokens")
            completion_tokens = usage.get("completion_tokens")

            if cb is not None:
                await cb.record_success()
            return {
                "success": True,
                "content": content,
                "answer": content,  # For backward compatibility
                "references": [],  # Empty references if fallback used
                "raw": raw,
                "meta": {
                    "timestamp": datetime.utcnow().isoformat(),
                    "deployment": used_deployment,
                    "duration": duration,
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                },
            }
