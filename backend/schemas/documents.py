"""Schemas for document processing endpoints"""
from pydantic import BaseModel, Field
from typing import Optional

from .enums import ProcessorType

class ProcessFileRequest(BaseModel):
    processor: Optional[ProcessorType] = ProcessorType.AUTO
    extract_figures: bool = Field(
        default=True,
        description="Extract figures/charts from document (Azure Document Intelligence only)"
    )