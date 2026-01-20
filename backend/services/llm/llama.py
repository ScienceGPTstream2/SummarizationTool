import os
import json
import asyncio
import time
import requests
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

# For service account authentication
try:
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request

    GOOGLE_AUTH_AVAILABLE = True
except ImportError:
    GOOGLE_AUTH_AVAILABLE = False


class LlamaLLMClient:
    def __init__(self):
        # Load from environment variables
        self.project_id = os.environ.get("LLAMA_PROJECT_ID") or os.environ.get(
            "GEMINI_PROJECT_ID"
        )
        self.location = os.environ.get("LLAMA_LOCATION", "us-east5")
        self.region = os.environ.get("LLAMA_REGION", "us-east5")

        # Find service account file (same pattern as Gemini)
        self.service_account_path = self._find_service_account_file()

        # Client is disabled if project_id, location, region, or service account is missing
        self.disabled = (
            not self.project_id
            or not self.location
            or not self.region
            or not self.service_account_path
        )

    def _find_service_account_file(self) -> Optional[Path]:
        """Find service account JSON file (same pattern as Gemini)"""
        # Check GOOGLE_APPLICATION_CREDENTIALS env var first
        creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if creds_path and Path(creds_path).exists():
            return Path(creds_path)

        # Try to find in backend/core/ directory (where secrets.toml is)
        try:
            # Try relative to this file
            core_dir = Path(__file__).resolve().parents[1] / "core"
            if core_dir.exists():
                json_files = list(core_dir.glob("*.json"))
                if json_files:
                    return json_files[0]
        except Exception:
            pass

        return None

    def _get_access_token(self, service_account_path: Optional[Path] = None) -> str:
        """Get OAuth2 access token from service account JSON file"""
        if not GOOGLE_AUTH_AVAILABLE:
            raise Exception(
                "google-auth library not installed. Install with: pip install google-auth"
            )

        path = service_account_path or self.service_account_path
        if not path or not path.exists():
            raise Exception(f"Service account file not found: {path}")

        try:
            credentials = service_account.Credentials.from_service_account_file(
                str(path), scopes=["https://www.googleapis.com/auth/cloud-platform"]
            )
            # Refresh the token if needed
            if not credentials.valid:
                credentials.refresh(Request())
            return credentials.token
        except Exception as e:
            raise Exception(f"Failed to get access token: {str(e)}")

    async def _call_llama_api(
        self,
        model_name: str,
        messages: list,
        max_tokens: int = 1024,
        temperature: float = 0.0,
        project_id_override: Optional[str] = None,
        location_override: Optional[str] = None,
        region_override: Optional[str] = None,
        service_account_path_override: Optional[Path] = None,
    ) -> Dict[str, Any]:
        # Use overrides if provided, otherwise fall back to instance variables
        used_project_id = project_id_override or self.project_id
        used_location = location_override or self.location
        used_region = region_override or self.region
        used_service_account_path = (
            service_account_path_override or self.service_account_path
        )

        print(
            f"[LLMService] Llama API call starting - Model: {model_name}, Region: {used_region}"
        )
        print(
            f"[LLMService] Project ID: {used_project_id}, Service Account: {used_service_account_path.name if used_service_account_path else 'NOT FOUND'}"
        )

        if not used_project_id or not used_region or not used_service_account_path:
            print(
                f"[LLMService] Llama disabled - Project ID: {bool(used_project_id)}, Region: {bool(used_region)}, Service Account: {bool(used_service_account_path)}"
            )
            return {
                "success": False,
                "error": "Llama project ID, region, or service account missing.",
            }

        # Get access token from service account
        try:
            access_token = await asyncio.to_thread(
                self._get_access_token, used_service_account_path
            )
        except Exception as e:
            print(f"[LLMService] Failed to authenticate: {e}")
            return {
                "success": False,
                "error": f"Failed to authenticate with service account: {str(e)}",
            }

        # Vertex AI endpoints API endpoint for Llama
        endpoint = f"https://{used_region}-aiplatform.googleapis.com"
        url = f"{endpoint}/v1/projects/{used_project_id}/locations/{used_region}/endpoints/openapi/chat/completions"

        print(f"[LLMService] Using Vertex AI endpoints URL: {url}")

        # Prepare the request payload in OpenAI chat completions format
        payload = {
            "model": model_name,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,  # We'll handle non-streaming for now
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}",
        }

        print(f"[LLMService] Request payload: {json.dumps(payload, indent=2)}")

        # Retry configuration
        max_retries = 5
        base_delay = 1.0  # Start with 1 second
        max_delay = 30.0  # Cap at 30 seconds
        retryable_status_codes = [429, 500, 503, 504]  # Rate limit and server errors

        last_error = None
        raw = None
        duration = None
        resp = None

        for attempt in range(max_retries):
            try:
                start_time = time.time()
                if attempt > 0:
                    # Calculate exponential backoff with jitter
                    delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
                    # Add random jitter (0-1 second) to avoid thundering herd
                    import random

                    jitter = random.uniform(0, 1)
                    total_delay = delay + jitter
                    print(
                        f"[LLMService] Retry attempt {attempt + 1}/{max_retries} after {total_delay:.2f}s delay..."
                    )
                    await asyncio.sleep(total_delay)
                else:
                    print(f"[LLMService] Making HTTP request...")

                resp = await asyncio.to_thread(
                    lambda: requests.post(
                        url, headers=headers, json=payload, timeout=120
                    )
                )
                duration = time.time() - start_time

                print(
                    f"[LLMService] HTTP response received - Status: {resp.status_code}, Duration: {duration:.2f}s"
                )
                print(f"[LLMService] Response headers: {dict(resp.headers)}")
                print(
                    f"[LLMService] Response content length: {len(resp.content) if resp.content else 0}"
                )

                # Check if response is empty or not JSON
                if not resp.content:
                    print(f"[LLMService] Llama returned empty response")
                    return {"success": False, "error": "Empty response from Llama API"}

                print(
                    f"[LLMService] Raw response text: {resp.text[:500]}..."
                )  # First 500 chars

                try:
                    raw = resp.json()
                    print(
                        f"[LLMService] Parsed JSON response: {json.dumps(raw, indent=2)}"
                    )
                except json.JSONDecodeError as je:
                    print(
                        f"[LLMService] Llama JSON decode error: {je}, Response: {resp.text}"
                    )
                    return {
                        "success": False,
                        "error": f"Invalid JSON response: {resp.text[:200]}",
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
                        last_error = error_msg
                        continue  # Retry
                    else:
                        # Last attempt failed
                        print(
                            f"[LLMService] Max retries reached. Final error: {status_text}"
                        )
                        return {
                            "success": False,
                            "error": f"{status_text}: {error_msg}",
                            "raw": raw,
                        }

                # Non-retryable error or success
                if not resp.ok:
                    err = raw.get("error") if isinstance(raw, dict) else resp.text
                    print(f"[LLMService] Llama Error response: {raw}")
                    return {"success": False, "error": err, "raw": raw}

                # Success - break out of retry loop
                break

            except requests.exceptions.Timeout as e:
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

        # Extract content safely (we should have a successful response at this point)
        if not resp or not raw:
            return {
                "success": False,
                "error": "Failed to get valid response after retries",
            }

        try:
            # Extract content from OpenAI-style response
            choices = raw.get("choices", [])
            if not choices:
                print(f"[LLMService] No choices in Llama response: {raw}")
                return {"success": False, "error": "No choices in response"}

            content = choices[0].get("message", {}).get("content", "")
            print(f"[LLMService] Extracted content length: {len(content)}")
            print(f"[LLMService] Content preview: {content[:200]}...")

        except (IndexError, KeyError, TypeError) as e:
            print(f"[LLMService] Llama content extraction error: {e}, Raw: {raw}")
            return {"success": False, "error": f"Unexpected response format: {raw}"}

        result = {
            "success": True,
            "content": content,
            "raw": raw,
            "meta": {
                "timestamp": datetime.utcnow().isoformat(),
                "model": model_name,
                "duration": duration,
            },
        }

        return result

    async def extract_entities_with_llama(
        self,
        markdown: str,
        extraction_prompt: str,
        model_name: Optional[str] = None,
        max_tokens: int = 4096,
        temperature: float = 0.0,
        project_id_override: Optional[str] = None,
        location_override: Optional[str] = None,
        region_override: Optional[str] = None,
        service_account_path_override: Optional[Path] = None,
    ) -> Dict[str, Any]:
        # Default Llama model
        used_model_name = model_name or "meta/llama-4-maverick-17b-128e-instruct-maas"

        # System message for structured extraction
        system_message = "You are an expert toxicologist, your job is to take the study below and extract key information as explained in the prompt. For each piece of extracted information, you must provide the exact text excerpt from the markdown that you used as evidence."

        messages = [
            {"role": "system", "content": system_message},
            {
                "role": "user",
                "content": f"""<markdown study>
{markdown}
</markdown study>

Prompt:
{extraction_prompt}
""",
            },
        ]

        return await self._call_llama_api(
            used_model_name,
            messages,
            max_tokens,
            temperature,
            project_id_override,
            location_override,
            region_override,
            service_account_path_override,
        )

    async def generate_paragraph_with_llama(
        self,
        user_prompt: str,
        model_name: Optional[str] = None,
        max_tokens: int = 4096,
        temperature: float = 0.0,
        project_id_override: Optional[str] = None,
        location_override: Optional[str] = None,
        region_override: Optional[str] = None,
        service_account_path_override: Optional[Path] = None,
    ) -> Dict[str, Any]:
        # Default Llama model
        used_model_name = model_name or "meta/llama-4-maverick-17b-128e-instruct-maas"

        # System message for paragraph generation
        system_message = "You are a scientific writing assistant. Your task is to synthesize extracted information into a cohesive, well-structured paragraph while maintaining complete accuracy. Follow the instructions exactly and preserve all factual details from the provided entities."

        messages = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_prompt},
        ]

        return await self._call_llama_api(
            used_model_name,
            messages,
            max_tokens,
            temperature,
            project_id_override,
            location_override,
            region_override,
            service_account_path_override,
        )
