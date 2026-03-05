"""Schemas for entity extraction endpoints"""

from pydantic import BaseModel
from typing import Optional, List


class Entity(BaseModel):
    name: str
    prompt: str
    extracted: Optional[str] = None
    system_prompt: Optional[str] = None  # Per-entity system prompt
    section: Optional[str] = None  # e.g. "metadata", "methods", "results" — used for batch grouping


class ExtractRequest(BaseModel):
    conversion_id: str
    session_id: Optional[str] = None  # Added for history persistence
    deployment: Optional[str] = None
    entities: List[Entity]
    api_version: Optional[str] = None
    azure_endpoint: Optional[str] = None
    azure_api_key: Optional[str] = None
    gemini_api_key: Optional[str] = None  # Gemini API key
    gemini_project_id: Optional[str] = None  # Gemini project ID
    gemini_location: Optional[str] = None  # Gemini location
    max_tokens: int = 8024
    temperature: float = 0.0
    model_type: Optional[str] = "azure"  # Renamed from provider
    model_id: Optional[str] = None  # For Gemini models
    processor_used: Optional[str] = None
