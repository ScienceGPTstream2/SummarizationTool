"""
VLLM LLM Client — calls a VLLM server via its OpenAI-compatible API.

Configuration via environment variables:
    VLLM_BASE_URL       — e.g. http://vllm-service:8000/v1
    VLLM_API_KEY        — API key (default: "EMPTY" for unauthenticated)
    VLLM_MODELS         — JSON array of model configs (optional), e.g.:
        [{"id": "Qwen/Qwen2.5-72B-Instruct", "name": "Qwen 72B"}]

The VLLM server already exposes GET /v1/models, so the client can
auto-discover available models at startup.
"""

import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

import requests
from pydantic import BaseModel, Field

_log = logging.getLogger(__name__)


# ────────────────────────────────────────────────────────────────────
# Pydantic models (same shape as other LLM clients for consistency)
# ────────────────────────────────────────────────────────────────────


class MarkdownReference(BaseModel):
    text: str = Field(description="Exact text excerpt from the markdown")


class ExtractionResult(BaseModel):
    answer: str = Field(description="Extracted information or answer")
    references: List[MarkdownReference] = Field(
        description="Text excerpts used to generate the answer"
    )


# ────────────────────────────────────────────────────────────────────
# Client
# ────────────────────────────────────────────────────────────────────


class VLLMClient:
    """OpenAI-compatible client for VLLM inference servers."""

    def __init__(self):
        self.base_url = os.environ.get("VLLM_BASE_URL", "").rstrip("/")
        self.api_key = os.environ.get("VLLM_API_KEY", "EMPTY")
        self.disabled = not bool(self.base_url)

        # Optional static model list from env
        self._static_models: List[Dict[str, str]] = []
        models_json = os.environ.get("VLLM_MODELS")
        if models_json:
            try:
                self._static_models = json.loads(models_json)
            except (json.JSONDecodeError, TypeError):
                pass

        if not self.disabled:
            _log.info(f"[VLLMClient] Initialised → {self.base_url}")
        else:
            _log.info("[VLLMClient] Disabled (VLLM_BASE_URL not set)")

    # ----------------------------------------------------------------
    # Model discovery
    # ----------------------------------------------------------------

    async def fetch_available_models(self) -> List[Dict[str, Any]]:
        """
        Query GET /v1/models on the VLLM server and return a list of
        model dicts compatible with the /api/models endpoint format.
        """
        if self.disabled:
            return []

        # If static list is provided, use it
        if self._static_models:
            return [
                {
                    "id": f"vllm-{m.get('id', '')}",
                    "name": m.get("name", m.get("id", "VLLM Model")),
                    "provider": "vllm",
                    "type": "vllm",
                    "model_id": m.get("id", ""),
                }
                for m in self._static_models
            ]

        # Auto-discover from VLLM server
        try:
            resp = requests.get(
                f"{self.base_url}/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=10,
            )
            if resp.status_code != 200:
                _log.warning(
                    f"[VLLMClient] /models returned {resp.status_code}: {resp.text[:200]}"
                )
                return []

            data = resp.json()
            models = data.get("data", [])
            return [
                {
                    "id": f"vllm-{m['id']}",
                    "name": m["id"],
                    "provider": "vllm",
                    "type": "vllm",
                    "model_id": m["id"],
                }
                for m in models
            ]
        except Exception as exc:
            _log.warning(f"[VLLMClient] Failed to fetch models: {exc}")
            return []

    async def check_health(self) -> bool:
        """Check if the VLLM server is reachable."""
        if self.disabled:
            return False
        try:
            resp = requests.get(
                f"{self.base_url}/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=5,
            )
            return resp.status_code == 200
        except Exception:
            return False

    # ----------------------------------------------------------------
    # Chat completion (core)
    # ----------------------------------------------------------------

    async def _call_vllm_api(
        self,
        messages: List[Dict[str, str]],
        model_id: Optional[str] = None,
        max_tokens: int = 4096,
        temperature: float = 0.1,
    ) -> Dict[str, Any]:
        """
        Send a chat completion request to the VLLM server.

        Returns dict with keys: success, content, usage, meta, error.
        """
        if self.disabled:
            return {"success": False, "error": "VLLM is not configured"}

        # If model_id has "vllm-" prefix, strip it
        if model_id and model_id.startswith("vllm-"):
            model_id = model_id[len("vllm-"):]

        # If no model specified, try to use the first available
        if not model_id:
            models = await self.fetch_available_models()
            if models:
                model_id = models[0].get("model_id", "")
            else:
                return {"success": False, "error": "No VLLM models available"}

        payload = {
            "model": model_id,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

        try:
            t0 = time.perf_counter()
            resp = requests.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
                timeout=600,
            )
            duration = time.perf_counter() - t0

            if resp.status_code != 200:
                return {
                    "success": False,
                    "error": f"VLLM API error {resp.status_code}: {resp.text[:500]}",
                }

            data = resp.json()
            choices = data.get("choices", [])
            if not choices:
                return {"success": False, "error": "No choices in VLLM response"}

            content = choices[0].get("message", {}).get("content", "")
            usage = data.get("usage", {})

            return {
                "success": True,
                "content": content,
                "usage": {
                    "prompt_tokens": usage.get("prompt_tokens", 0),
                    "completion_tokens": usage.get("completion_tokens", 0),
                    "total_tokens": usage.get("total_tokens", 0),
                },
                "meta": {
                    "model": model_id,
                    "provider": "vllm",
                    "duration": duration,
                },
            }

        except requests.exceptions.Timeout:
            return {"success": False, "error": f"VLLM request timed out for model {model_id}"}
        except Exception as exc:
            return {"success": False, "error": f"VLLM error: {str(exc)}"}

    # ----------------------------------------------------------------
    # Entity extraction (matches interface of other LLM clients)
    # ----------------------------------------------------------------

    async def extract_entities_with_vllm(
        self,
        markdown: str,
        extraction_prompt: str,
        model_id: Optional[str] = None,
        max_tokens: int = 4096,
        temperature: float = 0.1,
        system_message: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Extract entities from markdown using a VLLM-hosted model.

        Same interface as AzureLLMClient.extract_entities_with_azure(),
        GeminiLLMClient.extract_entities_with_gemini(), etc.
        """
        messages = []
        if system_message:
            messages.append({"role": "system", "content": system_message})

        user_content = f"{extraction_prompt}\n\n---\n\n{markdown}"
        messages.append({"role": "user", "content": user_content})

        result = await self._call_vllm_api(
            messages=messages,
            model_id=model_id,
            max_tokens=max_tokens,
            temperature=temperature,
        )

        if not result["success"]:
            return result

        content = result["content"]
        usage = result["usage"]
        meta = result["meta"]

        return {
            "success": True,
            "extracted_text": content,
            "model": meta.get("model", model_id),
            "meta": {
                "model_name": meta.get("model", model_id),
                "prompt_tokens": usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
                "duration": meta.get("duration", 0),
            },
        }

    # ----------------------------------------------------------------
    # Paragraph generation
    # ----------------------------------------------------------------

    async def generate_paragraph_with_vllm(
        self,
        prompt: str,
        model_id: Optional[str] = None,
        max_tokens: int = 4096,
        temperature: float = 0.3,
        system_message: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate a paragraph using a VLLM-hosted model."""
        messages = []
        if system_message:
            messages.append({"role": "system", "content": system_message})
        messages.append({"role": "user", "content": prompt})

        result = await self._call_vllm_api(
            messages=messages,
            model_id=model_id,
            max_tokens=max_tokens,
            temperature=temperature,
        )

        if not result["success"]:
            return result

        usage = result["usage"]
        meta = result["meta"]

        return {
            "success": True,
            "generated_text": result["content"],
            "model": meta.get("model", model_id),
            "meta": {
                "model_name": meta.get("model", model_id),
                "prompt_tokens": usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
                "duration": meta.get("duration", 0),
            },
        }
