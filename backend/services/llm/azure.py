import os
import json
import asyncio
import time
from typing import Dict, Any, Optional, List
from datetime import datetime
import requests
from pydantic import BaseModel, Field
from openai import OpenAI


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
        self.disabled = not self.endpoint or not self.api_key

    async def generate_paragraph_with_azure(
        self,
        user_prompt: str,
        deployment: Optional[str] = None,
        api_version: Optional[str] = None,
        endpoint_override: Optional[str] = None,
        api_key_override: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.0,
    ) -> Dict[str, Any]:
        used_endpoint = endpoint_override or self.endpoint
        used_api_key = api_key_override or self.api_key
        if not used_endpoint or not used_api_key:
            return {"success": False, "error": "Azure endpoint or api key missing."}

        system_message = "You are a scientific writing assistant. Your task is to synthesize extracted information into a cohesive, well-structured paragraph while maintaining complete accuracy. Follow the instructions exactly and preserve all factual details from the provided entities."
        messages = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_prompt},
        ]

        used_deployment = (
            deployment or self.default_deployment or self.default_model_name
        )
        if not used_deployment:
            return {"success": False, "error": "Azure deployment name missing."}

        used_api_version = api_version or self.api_version or "2023-05-15"
        url = f"{used_endpoint.rstrip('/')}/openai/deployments/{used_deployment}/chat/completions?api-version={used_api_version}"

        payload = {
            "messages": messages,
            "max_completion_tokens": max_tokens,
            "n": 1,
            "stop": None,
        }

        headers = {"Content-Type": "application/json", "api-key": used_api_key}

        try:
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
                lambda: requests.post(url, headers=headers, json=payload, timeout=120)
            )
            duration = time.time() - start_time
            print(
                f"[LLMService] HTTP status: {getattr(resp, 'status_code', 'no-status')}"
            )
            print(f"[LLMService] Request duration: {duration:.2f}s")

        except Exception as e:
            print(f"[LLMService] Request failed with exception: {e}")
            return {"success": False, "error": f"Request failed: {str(e)}"}

        try:
            raw = resp.json()
        except Exception:
            return {"success": False, "error": f"Non-JSON response: {resp.text}"}

        if not resp.ok:
            err = raw.get("error") if isinstance(raw, dict) else resp.text
            print(f"[LLMService] Error response: {raw}")
            return {"success": False, "error": err, "raw": raw}

        try:
            content = raw.get("choices", [])[0].get("message", {}).get("content", "")
        except Exception:
            content = json.dumps(raw)

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
    ) -> Dict[str, Any]:
        used_endpoint = endpoint_override or self.endpoint
        used_api_key = api_key_override or self.api_key
        if not used_endpoint or not used_api_key:
            return {"success": False, "error": "Azure endpoint or api key missing."}

        used_deployment = (
            deployment or self.default_deployment or self.default_model_name
        )
        if not used_deployment:
            return {"success": False, "error": "Azure deployment name missing."}

        used_api_version = api_version or self.api_version or "2024-08-01-preview"

        # Use structured outputs with OpenAI SDK
        # Check if API version supports structured outputs (2024-08-01-preview or later)
        try:
            # Create OpenAI client for Azure
            client = OpenAI(
                base_url=f"{used_endpoint.rstrip('/')}/openai/v1/", api_key=used_api_key
            )

            system_message = "You are an expert toxicologist, your job is to take the study below and extract key information as explained in the prompt. For each piece of extracted information, you must provide the exact text excerpt from the markdown that you used as evidence."
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

            start_time = time.time()

            # Use structured outputs with parse method
            # Note: GPT-5 Mini doesn't support temperature parameter, only default (1)
            # So we don't pass temperature for structured outputs
            completion = await asyncio.to_thread(
                lambda: client.beta.chat.completions.parse(
                    model=used_deployment,
                    messages=[
                        {"role": "system", "content": system_message},
                        {"role": "user", "content": user_message},
                    ],
                    response_format=ExtractionResult,
                    max_completion_tokens=max_tokens,
                    # temperature parameter not supported for GPT-5 Mini structured outputs
                )
            )

            duration = time.time() - start_time
            print(f"[LLMService] Request duration: {duration:.2f}s")

            # Parse the structured result
            result = completion.choices[0].message.parsed

            # Extract usage information
            usage = completion.usage
            prompt_tokens = usage.prompt_tokens if usage else None
            completion_tokens = usage.completion_tokens if usage else None

            # Build references list
            references = [{"text": ref.text} for ref in result.references]

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

            system_message = "You are an expert toxicologist, your job is to take the study below and extract key information as explained in the prompt."
            user_message = f"""<markdown study>
{markdown}
</markdown study>

Prompt:
{extraction_prompt}
"""
            messages = [
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message},
            ]

            url = f"{used_endpoint.rstrip('/')}/openai/deployments/{used_deployment}/chat/completions?api-version={used_api_version}"

            payload = {
                "messages": messages,
                "max_completion_tokens": max_tokens,
                "n": 1,
                "stop": None,
            }

            headers = {"Content-Type": "application/json", "api-key": used_api_key}

            try:
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

            except Exception as req_e:
                print(f"[LLMService] Request failed with exception: {req_e}")
                return {"success": False, "error": f"Request failed: {str(req_e)}"}

            try:
                raw = resp.json()
            except Exception:
                return {"success": False, "error": f"Non-JSON response: {resp.text}"}

            if not resp.ok:
                err = raw.get("error") if isinstance(raw, dict) else resp.text
                return {"success": False, "error": err, "raw": raw}

            try:
                content = (
                    raw.get("choices", [])[0].get("message", {}).get("content", "")
                )
            except Exception:
                content = json.dumps(raw)

            usage = raw.get("usage", {})
            prompt_tokens = usage.get("prompt_tokens")
            completion_tokens = usage.get("completion_tokens")

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
