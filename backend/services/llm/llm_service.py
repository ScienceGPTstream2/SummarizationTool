import os
from typing import Dict, Any, Optional
from .azure import AzureLLMClient
from .gemini import GeminiLLMClient
from .anthropic import AnthropicLLMClient
import toml


# The load_secrets_to_env function is moved to backend/main.py to ensure early loading.
# def load_secrets_to_env(secrets_path: str = "Summarization_tool/backend/core/secrets.toml"):
#     """Loads secrets from a TOML file into environment variables."""
#     try:
#         secrets = toml.load(secrets_path)
#         for section, keys in secrets.items():
#             for key, value in keys.items():
#                 env_key = f"{section.upper()}_{key.upper()}"
#                 os.environ[env_key] = str(value)
#     except FileNotFoundError:
#         print(f"Secrets file not found at {secrets_path}. Skipping loading.")
#     except Exception as e:
#         print(f"Error loading secrets from {secrets_path}: {e}")

# # Load secrets when the module is imported
# load_secrets_to_env()


class LLMService:
    """
    LLM Service for entity extraction and paragraph generation.
    Supports Azure OpenAI and Gemini models.
    """

    def __init__(self):
        self.azure_client = AzureLLMClient()
        self.gemini_client = GeminiLLMClient()
        self.anthropic_client = AnthropicLLMClient()

    async def extract_entities_from_markdown(
        self,
        markdown: str,
        extraction_prompt: str,
        model_type: str,  # e.g., "azure", "gemini"
        model_id: Optional[str] = None,  # for Gemini
        deployment: Optional[str] = None,  # for Azure
        api_version: Optional[str] = None,  # for Azure
        endpoint_override: Optional[str] = None,  # for Azure
        api_key_override: Optional[str] = None,  # for Azure
        gemini_api_key_override: Optional[str] = None,  # for Gemini
        gemini_project_id_override: Optional[str] = None,  # for Gemini
        gemini_location_override: Optional[str] = None,  # for Gemini
        max_tokens: int = 8048,
        temperature: float = 0.0,
        system_message: Optional[str] = None,  # Custom system prompt
    ) -> Dict[str, Any]:
        """
        Extract entities from markdown using the specified LLM.
        """
        if model_type == "azure":
            if self.azure_client.disabled:
                return {"success": False, "error": "Azure OpenAI is not configured."}
            return await self.azure_client.extract_entities_with_azure(
                markdown,
                extraction_prompt,
                deployment,
                api_version,
                endpoint_override,
                api_key_override,
                max_tokens,
                temperature,
                system_message,
            )
        elif model_type == "gemini":
            if self.gemini_client.disabled:
                return {"success": False, "error": "Gemini is not configured."}
            return await self.gemini_client.extract_entities_with_gemini(
                markdown,
                extraction_prompt,
                model_id,
                max_tokens,
                temperature,
                gemini_project_id_override,
                gemini_location_override,
                system_instruction=system_message,
            )
        elif model_type == "anthropic":
            if self.anthropic_client.disabled:
                return {"success": False, "error": "Anthropic is not configured."}
            return await self.anthropic_client.extract_entities_with_anthropic(
                markdown,
                extraction_prompt,
                model_id,
                max_tokens,
                temperature,
            )
        else:
            return {"success": False, "error": f"Unsupported model type: {model_type}"}

    async def generate_paragraph(
        self,
        user_prompt: str,
        model_type: str,  # e.g., "azure", "gemini"
        model_id: Optional[str] = None,  # for Gemini
        deployment: Optional[str] = None,  # for Azure
        api_version: Optional[str] = None,  # for Azure
        endpoint_override: Optional[str] = None,  # for Azure
        api_key_override: Optional[str] = None,  # for Azure
        gemini_api_key_override: Optional[str] = None,  # for Gemini
        gemini_project_id_override: Optional[str] = None,  # for Gemini
        gemini_location_override: Optional[str] = None,  # for Gemini
        max_tokens: int = 8048,
        temperature: float = 0.0,
        system_message: Optional[str] = None,  # Custom system prompt
    ) -> Dict[str, Any]:
        """
        Generate a paragraph using the specified LLM.
        """
        if model_type == "azure":
            if self.azure_client.disabled:
                return {"success": False, "error": "Azure OpenAI is not configured."}
            return await self.azure_client.generate_paragraph_with_azure(
                user_prompt,
                deployment,
                api_version,
                endpoint_override,
                api_key_override,
                max_tokens,
                temperature,
                system_message,
            )
        elif model_type == "gemini":
            if self.gemini_client.disabled:
                return {"success": False, "error": "Gemini is not configured."}
            return await self.gemini_client.generate_paragraph_with_gemini(
                user_prompt,
                model_id,
                max_tokens,
                temperature,
                gemini_project_id_override,
                gemini_location_override,
                system_instruction=system_message,
            )
        elif model_type == "anthropic":
            if self.anthropic_client.disabled:
                return {"success": False, "error": "Anthropic is not configured."}
            return await self.anthropic_client.generate_paragraph_with_anthropic(
                user_prompt,
                model_id,
                max_tokens,
                temperature,
            )
        else:
            return {"success": False, "error": f"Unsupported model type: {model_type}"}
