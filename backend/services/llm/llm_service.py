import os
from typing import Dict, Any, Optional
from .azure import AzureLLMClient
from .gemini import GeminiLLMClient


class LLMService:
    def __init__(self):
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
        temperature: float = 0.0,
        provider: Optional[str] = None,
        gemini_model: Optional[str] = None,
    ) -> Dict[str, Any]:
        if provider == "gemini":
            client = GeminiLLMClient()
            if client.disabled:
                return {"success": False, "error": "Gemini client is not configured."}
            return await client.extract_entities_with_gemini(
                markdown, extraction_prompt, gemini_model
            )
        else:
            client = AzureLLMClient()
            if client.disabled:
                return {"success": False, "error": "Azure client is not configured."}
            return await client.extract_entities_with_azure(
                markdown,
                extraction_prompt,
                deployment,
                api_version,
                endpoint_override,
                api_key_override,
                max_tokens,
                temperature,
            )
