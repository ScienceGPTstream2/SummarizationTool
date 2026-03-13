import os
import json
import asyncio
import time
from pathlib import Path
from utils.text_utils import sanitize_text
from typing import Dict, Any, Optional, Union
from datetime import datetime
from anthropic import AnthropicVertex


class AnthropicLLMClient:
    def __init__(self):
        # Load from environment variables or use defaults
        self.project_id = (
            os.environ.get("ANTHROPIC_PROJECT_ID") or "hcsx-scigpt2-innocentrhino-acm"
        )
        self.location = os.environ.get("ANTHROPIC_LOCATION", "global")

        # Find service account file (same pattern as Gemini)
        self.service_account_path = self._find_service_account_file()

        # Client is disabled if service account is missing
        self.disabled = not self.service_account_path

        # Set the Google Application Credentials environment variable if service account found
        if self.service_account_path:
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(
                self.service_account_path
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

    async def _call_anthropic_api(
        self,
        model_id: str,
        messages: list,
        max_tokens: int = 1024,
        temperature: float = 0.0,
        system: Optional[str] = None,
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
            f"[LLMService] Anthropic API call starting - Model: {model_id}, Location: {used_location}"
        )
        print(
            f"[LLMService] Project ID: {used_project_id}, Service Account: {used_service_account_path.name if used_service_account_path else 'NOT FOUND'}"
        )

        if not used_project_id or not used_location or not used_service_account_path:
            print(
                f"[LLMService] Anthropic disabled - Project ID: {bool(used_project_id)}, Location: {bool(used_location)}, Service Account: {bool(used_service_account_path)}"
            )
            return {
                "success": False,
                "error": "Anthropic project ID, location, or service account missing.",
            }

        # Set GOOGLE_APPLICATION_CREDENTIALS for this request if override provided
        if service_account_path_override:
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(
                used_service_account_path
            )

        try:
            # Initialize the Anthropic Vertex client
            client = AnthropicVertex(region=used_location, project_id=used_project_id)

            start_time = time.time()
            print(f"[LLMService] Making Anthropic request...")

            # Check if structured outputs are requested
            use_structured_outputs = response_json_schema is not None

            if use_structured_outputs:
                # Note: Vertex AI doesn't support structured outputs API feature yet
                # Use prompt engineering to get structured JSON output instead
                print(
                    f"[LLMService] Using prompt-based structured outputs (Vertex AI doesn't support structured outputs API)"
                )
                try:
                    # Generate JSON schema description for the prompt
                    if isinstance(response_json_schema, dict):
                        schema_description = json.dumps(response_json_schema, indent=2)
                    else:
                        raise ValueError(
                            f"response_json_schema must be a dict, got: {type(response_json_schema)}"
                        )

                    # Enhance system message with JSON format instructions
                    json_format_instruction = f"""You must respond with valid JSON that matches this exact schema:

{schema_description}

Important:
- Return ONLY valid JSON, no markdown code blocks, no explanations
- Ensure all required fields are present
- Use the exact field names from the schema
- For the "references" array, each item must have a "text" field with the exact excerpt from the markdown"""

                    enhanced_system = (
                        f"{system}\n\n{json_format_instruction}"
                        if system
                        else json_format_instruction
                    )

                    # Enhance user message to emphasize JSON output
                    enhanced_messages = messages.copy()
                    if enhanced_messages and len(enhanced_messages) > 0:
                        enhanced_messages[-1][
                            "content"
                        ] = f"""{enhanced_messages[-1]["content"]}

IMPORTANT: Respond with valid JSON only, matching the schema above. Do not include markdown code blocks or any other text."""
                    else:
                        enhanced_messages.append(
                            {
                                "role": "user",
                                "content": "IMPORTANT: Respond with valid JSON only, matching the schema above. Do not include markdown code blocks or any other text.",
                            }
                        )

                    # Build request parameters (regular API call, no beta features)
                    request_params = {
                        "model": model_id,
                        "max_tokens": max_tokens,
                        "messages": enhanced_messages,
                    }

                    if enhanced_system:
                        request_params["system"] = enhanced_system

                    if temperature != 1.0:
                        request_params["temperature"] = temperature

                    # Make the API call
                    response = await asyncio.to_thread(
                        lambda: client.messages.create(**request_params)
                    )

                    duration = time.time() - start_time

                    # Extract and parse JSON from response
                    content_text = (
                        response.content[0].text
                        if response.content and len(response.content) > 0
                        else "{}"
                    )

                    # Try to extract JSON from markdown code blocks if present
                    json_text = content_text.strip()
                    if json_text.startswith("```"):
                        # Remove markdown code block markers
                        lines = json_text.split("\n")
                        # Remove first line (```json or ```)
                        if lines[0].startswith("```"):
                            lines = lines[1:]
                        # Remove last line (```)
                        if lines and lines[-1].strip() == "```":
                            lines = lines[:-1]
                        json_text = "\n".join(lines)

                    # Parse JSON
                    try:
                        parsed_json = json.loads(sanitize_text(json_text))
                    except json.JSONDecodeError as e:
                        print(f"[LLMService] JSON parsing failed: {e}")
                        print(f"[LLMService] Response text: {json_text[:500]}")
                        raise ValueError(f"Failed to parse JSON response: {e}")

                    # Extract content and references from parsed JSON
                    content = parsed_json.get("answer", "")
                    references = parsed_json.get("references", [])
                    # Ensure references is a list of dicts with "text" field
                    if references and isinstance(references, list):
                        references = [
                            (
                                {"text": ref["text"]}
                                if isinstance(ref, dict) and "text" in ref
                                else {"text": str(ref)}
                            )
                            for ref in references
                        ]
                    else:
                        references = []

                    print(
                        f"[LLMService] Structured output extracted - Duration: {duration:.2f}s"
                    )
                    print(f"[LLMService] Extracted content length: {len(content)}")
                    print(f"[LLMService] References count: {len(references)}")

                    usage = response.usage
                    input_tokens = usage.input_tokens if usage else None
                    output_tokens = usage.output_tokens if usage else None

                    return {
                        "success": True,
                        "content": content,
                        "answer": content,
                        "references": references,
                        "raw": response.model_dump(),
                        "meta": {
                            "timestamp": datetime.utcnow().isoformat(),
                            "model": model_id,
                            "duration": duration,
                            "prompt_tokens": input_tokens,
                            "completion_tokens": output_tokens,
                        },
                    }
                except Exception as e:
                    print(f"[LLMService] Structured output request failed: {e}")
                    print(f"[LLMService] Exception type: {type(e).__name__}")
                    import traceback

                    print(f"[LLMService] Traceback: {traceback.format_exc()}")
                    # Fallback to regular API call
                    print(f"[LLMService] Falling back to regular API call...")
                    use_structured_outputs = False

            if not use_structured_outputs:
                # Regular API call (no structured outputs)
                request_params = {
                    "max_tokens": max_tokens,
                    "messages": messages,
                    "model": model_id,
                }

                if system:
                    request_params["system"] = system

                if temperature != 1.0:
                    request_params["temperature"] = temperature

                # Make the API call
                message = await asyncio.to_thread(
                    lambda: client.messages.create(**request_params)
                )

                duration = time.time() - start_time

                print(
                    f"[LLMService] Anthropic response received - Duration: {duration:.2f}s"
                )

                # Extract content from response
                content = ""
                if message.content and len(message.content) > 0:
                    content = message.content[0].text

                print(f"[LLMService] Extracted content length: {len(content)}")

                usage = message.usage
                input_tokens = usage.input_tokens if usage else None
                output_tokens = usage.output_tokens if usage else None

                return {
                    "success": True,
                    "content": content,
                    "answer": content,
                    "references": [],
                    "raw": message.model_dump(),
                    "meta": {
                        "timestamp": datetime.utcnow().isoformat(),
                        "model": model_id,
                        "duration": duration,
                        "prompt_tokens": input_tokens,
                        "completion_tokens": output_tokens,
                    },
                }
        except Exception as e:
            print(f"[LLMService] Anthropic request failed with exception: {e}")
            print(f"[LLMService] Exception type: {type(e).__name__}")
            import traceback

            print(f"[LLMService] Traceback: {traceback.format_exc()}")
            return {"success": False, "error": f"Anthropic request failed: {str(e)}"}

    async def extract_entities_with_anthropic(
        self,
        markdown: str,
        extraction_prompt: str,
        model_id: Optional[str] = None,
        max_tokens: int = 4096,  # Increased default for structured outputs
        temperature: float = 0.0,
        project_id_override: Optional[str] = None,
        location_override: Optional[str] = None,
        service_account_path_override: Optional[Path] = None,
    ) -> Dict[str, Any]:
        # Supported models for structured outputs (only Claude Sonnet 4.5 and Claude Opus 4.1)
        # According to Anthropic docs: "Structured outputs are currently available as a public beta
        # feature in the Claude API for Claude Sonnet 4.5 and Claude Opus 4.1."
        supported_models = [
            "claude-sonnet-4-5@20250929",
            "claude-opus-4-1@20250805",
        ]

        # Default to Claude Sonnet 4.5
        used_model_id = model_id or "claude-sonnet-4-5@20250929"

        # System message - updated for structured extraction if supported
        if used_model_id in supported_models:
            system = "You are an expert toxicologist, your job is to take the study below and extract key information as explained in the prompt. For each piece of extracted information, you must provide the exact text excerpt from the markdown that you used as evidence."
        else:
            system = "You are an expert toxicologist, your job is to take the study below and extract key information as explained in the prompt."

        # User message with markdown and extraction prompt
        user_message = f"""<markdown study>
{markdown}
</markdown study>

Prompt:
{extraction_prompt}
"""

        messages = [{"role": "user", "content": user_message}]

        # Use structured outputs only for supported models (Sonnet 4.5 and Opus 4.1)
        # Define JSON schema for structured output
        response_json_schema = (
            {
                "type": "object",
                "properties": {
                    "answer": {
                        "type": "string",
                        "description": "The extracted information or answer based on the prompt",
                    },
                    "references": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {
                                    "type": "string",
                                    "description": "The exact text excerpt from the markdown that was referenced",
                                }
                            },
                            "required": ["text"],
                            "additionalProperties": False,
                        },
                        "description": "List of specific text excerpts from the markdown that were used to generate this answer",
                    },
                },
                "required": ["answer", "references"],
                "additionalProperties": False,
            }
            if used_model_id in supported_models
            else None
        )

        return await self._call_anthropic_api(
            used_model_id,
            messages,
            max_tokens,
            temperature,
            system,
            project_id_override,
            location_override,
            service_account_path_override,
            response_json_schema,
        )

    async def generate_paragraph_with_anthropic(
        self,
        user_prompt: str,
        model_id: Optional[str] = None,
        max_tokens: int = 4096,
        temperature: float = 0.0,
        project_id_override: Optional[str] = None,
        location_override: Optional[str] = None,
        service_account_path_override: Optional[Path] = None,
    ) -> Dict[str, Any]:
        # Default to Claude Sonnet 4.5
        used_model_id = model_id or "claude-sonnet-4-5@20250929"

        # System message for paragraph generation
        system = "You are a scientific writing assistant. Your task is to synthesize extracted information into a cohesive, well-structured paragraph while maintaining complete accuracy. Follow the instructions exactly and preserve all factual details from the provided entities."

        messages = [{"role": "user", "content": user_prompt}]

        return await self._call_anthropic_api(
            used_model_id,
            messages,
            max_tokens,
            temperature,
            system,
            project_id_override,
            location_override,
            service_account_path_override,
            response_json_schema=None,  # No structured output for paragraph generation
        )
