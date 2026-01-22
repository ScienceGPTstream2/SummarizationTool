import os
import asyncio
import time
import json
import requests
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime
from pydantic import BaseModel, Field

# For service account authentication
try:
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request

    GOOGLE_AUTH_AVAILABLE = True
except ImportError:
    GOOGLE_AUTH_AVAILABLE = False


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


class GeminiLLMClient:
    def __init__(self):
        # Load from environment variables or secrets.toml
        # Check both GEMINI_ and VERTEX_AI_ prefixes for compatibility
        self.project_id = (
            os.environ.get("GEMINI_PROJECT_ID") or
            os.environ.get("GEMINI_PROJECT") or
            os.environ.get("VERTEX_AI_PROJECT")
        )
        self.location = (
            os.environ.get("GEMINI_LOCATION") or
            os.environ.get("VERTEX_AI_LOCATION") or
            "us-central1"
        )

        # Find service account file
        self.service_account_path = self._find_service_account_file()

        # Client is disabled if project_id, location, or service account is missing
        self.disabled = (
            not self.project_id or not self.location or not self.service_account_path
        )

    def _find_service_account_file(self) -> Optional[Path]:
        """Find service account JSON file"""
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

    async def _call_gemini_api(
        self,
        model_id: str,
        contents: Dict[str, Any],
        max_tokens: int = 8024,
        temperature: float = 0.0,
        system_instruction: Optional[str] = None,
        project_id_override: Optional[str] = None,
        location_override: Optional[str] = None,
        service_account_path_override: Optional[Path] = None,
        response_json_schema: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        # Use overrides if provided, otherwise fall back to instance variables
        used_project_id = project_id_override or self.project_id
        used_location = location_override or self.location
        used_service_account_path = (
            service_account_path_override or self.service_account_path
        )

        print(
            f"[LLMService] Gemini API call starting - Model: {model_id}, Location: {used_location}"
        )
        print(
            f"[LLMService] Project ID: {used_project_id}, Service Account: {used_service_account_path.name if used_service_account_path else 'NOT FOUND'}"
        )

        if not used_project_id or not used_location or not used_service_account_path:
            print(
                f"[LLMService] Gemini disabled - Project ID: {bool(used_project_id)}, Location: {bool(used_location)}, Service Account: {bool(used_service_account_path)}"
            )
            return {
                "success": False,
                "error": "Gemini project ID, location, or service account missing.",
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

        # Always use aiplatform API with the format from your working example
        # Extract simple model name from full model ID
        if model_id.startswith("publishers/google/models/"):
            simple_model_id = model_id.replace("publishers/google/models/", "")
        else:
            simple_model_id = model_id

        url = (
            f"https://{used_location}-aiplatform.googleapis.com/v1/"
            f"projects/{used_project_id}/locations/{used_location}/publishers/google/models/{simple_model_id}:generateContent"
        )
        print(
            f"[LLMService] Using aiplatform endpoint with model '{simple_model_id}': {url}"
        )

        payload = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        }

        # Add structured outputs if schema provided
        if response_json_schema:
            payload["generationConfig"]["responseMimeType"] = "application/json"
            payload["generationConfig"]["responseJsonSchema"] = response_json_schema

        # Add system instruction if provided
        if system_instruction:
            payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

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
                    print(f"[LLMService] Gemini returned empty response")
                    return {"success": False, "error": "Empty response from Gemini API"}

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
                        f"[LLMService] Gemini JSON decode error: {je}, Response: {resp.text}"
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
                    print(f"[LLMService] Gemini Error response: {raw}")
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
            response_text = (
                raw.get("candidates", [])[0]
                .get("content", {})
                .get("parts", [])[0]
                .get("text", "")
            )

            # If structured output was requested, parse the JSON
            if response_json_schema:
                try:
                    parsed_json = json.loads(response_text)
                    result = ExtractionResult.model_validate(parsed_json)
                    content = result.answer
                    references = [{"text": ref.text} for ref in result.references]
                    print(
                        f"[LLMService] Extracted structured content length: {len(content)}"
                    )
                    print(f"[LLMService] References count: {len(references)}")
                except (json.JSONDecodeError, Exception) as e:
                    print(f"[LLMService] Failed to parse structured output: {e}")
                    print(f"[LLMService] Response text: {response_text[:500]}...")
                    return {
                        "success": False,
                        "error": f"Failed to parse structured output: {str(e)}",
                        "raw": raw,
                    }
            else:
                content = response_text
                references = []
                print(f"[LLMService] Extracted content length: {len(content)}")
                print(f"[LLMService] Content preview: {content[:200]}...")
        except (IndexError, KeyError) as e:
            print(f"[LLMService] Gemini content extraction error: {e}, Raw: {raw}")
            return {"success": False, "error": f"Unexpected response format: {raw}"}

        result = {
            "success": True,
            "content": content,  # Keep for backward compatibility
            "raw": raw,
            "meta": {
                "timestamp": datetime.utcnow().isoformat(),
                "model": model_id,
                "duration": duration,
            },
        }

        # Add structured output fields if available
        if response_json_schema:
            result["answer"] = content
            result["references"] = references

        return result

    async def extract_entities_with_gemini(
        self,
        markdown: str,
        extraction_prompt: str,
        model_id: Optional[str] = None,
        max_tokens: int = 8048,  # Increased default for structured outputs
        temperature: float = 0.0,
        project_id_override: Optional[str] = None,
        location_override: Optional[str] = None,
        service_account_path_override: Optional[Path] = None,
        system_instruction: Optional[str] = None,
    ) -> Dict[str, Any]:
        # Supported models for structured outputs
        gemini_models = [
            "publishers/google/models/gemini-2.5-pro",
            "publishers/google/models/gemini-2.5-flash-lite",
            "publishers/google/models/gemini-2.5-flash",
        ]

        # Handle model ID mapping for simple names (frontend sends full IDs, but support short names too)
        if model_id and not model_id.startswith("publishers/google/models/"):
            # Map simple model names to full Vertex AI model IDs
            model_mapping = {
                "gemini-2.5-pro": "publishers/google/models/gemini-2.5-pro",
                "gemini-2.5-flash": "publishers/google/models/gemini-2.5-flash",
                "gemini-2.5-flash-lite": "publishers/google/models/gemini-2.5-flash-lite",
                "gemini-3-pro-preview": "publishers/google/models/gemini-3-pro-preview",
                "gemini-3-flash-preview": "publishers/google/models/gemini-3-flash-preview",
            }
            model_id = model_mapping.get(model_id, model_id)

        used_model_id = (
            model_id
            if model_id and model_id in gemini_models
            else "publishers/google/models/gemini-2.5-flash"  # Default to flash
        )

        # System instruction for structured extraction - use provided or default
        default_system_instruction = "You are an expert toxicologist, your job is to take the study below and extract key information as explained in the prompt. For each piece of extracted information, you must provide the exact text excerpt from the markdown that you used as evidence."
        used_system_instruction = (
            system_instruction if system_instruction else default_system_instruction
        )

        contents = [
            {
                "role": "user",
                "parts": [
                    {
                        "text": f"""<markdown study>
{markdown}
</markdown study>

Prompt:
{extraction_prompt}
"""
                    }
                ],
            }
        ]

        # Use structured outputs with JSON schema
        return await self._call_gemini_api(
            used_model_id,
            contents,
            max_tokens,
            temperature,
            used_system_instruction,
            project_id_override,
            location_override,
            service_account_path_override,
            response_json_schema=ExtractionResult.model_json_schema(),
        )

    async def generate_paragraph_with_gemini(
        self,
        user_prompt: str,
        model_id: Optional[str] = None,
        max_tokens: int = 8048,
        temperature: float = 0.0,
        project_id_override: Optional[str] = None,
        location_override: Optional[str] = None,
        service_account_path_override: Optional[Path] = None,
        system_instruction: Optional[str] = None,
    ) -> Dict[str, Any]:
        # Supported models
        gemini_models = [
            "publishers/google/models/gemini-2.5-pro",
            "publishers/google/models/gemini-2.5-flash-lite",
            "publishers/google/models/gemini-2.5-flash",
        ]

        # Handle model ID mapping for simple names (frontend sends full IDs, but support short names too)
        if model_id and not model_id.startswith("publishers/google/models/"):
            # Map simple model names to full Vertex AI model IDs
            model_mapping = {
                "gemini-2.5-pro": "publishers/google/models/gemini-2.5-pro",
                "gemini-2.5-flash": "publishers/google/models/gemini-2.5-flash",
                "gemini-2.5-flash-lite": "publishers/google/models/gemini-2.5-flash-lite",
                "gemini-3-pro-preview": "publishers/google/models/gemini-3-pro-preview",
            }
            model_id = model_mapping.get(model_id, model_id)

        used_model_id = (
            model_id
            if model_id and model_id in gemini_models
            else "publishers/google/models/gemini-2.5-flash"  # Default to flash
        )

        # Use provided system instruction or default for paragraph generation
        used_system_instruction = (
            system_instruction
            or "You are a scientific writing assistant. Your task is to synthesize extracted information into a cohesive, well-structured paragraph while maintaining complete accuracy. Follow the instructions exactly and preserve all factual details from the provided entities."
        )

        contents = [{"role": "user", "parts": [{"text": user_prompt}]}]
        return await self._call_gemini_api(
            used_model_id,
            contents,
            max_tokens,
            temperature,
            used_system_instruction,
            project_id_override,
            location_override,
            service_account_path_override,
            response_json_schema=None,  # No structured output for paragraph generation
        )

    async def extract_content_from_image(
        self,
        image_path: str,
        extraction_prompt: str,
        model_id: Optional[str] = None,
        max_tokens: int = 8048,
        temperature: float = 0.0,
        project_id_override: Optional[str] = None,
        location_override: Optional[str] = None,
        service_account_path_override: Optional[Path] = None,
        system_instruction: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Extract content from an image using Gemini vision capabilities.

        Args:
            image_path: Path to the image file
            extraction_prompt: Instructions for what to extract from the image
            model_id: Gemini model ID to use
            max_tokens: Maximum tokens in response
            temperature: Sampling temperature
            project_id_override: Override for project ID
            location_override: Override for location
            service_account_path_override: Override for service account path
            system_instruction: Custom system instruction

        Returns:
            Dict with extraction results
        """
        # Supported vision models
        vision_models = [
            "publishers/google/models/gemini-2.5-pro",
            "publishers/google/models/gemini-2.5-flash",
        ]

        # Handle model ID mapping
        if model_id and not model_id.startswith("publishers/google/models/"):
            model_mapping = {
                "gemini-2.5-pro": "publishers/google/models/gemini-2.5-pro",
                "gemini-2.5-flash": "publishers/google/models/gemini-2.5-flash",
                "gemini-3-pro-preview": "publishers/google/models/gemini-3-pro-preview",
            }
            model_id = model_mapping.get(model_id, model_id)

        used_model_id = (
            model_id
            if model_id and model_id in vision_models
            else "publishers/google/models/gemini-2.5-flash"  # Default to flash for vision
        )

        # Default system instruction for image content extraction
        default_system_instruction = "You are an expert at analyzing scientific figures, charts, and images. Extract all relevant textual information, data points, labels, and content from the provided image. Be precise and comprehensive in your analysis."
        used_system_instruction = (
            system_instruction if system_instruction else default_system_instruction
        )

        # Check if image file exists
        if not Path(image_path).exists():
            return {
                "success": False,
                "error": f"Image file not found: {image_path}",
            }

        try:
            # Read image file and convert to base64
            import base64

            with open(image_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode('utf-8')

            # Determine MIME type from file extension
            file_ext = Path(image_path).suffix.lower()
            mime_type = {
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
            }.get(file_ext, 'image/png')  # Default to PNG

            # Prepare multimodal content
            contents = [
                {
                    "role": "user",
                    "parts": [
                        {
                            "inline_data": {
                                "mime_type": mime_type,
                                "data": image_data
                            }
                        },
                        {
                            "text": f"Please analyze this image and extract the requested information:\n\n{extraction_prompt}"
                        }
                    ],
                }
            ]

            return await self._call_gemini_api(
                used_model_id,
                contents,
                max_tokens,
                temperature,
                used_system_instruction,
                project_id_override,
                location_override,
                service_account_path_override,
                response_json_schema=None,  # Free-form response for image analysis
            )

        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to process image: {str(e)}",
            }
