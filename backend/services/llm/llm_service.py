import os
from typing import Dict, Any, Optional
from .azure import AzureLLMClient


class LLMService:
    """
    LLM Service for entity extraction.
    Only supports Azure OpenAI GPT-5 Mini model.
    """

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
    ) -> Dict[str, Any]:
        """
        Extract entities from markdown using Azure OpenAI.
        Only Azure OpenAI is supported in this version.
        """
        client = AzureLLMClient()
        if client.disabled:
            return {"success": False, "error": "Azure OpenAI is not configured."}
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
