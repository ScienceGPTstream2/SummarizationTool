import os
import json
import asyncio
import time
from typing import Dict, Any, List, Optional
from datetime import datetime
import requests

class LLMService:
    """
    Minimal Azure OpenAI integration using the REST API so we don't add new SDK dependencies.
    Expects the following environment variables to be set:
      - AZURE_OPENAI_ENDPOINT (e.g. "https://your-resource-name.openai.azure.com")
      - AZURE_OPENAI_KEY
    Methods are async-friendly (use asyncio.to_thread for the blocking requests calls).
    """

    def __init__(self):
        self.endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")
        self.api_key = os.environ.get("AZURE_OPENAI_KEY")
        # Default API version can be overridden per-request by passing api_version parameter
        self.api_version = os.environ.get("AZURE_OPENAI_API_VERSION", "2023-05-15")
        # Default deployment/model (set from secrets.toml via main.py or direct env)
        self.default_deployment = os.environ.get("AZURE_OPENAI_DEPLOYMENT")
        self.default_model_name = os.environ.get("AZURE_OPENAI_MODEL_NAME")
        if not self.endpoint or not self.api_key:
            # We do not raise here to keep the service importable in environments without configuration,
            # but methods will return helpful errors.
            self.disabled = True
        else:
            self.disabled = False

    async def extract_entities_from_markdown(
        self,
        markdown: str,
        extraction_prompt: str,
        deployment: Optional[str] = None,
        api_version: Optional[str] = None,
        endpoint_override: Optional[str] = None,
        api_key_override: Optional[str] = None,
        max_tokens: int = 1024,
        temperature: float = 0.0
    ) -> Dict[str, Any]:
        """
        Sends a Chat Completions request to an Azure OpenAI deployment.
        Allows per-request overrides for endpoint and api key (less secure; provided by frontend).

        Args:
            markdown: The full study markdown to include in the prompt body.
            extraction_prompt: The extraction instructions / prompt (including few-shot examples).
            deployment: Optional Azure OpenAI deployment name (model deployment). If omitted,
                        the service will fall back to AZURE_OPENAI_DEPLOYMENT / AZURE_OPENAI_MODEL_NAME.
            api_version: Optional api-version query parameter for Azure OpenAI.
            endpoint_override: Optional full Azure endpoint URL provided per-request.
            api_key_override: Optional api key provided per-request.
            max_tokens: Max tokens to request.
            temperature: Sampling temperature.

        Returns:
            Dict with keys: success (bool), content (str), raw (dict)
        """
        # Determine effective credentials (request overrides take precedence)
        used_endpoint = (endpoint_override or self.endpoint) if (endpoint_override or self.endpoint) else None
        used_api_key = (api_key_override or self.api_key) if (api_key_override or self.api_key) else None
        if not used_endpoint or not used_api_key:
            return {"success": False, "error": "Azure endpoint or api key missing. Provide via environment or request overrides."}

        # Build system + user messages as described
        system_message = (
            "You are an expert toxicologist, your job is to take the study below and extract key information as explained in the prompt."
        )

        user_message = f"""<markdown study>
{markdown}
</markdown study>

Prompt:
{extraction_prompt}
"""

        messages = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_message}
        ]

        # Determine deployment to use (request override -> default deployment -> default model name)
        used_deployment = deployment or self.default_deployment or self.default_model_name
        if not used_deployment:
            return {"success": False, "error": "Azure deployment name missing. Provide via request or AZURE_OPENAI_DEPLOYMENT/AZURE_OPENAI_MODEL_NAME environment variables."}

        # Azure OpenAI Chat Completions endpoint (REST)
        # Endpoint format: {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={api_version}
        used_api_version = api_version or self.api_version or "2023-05-15"
        url = f"{used_endpoint.rstrip('/')}/openai/deployments/{used_deployment}/chat/completions?api-version={used_api_version}"

        payload = {
            "messages": messages,
            "max_completion_tokens": max_tokens,
            "n": 1,
            "stop": None,
        }

        headers = {
            "Content-Type": "application/json",
            "api-key": used_api_key
        }

        # Debug logging: print request details to the server console (redacts most of the api-key)
        try:
            redacted_key = used_api_key
            if isinstance(redacted_key, str) and len(redacted_key) > 8:
                redacted_key = redacted_key[:4] + "..." + redacted_key[-4:]
            redacted_headers = {
                "Content-Type": headers.get("Content-Type"),
                "api-key": redacted_key
            }
            print(f"[LLMService] Request URL: {url}")
            print(f"[LLMService] Headers: {redacted_headers}")
            # Print a short summary of the payload (avoid dumping full markdown)
            try:
                msg_count = len(messages)
            except Exception:
                msg_count = 'unknown'
            print(f"[LLMService] Payload messages: {msg_count}, max_tokens={max_tokens}, temperature={temperature}")
            
            # Run blocking requests in a thread so this method can be awaited
            start_time = time.time()
            resp = await asyncio.to_thread(lambda: requests.post(url, headers=headers, json=payload, timeout=120))
            duration = time.time() - start_time
            print(f"[LLMService] HTTP status: {getattr(resp, 'status_code', 'no-status')}")
            print(f"[LLMService] Request duration: {duration:.2f}s")

        except Exception as e:
            print(f"[LLMService] Request failed with exception: {e}")
            return {"success": False, "error": f"Request failed: {str(e)}"}

        try:
            raw = resp.json()
        except Exception:
            return {"success": False, "error": f"Non-JSON response: {resp.text}"}

        if not resp.ok:
            # Try to extract useful error info
            err = raw.get("error") if isinstance(raw, dict) else resp.text
            return {"success": False, "error": err, "raw": raw}

        # Azure returns choices with message content
        try:
            content = raw.get("choices", [])[0].get("message", {}).get("content", "")
        except Exception:
            content = json.dumps(raw)
        
        # Extract token usage
        usage = raw.get("usage", {})
        prompt_tokens = usage.get("prompt_tokens")
        completion_tokens = usage.get("completion_tokens")

        return {
            "success": True,
            "content": content,
            "raw": raw,
            "meta": {
                "timestamp": datetime.utcnow().isoformat(),
                "deployment": used_deployment,
                "duration": duration,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens
            }
        }
