"""Schemas for server configuration endpoints"""

from pydantic import BaseModel


class ServerConfig(BaseModel):
    is_azure_openai_configured: bool
    is_gemini_configured: bool = False # Added for Gemini configuration status
    is_azure_document_intelligence_configured: bool = False # Added for Azure Document Intelligence configuration status
