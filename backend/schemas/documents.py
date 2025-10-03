"""Schemas for document processing endpoints"""
from pydantic import BaseModel
from typing import Optional

from .enums import ProcessorType

class ProcessFileRequest(BaseModel):
    processor: Optional[ProcessorType] = ProcessorType.AUTO