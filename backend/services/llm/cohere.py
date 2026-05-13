"""
Cohere LLM Client — calls Cohere Command A via Azure AI Foundry.

Supports two Azure AI endpoint types (auto-detected from the URL):
  - Azure AI Services hub  (*.services.ai.azure.com):
      POST {base}/models/chat/completions?api-version={version}
      Header: api-key: {key}
      Body:   "model": {model_name}
  - Azure AI Serverless    (*.models.ai.azure.com):
      POST {base}/v1/chat/completions
      Header: Authorization: Bearer {key}

Configuration (from secrets.toml [cohere] section, loaded into env vars):
    COHERE_AZURE_ENDPOINT   — base URL of the Azure AI Foundry endpoint
    COHERE_AZURE_KEY        — API key
    COHERE_AZURE_API_VERSION — e.g. "2024-05-01-preview" (hub only)
    COHERE_MODEL_NAME       — deployment/model name, e.g. "cohere-command-a"
"""

import asyncio
import json
import os
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests


class CohereLLMClient:
    def __init__(self):
        raw_endpoint = os.environ.get("COHERE_AZURE_ENDPOINT", "")
        self.api_key = os.environ.get("COHERE_AZURE_KEY", "")
        self.api_version = os.environ.get("COHERE_AZURE_API_VERSION", "2024-05-01-preview")
        self.model_name = os.environ.get("COHERE_MODEL_NAME", "cohere-command-a")

        # Strip path components — always work from the bare host
        parsed = urlparse(raw_endpoint)
        self.endpoint = f"{parsed.scheme}://{parsed.netloc}" if parsed.netloc else raw_endpoint.rstrip("/")

        self.disabled = not bool(self.endpoint and self.api_key)

        self._is_hub = ".services.ai.azure.com" in self.endpoint
        self._is_serverless = ".models.ai.azure.com" in self.endpoint

        if not self.disabled:
            kind = "hub" if self._is_hub else ("serverless" if self._is_serverless else "unknown")
            print(f"[CohereLLMClient] Initialised → {self.endpoint} ({kind})")
        else:
            print("[CohereLLMClient] Disabled (COHERE_AZURE_ENDPOINT or COHERE_AZURE_KEY not set)")

    def _build_url(self) -> str:
        if self._is_hub:
            return f"{self.endpoint}/models/chat/completions?api-version={self.api_version}"
        return f"{self.endpoint}/v1/chat/completions"

    def _build_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._is_hub:
            headers["api-key"] = self.api_key
        else:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def _call_api(
        self,
        messages: List[Dict[str, str]],
        max_tokens: int = 8048,
        temperature: Optional[float] = 0.5,
    ) -> Dict[str, Any]:
        """Core HTTP call with retry logic (3 attempts, exponential backoff)."""
        url = self._build_url()
        headers = self._build_headers()

        payload: Dict[str, Any] = {
            "messages": messages,
            "max_tokens": max_tokens,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if self._is_hub:
            payload["model"] = self.model_name

        max_retries = 3
        base_delay = 1.0
        max_delay = 30.0
        retryable = {429, 500, 503, 504}
        last_error: Optional[str] = None

        for attempt in range(max_retries):
            try:
                t0 = time.perf_counter()
                resp = await asyncio.to_thread(
                    lambda: requests.post(url, json=payload, headers=headers, timeout=120)
                )
                duration = time.perf_counter() - t0

                if resp.status_code == 200:
                    data = resp.json()
                    choices = data.get("choices", [])
                    if not choices:
                        return {"success": False, "error": "No choices in Cohere response"}
                    content = choices[0].get("message", {}).get("content", "")
                    usage = data.get("usage", {})
                    return {
                        "success": True,
                        "content": content,
                        "meta": {
                            "model": self.model_name,
                            "provider": "cohere",
                            "prompt_tokens": usage.get("prompt_tokens", 0),
                            "completion_tokens": usage.get("completion_tokens", 0),
                            "total_tokens": usage.get("total_tokens", 0),
                            "duration": duration,
                        },
                    }

                if resp.status_code in retryable and attempt < max_retries - 1:
                    import random
                    delay = min(base_delay * (2 ** attempt) + random.uniform(0, 1), max_delay)
                    print(f"[CohereLLMClient] HTTP {resp.status_code} on attempt {attempt + 1}, retrying in {delay:.1f}s")
                    time.sleep(delay)
                    continue

                # Non-retryable or last attempt
                try:
                    err_body = resp.json()
                except Exception:
                    err_body = resp.text[:500]
                last_error = f"Azure API error (status {resp.status_code}): {err_body}"
                if resp.status_code == 404:
                    last_error += (
                        f"\n⚠️ Model '{self.model_name}' not found at {self.endpoint}. "
                        "Verify the deployment name and endpoint in secrets.toml."
                    )
                break

            except requests.exceptions.Timeout:
                last_error = f"Cohere request timed out (attempt {attempt + 1})"
                if attempt < max_retries - 1:
                    time.sleep(base_delay * (2 ** attempt))
                    continue
                break
            except Exception as exc:
                last_error = f"Cohere request error: {str(exc)}"
                break

        return {"success": False, "error": last_error or "Unknown error"}

    def _parse_json_content(self, content: str, extraction_prompt: str) -> Dict[str, Any]:
        """
        Parse JSON out of the model's response.
        Tries fence-stripped JSON first, then raw parse, then returns as plain text.
        """
        # Strip markdown fences
        stripped = content.strip()
        if stripped.startswith("```"):
            lines = stripped.split("\n")
            inner = "\n".join(lines[1:-1]) if len(lines) > 2 else stripped
            stripped = inner.strip()

        try:
            parsed = json.loads(stripped)
            return {"success": True, "extracted_text": json.dumps(parsed), "parsed": parsed}
        except json.JSONDecodeError:
            pass

        # Return raw content — downstream can still use it
        return {"success": True, "extracted_text": content, "parsed": None}

    async def extract_entities_with_cohere(
        self,
        markdown: str,
        extraction_prompt: str,
        max_tokens: int = 8048,
        temperature: float = 0.0,
        system_message: Optional[str] = None,
    ) -> Dict[str, Any]:
        if self.disabled:
            return {"success": False, "error": "Cohere is not configured."}

        messages: List[Dict[str, str]] = []
        if system_message:
            messages.append({"role": "system", "content": system_message})
        messages.append({"role": "user", "content": f"{extraction_prompt}\n\n---\n\n{markdown}"})

        result = await self._call_api(messages, max_tokens=max_tokens, temperature=temperature)
        if not result["success"]:
            return result

        content = result["content"]
        meta = result["meta"]
        parsed = self._parse_json_content(content, extraction_prompt)

        return {
            "success": True,
            "content": parsed["extracted_text"],
            "model": self.model_name,
            "meta": {
                "model_name": self.model_name,
                "deployment": self.model_name,
                "prompt_tokens": meta.get("prompt_tokens", 0),
                "completion_tokens": meta.get("completion_tokens", 0),
                "total_tokens": meta.get("total_tokens", 0),
                "duration": meta.get("duration", 0),
            },
        }

    async def generate_paragraph_with_cohere(
        self,
        user_prompt: str,
        max_tokens: int = 2048,
        temperature: Optional[float] = 0.5,
        system_message: Optional[str] = None,
    ) -> Dict[str, Any]:
        if self.disabled:
            return {"success": False, "error": "Cohere is not configured."}

        default_system = (
            "You are a scientific writing assistant. Your task is to synthesize extracted "
            "information into a cohesive, well-structured paragraph while maintaining complete "
            "accuracy. Follow the instructions exactly and preserve all factual details."
        )
        messages: List[Dict[str, str]] = [
            {"role": "system", "content": system_message or default_system},
            {"role": "user", "content": user_prompt},
        ]

        result = await self._call_api(messages, max_tokens=max_tokens, temperature=temperature)
        if not result["success"]:
            return result

        meta = result["meta"]
        return {
            "success": True,
            "content": result["content"],
            "model": self.model_name,
            "meta": {
                "model_name": self.model_name,
                "deployment": self.model_name,
                "prompt_tokens": meta.get("prompt_tokens", 0),
                "completion_tokens": meta.get("completion_tokens", 0),
                "total_tokens": meta.get("total_tokens", 0),
                "duration": meta.get("duration", 0),
            },
        }
