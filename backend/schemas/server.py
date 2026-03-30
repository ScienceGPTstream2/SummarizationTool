"""Schemas for server configuration endpoints"""

from pydantic import BaseModel


class ServerConfig(BaseModel):
    is_azure_openai_configured: bool
    is_gemini_configured: bool = False  # Added for Gemini configuration status
    is_azure_document_intelligence_configured: bool = (
        False  # Added for Azure Document Intelligence configuration status
    )
    is_llama_configured: bool = False  # Added for Llama configuration status
    is_macbook_configured: bool = False  # Added for Macbook configuration status
    is_macbook_healthy: bool = False
    is_ollama_configured: bool = False  # Added for Ollama (Azure-hosted) configuration status
    is_ollama_healthy: bool = False
