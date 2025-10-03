"""Schemas for server configuration endpoints"""
from pydantic import BaseModel

class ServerConfig(BaseModel):
    is_azure_openai_configured: bool