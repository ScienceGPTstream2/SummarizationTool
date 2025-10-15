"""Schemas for entity extraction endpoints"""

from pydantic import BaseModel
from typing import Optional, List


class Entity(BaseModel):
    name: str
    prompt: str
    extracted: Optional[str] = None


class ExtractRequest(BaseModel):
    conversion_id: str
    deployment: Optional[str] = None
    entities: List[Entity]
    api_version: Optional[str] = None
    azure_endpoint: Optional[str] = None
    azure_api_key: Optional[str] = None
    max_tokens: int = 1024
    temperature: float = 0.0
    provider: Optional[str] = None
    gemini_model: Optional[str] = None
    processor_used: Optional[str] = None
