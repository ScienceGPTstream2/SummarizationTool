"""Schemas for document processing endpoints"""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any

from .enums import ProcessorType


class ProcessFileRequest(BaseModel):
    processor: Optional[ProcessorType] = ProcessorType.AUTO
    extract_figures: bool = Field(
        default=True,
        description="Extract figures/charts from document (Azure Document Intelligence only)",
    )
    batch_number: Optional[int] = Field(
        default=None,
        description="Logical batch identifier (1–99) assigned by the frontend for grouped uploads",
    )


class ExtractFigureContentRequest(BaseModel):
    model_type: str = Field(
        default="gemini",
        description="LLM model type for OCR extraction (gemini, azure)",
    )
    model_id: Optional[str] = Field(
        default=None, description="Specific model ID to use"
    )
    extraction_prompt: str = Field(
        default="Extract all textual content, data points, axis labels, legends, and any other readable information from this scientific figure or chart. Include numerical values, text labels, and describe what the figure represents.",
        description="Prompt instructing the model what to extract",
    )
    max_tokens: int = Field(default=2048, description="Maximum tokens in the response")
    temperature: float = Field(
        default=0.0, description="Sampling temperature for extraction"
    )
    system_message: Optional[str] = Field(
        default=None, description="Custom system message for the model"
    )


class FigureExtractionResult(BaseModel):
    content: str = Field(description="Extracted textual content from the figure")
    model_used: str = Field(description="Model that was used for extraction")
    timestamp: str = Field(description="ISO timestamp of extraction")
    duration: float = Field(description="Processing time in seconds")


class FigureMetadata(BaseModel):
    id: str = Field(description="Figure identifier")
    page: Optional[int] = Field(
        default=None, description="Page number where figure appears"
    )
    caption: Optional[str] = Field(
        default=None, description="Figure caption if available"
    )
    image_path: Optional[str] = Field(
        default=None, description="Path to figure image file"
    )
    bounding_regions: Optional[list] = Field(
        default=None, description="Figure bounding regions"
    )
    extracted_content: Optional[FigureExtractionResult] = Field(
        default=None, description="OCR extraction results if available"
    )
