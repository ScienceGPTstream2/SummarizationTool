import os
import json
import asyncio
import time
import requests
from pathlib import Path
from typing import Dict, Any, Optional, List, Union
from datetime import datetime
from pydantic import BaseModel, Field

# For service account authentication
try:
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request

    GOOGLE_AUTH_AVAILABLE = True
except ImportError:
    GOOGLE_AUTH_AVAILABLE = False


# Pydantic models for structured output (adapted for Llama)
class MarkdownReference(BaseModel):
    """A reference to a specific section of the markdown that was used"""

    text: str = Field(
        description="The exact text excerpt from the markdown that was referenced"
    )


class ExtractionResult(BaseModel):
    """Structured result containing both the extracted answer and its references"""

    answer: Union[str, Dict[str, Any], List[Any]] = Field(
        description="The extracted information or answer based on the prompt (string, structured data, or list)"
    )
    references: List[MarkdownReference] = Field(
        description="List of specific text excerpts from the markdown that were used to generate this answer"
    )


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
            core_dir = Path(__file__).resolve().parents[2] / "core"
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
        response_format: Optional[Dict[str, Any]] = None,
        project_id_override: Optional[str] = None,
        location_override: Optional[str] = None,
        region_override: Optional[str] = None,
        service_account_path_override: Optional[Path] = None,
        request_timeout: int = 300,
        max_retries: int = 5,
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

        # Get access token from service account (with explicit timeout to catch VM firewall hangs)
        try:
            _auth_start = time.time()
            access_token = await asyncio.wait_for(
                asyncio.to_thread(self._get_access_token, used_service_account_path),
                timeout=20.0,
            )
            print(f"[LLMService] Token obtained in {time.time() - _auth_start:.2f}s")
        except asyncio.TimeoutError:
            print(
                "[LLMService] CRITICAL: Token fetch timed out after 20s — "
                "VM firewall may be blocking outbound HTTPS to oauth2.googleapis.com"
            )
            return {
                "success": False,
                "error": (
                    "Authentication timed out (20s). Check VM outbound HTTPS access "
                    "to oauth2.googleapis.com (port 443)."
                ),
            }
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

        # Add response format if provided (for JSON mode)
        if response_format:
            payload["response_format"] = response_format

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}",
        }

        print(f"[LLMService] Request payload: {json.dumps(payload, indent=2)}")

        # Retry configuration (max_retries comes from method parameter)
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
                        url,
                        headers=headers,
                        json=payload,
                        timeout=(15, request_timeout),
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
                print(
                    f"[LLMService] RequestException type={type(e).__name__}: {str(e)}"
                )
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
                        "error": f"Request failed ({type(e).__name__}) after {max_retries} attempts: {str(e)}",
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

        _usage = raw.get("usage", {}) if isinstance(raw, dict) else {}
        result = {
            "success": True,
            "content": content,
            "raw": raw,
            "meta": {
                "timestamp": datetime.utcnow().isoformat(),
                "model": model_name,
                "duration": duration,
                "prompt_tokens": _usage.get("prompt_tokens"),
                "completion_tokens": _usage.get("completion_tokens"),
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
        max_input_length: int = 128000,  # Match Llama's actual context window (128K tokens ≈ 96K chars)
        project_id_override: Optional[str] = None,
        location_override: Optional[str] = None,
        region_override: Optional[str] = None,
        service_account_path_override: Optional[Path] = None,
    ) -> Dict[str, Any]:
        # Default Llama model
        used_model_name = model_name or "meta/llama-4-maverick-17b-128e-instruct-maas"

        # Validate that only supported models are used and set correct regions
        model_region_map = {
            "meta/llama-4-maverick-17b-128e-instruct-maas": "us-east5",
            "meta/llama-4-scout-17b-16e-instruct-maas": "us-east5",
            "meta/llama-3.3-70b-instruct-maas": "us-central1",
            "meta/llama-3.1-405b-instruct-maas": "us-central1",
        }

        if used_model_name not in model_region_map:
            return {
                "success": False,
                "error": f"Model '{used_model_name}' is not available in this Vertex AI project. "
                f"Available Llama models: {', '.join(model_region_map.keys())}. "
                f"Llama 4 models work in us-east5, Llama 3.x models work in us-central1.",
            }

        # Override region for this specific model
        region_override = model_region_map[used_model_name]

        # Use structured outputs with JSON mode (similar to Azure but without server-side schema enforcement)
        print(
            f"[LLMService] Using structured outputs with Llama model: {used_model_name} in region: {region_override}"
        )

        # Optimize prompts for Llama to prevent hallucination
        optimized_prompt, optimized_markdown = self._optimize_prompts_for_llama(
            extraction_prompt, markdown, max_input_length
        )

        # Try primary strategy first
        result = await self._try_llama_extraction_strategy(
            optimized_prompt,
            optimized_markdown,
            used_model_name,
            max_tokens,
            temperature,
            project_id_override,
            location_override,
            region_override,
            service_account_path_override,
        )

        # If primary strategy failed with hallucination, try fallback
        if result.get("success") == False and "parsing_error" in result.get("meta", {}):
            print("[LLMService] Primary strategy failed, trying fallback...")
            fallback_result = await self._try_llama_fallback_strategy(
                optimized_prompt,
                optimized_markdown,
                used_model_name,
                max_tokens,
                temperature,
                project_id_override,
                location_override,
                region_override,
                service_account_path_override,
            )
            if fallback_result.get("success"):
                return fallback_result

        return result

    def _optimize_prompts_for_llama(
        self, extraction_prompt: str, markdown: str, max_markdown_length: int = 128000
    ) -> tuple[str, str]:
        """Optimize prompts and content for Llama to prevent hallucination."""

        # Simplify extraction prompt - remove complex few-shot examples that cause issues
        if len(extraction_prompt) > 500:  # If prompt is too long
            # Extract just the core instruction
            lines = extraction_prompt.split("\n")
            core_instruction = ""
            for line in lines:
                if (
                    not line.startswith("Input:")
                    and not line.startswith("Output:")
                    and line.strip()
                ):
                    if "Extract" in line or "extract" in line:
                        core_instruction = line.strip()
                        break
            if not core_instruction:
                core_instruction = (
                    extraction_prompt[:200] + "..."
                )  # Truncate if can't find core
            optimized_prompt = core_instruction
        else:
            optimized_prompt = extraction_prompt

        # Truncate markdown if too long (configurable Llama context limits)
        if len(markdown) > max_markdown_length:
            # Try to truncate at a reasonable boundary
            truncated = markdown[:max_markdown_length]
            # Find last complete sentence or paragraph
            last_period = truncated.rfind(".")
            last_newline = truncated.rfind("\n")
            cutoff = max(last_period, last_newline)
            if cutoff > max_markdown_length * 0.8:  # Only if we can keep most content
                truncated = truncated[: cutoff + 1]
            optimized_markdown = truncated + "\n\n[Content truncated for processing...]"
        else:
            optimized_markdown = markdown

        print(
            f"[LLMService] Optimized prompt length: {len(optimized_prompt)} (was {len(extraction_prompt)})"
        )
        print(
            f"[LLMService] Optimized markdown length: {len(optimized_markdown)} (was {len(markdown)}, limit: {max_markdown_length})"
        )

        return optimized_prompt, optimized_markdown

    async def _try_llama_extraction_strategy(
        self,
        extraction_prompt: str,
        markdown: str,
        model_name: str,
        max_tokens: int,
        temperature: float,
        project_id_override: Optional[str] = None,
        location_override: Optional[str] = None,
        region_override: Optional[str] = None,
        service_account_path_override: Optional[Path] = None,
    ) -> Dict[str, Any]:
        """Try the primary extraction strategy with optimized prompts."""

        # System message for Llama with explicit reference format instructions
        system_message = """You are a data extraction assistant. Extract information and return valid JSON only.

IMPORTANT: For references, provide actual text excerpts from the document that support your answer. Each reference should be a direct quote or specific text span from the document content that contains the information you're referencing.

Response format: {"answer": "extracted info", "references": [{"text": "exact text excerpt from document"}]}"""

        # Simplified user message
        user_message = f"""Task: {extraction_prompt}

Content: {markdown}

Return JSON only:"""

        messages = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_message},
        ]

        # Call with JSON mode and max_tokens matching other models
        safe_max_tokens = min(max_tokens, 8048)  # Match Azure/Gemini limits

        response = await self._call_llama_api(
            model_name,
            messages,
            safe_max_tokens,
            temperature,
            response_format={"type": "json_object"},
            project_id_override=project_id_override,
            location_override=location_override,
            region_override=region_override,
            service_account_path_override=service_account_path_override,
        )

        # Check if API call was successful
        if not response.get("success"):
            return {
                "success": False,
                "error": response.get("error", "Unknown error from Llama API"),
                "content": f"Error: {response.get('error', 'Unknown error')}",
                "answer": f"Error: {response.get('error', 'Unknown error')}",
                "references": [],
                "raw": response.get("raw"),
                "meta": response.get("meta", {}),
            }

        # Parse and validate JSON response
        content = response.get("content", "")
        if not content:
            return {
                "success": False,
                "error": "Empty content from Llama API",
                "content": "Error: Empty response",
                "answer": "Error: Empty response",
                "references": [],
                "raw": response.get("raw"),
                "meta": response.get("meta", {}),
            }

        try:
            parsed_json = json.loads(content.strip())
            result = ExtractionResult.model_validate(parsed_json)

            # Convert answer to string if it's a list or dict for consistency
            answer = result.answer
            if isinstance(answer, (list, dict)):
                answer_str = json.dumps(answer, indent=2, ensure_ascii=False)
            else:
                answer_str = str(answer)

            raw = response.get("raw", {})
            meta = response.get("meta", {})
            return {
                "success": True,
                "content": answer_str,
                "answer": result.answer,  # Keep original for structured access
                "references": [{"text": ref.text} for ref in result.references],
                "raw": raw,
                "meta": {
                    "timestamp": meta.get("timestamp"),
                    "model": model_name,
                    "duration": meta.get("duration"),
                    "prompt_tokens": raw.get("usage", {}).get("prompt_tokens"),
                    "completion_tokens": raw.get("usage", {}).get("completion_tokens"),
                    "strategy": "primary_optimized",
                },
            }

        except (json.JSONDecodeError, Exception) as e:
            print(f"[LLMService] Primary strategy failed: {e}")
            return await self._handle_llama_parsing_error(
                e, content, response, model_name, "primary_optimized"
            )

    async def _try_llama_fallback_strategy(
        self,
        extraction_prompt: str,
        markdown: str,
        model_name: str,
        max_tokens: int,
        temperature: float,
        project_id_override: Optional[str] = None,
        location_override: Optional[str] = None,
        region_override: Optional[str] = None,
        service_account_path_override: Optional[Path] = None,
    ) -> Dict[str, Any]:
        """Fallback strategy with minimal prompting to avoid hallucination."""

        print("[LLMService] Attempting fallback extraction strategy...")

        # Ultra-minimal system message
        system_message = (
            """Return JSON: {"answer": "response", "references": [{"text": "quote"}]}"""
        )

        # Extract just essential content (first 2000 chars)
        essential_markdown = (
            markdown[:2000] + "..." if len(markdown) > 2000 else markdown
        )

        # Simplify prompt to core instruction
        simple_prompt = (
            extraction_prompt.split(".")[0]
            if "." in extraction_prompt
            else extraction_prompt[:100]
        )

        user_message = f"""{simple_prompt}

Text: {essential_markdown}"""

        messages = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_message},
        ]

        # Very conservative token limit
        response = await self._call_llama_api(
            model_name,
            messages,
            1024,  # Very low token limit
            0.0,  # Zero temperature for consistency
            response_format={"type": "json_object"},
            project_id_override=project_id_override,
            location_override=location_override,
            region_override=region_override,
            service_account_path_override=service_account_path_override,
        )

        # Check if API call was successful
        if not response.get("success"):
            return {
                "success": False,
                "error": response.get("error", "Unknown error from Llama API"),
                "content": f"Error: {response.get('error', 'Unknown error')}",
                "answer": f"Error: {response.get('error', 'Unknown error')}",
                "references": [],
                "raw": response.get("raw"),
                "meta": response.get("meta", {}),
            }

        # Parse and validate
        content = response.get("content", "")
        if not content:
            return {
                "success": False,
                "error": "Empty content from Llama API",
                "content": "Error: Empty response",
                "answer": "Error: Empty response",
                "references": [],
                "raw": response.get("raw"),
                "meta": response.get("meta", {}),
            }

        try:
            parsed_json = json.loads(content.strip())
            result = ExtractionResult.model_validate(parsed_json)

            # Convert answer to string if it's a list or dict for consistency
            answer = result.answer
            if isinstance(answer, (list, dict)):
                answer_str = json.dumps(answer, indent=2, ensure_ascii=False)
            else:
                answer_str = str(answer)

            return {
                "success": True,
                "content": answer_str,
                "answer": result.answer,  # Keep original for structured access
                "references": [{"text": ref.text} for ref in result.references],
                "raw": response.get("raw"),
                "meta": {
                    "timestamp": response.get("meta", {}).get("timestamp"),
                    "model": model_name,
                    "duration": response.get("meta", {}).get("duration"),
                    "strategy": "fallback_minimal",
                },
            }

        except (json.JSONDecodeError, Exception) as e:
            print(f"[LLMService] Fallback strategy also failed: {e}")
            return await self._handle_llama_parsing_error(
                e, content, response, model_name, "fallback_minimal"
            )

    async def _handle_llama_parsing_error(
        self,
        error: Exception,
        content: str,
        response: Dict[str, Any],
        model_name: str,
        strategy: str,
    ) -> Dict[str, Any]:
        """Handle JSON parsing errors with enhanced logging and fallback."""

        print(f"[LLMService] Llama {strategy} strategy parsing failed: {error}")
        print(f"[LLMService] Content length: {len(content)}")
        print(f"[LLMService] Content preview: {content[:200]}...")

        # Enhanced logging
        error_log_path = Path(__file__).resolve().parents[1] / "logs" / "llama_errors"
        error_log_path.mkdir(parents=True, exist_ok=True)
        timestamp = int(time.time())

        error_details = {
            "timestamp": timestamp,
            "strategy": strategy,
            "error_type": type(error).__name__,
            "error_message": str(error),
            "model": model_name,
            "content_length": len(content) if content else 0,
            "content_preview": content[:500] if content else "",
            "full_content": content or "",
            "api_response": response.get("raw") if isinstance(response, dict) else None,
        }

        error_file = error_log_path / f"llama_error_{timestamp}_{strategy}.json"
        with open(error_file, "w") as f:
            json.dump(error_details, f, indent=2, default=str)
        print(f"[LLMService] Error logged to: {error_file}")

        # Smart fallback extraction
        fallback_answer = ""
        fallback_references = []

        if not content or not content.strip():
            fallback_answer = "Error: Llama returned empty response"
        elif len(content) < 10:
            fallback_answer = f"Error: Llama returned incomplete response: {content}"
        else:
            # Try to extract any valid JSON fragments
            import re

            json_match = re.search(r"\{.*\}", content, re.DOTALL)
            if json_match:
                try:
                    fragment = json.loads(json_match.group())
                    if "answer" in fragment:
                        fallback_answer = fragment["answer"]
                    if "references" in fragment and isinstance(
                        fragment["references"], list
                    ):
                        fallback_references = fragment["references"]
                except:
                    pass

            if not fallback_answer:
                # Check for repetitive patterns (hallucination detection)
                if "extracted information and references" in content.lower():
                    fallback_answer = "Error: Llama generated repetitive hallucination instead of valid response"
                else:
                    fallback_answer = f"Error: Llama returned malformed response ({len(content)} chars)"

        meta = response.get("meta", {}) if isinstance(response, dict) else {}
        return {
            "success": False,
            "error": f"Llama {strategy} parsing failed: {str(error)}",
            "content": fallback_answer,
            "answer": fallback_answer,
            "references": fallback_references,
            "raw": response.get("raw") if isinstance(response, dict) else None,
            "meta": {
                **meta,
                "parsing_error": str(error),
                "content_length": len(content) if content else 0,
                "error_logged": str(error_file),
                "strategy": strategy,
            },
        }

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
        # Default to available Llama model (only Llama 4 models work in this Vertex AI project)
        used_model_name = model_name or "meta/llama-4-maverick-17b-128e-instruct-maas"

        # Validate that only supported models are used and set correct regions
        model_region_map = {
            "meta/llama-4-maverick-17b-128e-instruct-maas": "us-east5",
            "meta/llama-4-scout-17b-16e-instruct-maas": "us-east5",
            "meta/llama-3.3-70b-instruct-maas": "us-central1",
            "meta/llama-3.1-405b-instruct-maas": "us-central1",
        }

        if used_model_name not in model_region_map:
            return {
                "success": False,
                "error": f"Model '{used_model_name}' is not available in this Vertex AI project. "
                f"Available Llama models: {', '.join(model_region_map.keys())}. "
                f"Llama 4 models work in us-east5, Llama 3.x models work in us-central1.",
            }

        # Override region for this specific model
        region_override = model_region_map[used_model_name]

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
            project_id_override=project_id_override,
            location_override=location_override,
            region_override=region_override,
            service_account_path_override=service_account_path_override,
            request_timeout=300,
        )

    async def warm_up(self) -> None:
        """Send a minimal request to each Llama model region to prevent cold-start timeouts.

        Vertex AI MaaS scales model instances to zero after ~5 minutes of inactivity.
        The first request after idle takes 90-150s+ to cold-start. Sending a tiny
        ping on app startup and every 4 minutes keeps instances warm so real requests
        respond in 2-7s.
        """
        if self.disabled:
            return

        # One ping per unique region — warms all models in that region.
        # Both regions are pinged IN PARALLEL so the total warm-up time is
        # max(us-east5, us-central1) instead of the sum. This prevents a
        # 300s sequential warm-up from causing the first region to go cold
        # again before the second region finishes.
        regions_to_warm = {
            "us-east5": "meta/llama-4-maverick-17b-128e-instruct-maas",
            "us-central1": "meta/llama-3.3-70b-instruct-maas",
        }

        async def _ping(region: str, model: str) -> None:
            try:
                print(f"[LlamaWarmUp] Pinging {model} in {region}...")
                t0 = time.time()
                result = await self._call_llama_api(
                    model_name=model,
                    messages=[{"role": "user", "content": "hi"}],
                    max_tokens=1,
                    temperature=0.0,
                    region_override=region,
                    request_timeout=300,  # Allow full cold-start window
                    max_retries=1,  # Single attempt — bail fast on 300s+ cold starts
                )
                elapsed = time.time() - t0
                if result.get("success"):
                    print(f"[LlamaWarmUp] ✅ {region} warm in {elapsed:.1f}s")
                else:
                    print(
                        f"[LlamaWarmUp] ⚠️  {region} ping failed in {elapsed:.1f}s: {result.get('error')}"
                    )
            except Exception as e:
                print(f"[LlamaWarmUp] ⚠️  {region} ping error: {e}")

        await asyncio.gather(
            *[_ping(region, model) for region, model in regions_to_warm.items()]
        )
