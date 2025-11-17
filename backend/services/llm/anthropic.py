import os
import asyncio
import time
from typing import Dict, Any, Optional
from datetime import datetime
from anthropic import AnthropicVertex


class AnthropicLLMClient:
    def __init__(self):
        # Set the Google Application Credentials environment variable
        credentials_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "core",
            "hcsx-scigpt2-innocentrhino-acm-f87f8026be3d.json",
        )
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path

        self.project_id = "hcsx-scigpt2-innocentrhino-acm"
        self.location = "global"
        self.disabled = False  # Always available since we have the service account

    async def _call_anthropic_api(
        self,
        messages: list,
        model: str,
        max_tokens: int = 1024,
        temperature: float = 0.0,
        system: Optional[str] = None,
    ) -> Dict[str, Any]:
        print(
            f"[LLMService] Anthropic API call starting - Model: {model}, Location: {self.location}"
        )
        print(f"[LLMService] Project ID: {self.project_id}")

        try:
            # Initialize the Anthropic Vertex client
            client = AnthropicVertex(region=self.location, project_id=self.project_id)

            start_time = time.time()
            print(f"[LLMService] Making Anthropic request...")

            # Prepare request parameters
            request_params = {
                "max_tokens": max_tokens,
                "messages": messages,
                "model": model,
            }

            # Add system message if provided
            if system:
                request_params["system"] = system

            # Add temperature if not default
            if temperature != 1.0:  # Anthropic default is 1.0
                request_params["temperature"] = temperature

            # Make the API call
            message = await asyncio.to_thread(
                lambda: client.messages.create(**request_params)
            )

            duration = time.time() - start_time

            print(f"[LLMService] Anthropic response received - Duration: {duration:.2f}s")

            # Extract content from response
            content = ""
            if message.content and len(message.content) > 0:
                content = message.content[0].text

            print(f"[LLMService] Extracted content length: {len(content)}")
            print(f"[LLMService] Content preview: {content[:200]}...")

            # Extract usage information
            usage = message.usage
            input_tokens = usage.input_tokens if usage else None
            output_tokens = usage.output_tokens if usage else None

            return {
                "success": True,
                "content": content,
                "raw": message.model_dump(),
                "meta": {
                    "timestamp": datetime.utcnow().isoformat(),
                    "model": model,
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
        max_tokens: int = 1024,
        temperature: float = 0.0,
    ) -> Dict[str, Any]:
        # Default to Claude Sonnet 4.5
        used_model_id = model_id or "claude-sonnet-4-5@20250929"

        # System message for entity extraction
        system = "You are an expert toxicologist, your job is to take the study below and extract key information as explained in the prompt."

        # User message with markdown and extraction prompt
        user_message = f"""<markdown study>
{markdown}
</markdown study>

Prompt:
{extraction_prompt}
"""

        messages = [{"role": "user", "content": user_message}]

        return await self._call_anthropic_api(
            messages, used_model_id, max_tokens, temperature, system
        )

    async def generate_paragraph_with_anthropic(
        self,
        user_prompt: str,
        model_id: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.0,
    ) -> Dict[str, Any]:
        # Default to Claude Sonnet 4.5
        used_model_id = model_id or "claude-sonnet-4-5@20250929"

        # System message for paragraph generation
        system = "You are a scientific writing assistant. Your task is to synthesize extracted information into a cohesive, well-structured paragraph while maintaining complete accuracy. Follow the instructions exactly and preserve all factual details from the provided entities."

        messages = [{"role": "user", "content": user_prompt}]

        return await self._call_anthropic_api(
            messages, used_model_id, max_tokens, temperature, system
        )
