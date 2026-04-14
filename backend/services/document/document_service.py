"""
Main Document Processing Service

This service orchestrates different document processors (Docling, Azure Document Intelligence, etc.)
and provides a unified interface for document conversion. It can automatically choose the best
processor for a given document or allow explicit processor selection.
"""

import asyncio
from pathlib import Path
from typing import Dict, Any, Optional, List

from schemas.enums import ProcessorType
from .processors.docling import DoclingRemoteClient
from .processors.azure_doc_intelligence.azure_doc_intelligence_service import (
    AzureDocIntelligenceService,
)
from services.document.organized_file_service import get_organized_file_service


class DocumentService:
    """Main service for document processing with multiple processor support"""

    def __init__(self):
        self.docling_service = DoclingRemoteClient()
        self.azure_doc_intelligence_service = AzureDocIntelligenceService()

        self.available_processors = self._check_processor_availability()

    def _check_processor_availability(self) -> Dict[str, bool]:
        """Check which processors are available"""
        return {
            ProcessorType.DOCLING.value: True,
            ProcessorType.AZURE_DOC_INTELLIGENCE.value: self.azure_doc_intelligence_service.is_available(),
        }

    async def convert_document_to_markdown(
        self,
        source: str,
        source_type: str = "file",
        processor: ProcessorType = ProcessorType.AUTO,
        output_dir: Optional[Path] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Convert document to markdown using specified or auto-selected processor

        Args:
            source: File path or URL
            source_type: "file" or "url"
            processor: Which processor to use (auto, docling, azure_doc_intelligence)
            output_dir: Optional output directory. If provided, saves directly here.
            **kwargs: Additional processor-specific arguments

        Returns:
            Dict with conversion results including processor used
        """

        if processor == ProcessorType.AUTO:
            processor = self._auto_select_processor(source, source_type)

        if processor == ProcessorType.AZURE_DOC_INTELLIGENCE:
            if not self.available_processors[
                ProcessorType.AZURE_DOC_INTELLIGENCE.value
            ]:
                processor = ProcessorType.DOCLING
                result = await self.docling_service.convert_document_to_markdown(
                    source, source_type, output_dir=output_dir, **kwargs
                )
                result["processor_used"] = ProcessorType.DOCLING.value
                result["processor_fallback"] = True
                result["fallback_reason"] = "Azure Document Intelligence not available"
            else:
                result = await self.azure_doc_intelligence_service.convert_document_to_markdown(
                    source, source_type, output_dir=output_dir, **kwargs
                )
                result["processor_used"] = ProcessorType.AZURE_DOC_INTELLIGENCE.value

        else:
            result = await self.docling_service.convert_document_to_markdown(
                source, source_type, output_dir=output_dir, **kwargs
            )
            result["processor_used"] = ProcessorType.DOCLING.value

        return result

    def _auto_select_processor(self, source: str, source_type: str) -> ProcessorType:
        """
        Automatically select the best processor for the document

        Logic:
        - Default to Azure Document Intelligence for all documents
        - For specific document types that work better with Docling, use Docling
        - If Azure is not available, fall back to Docling
        """

        if not self.available_processors[ProcessorType.AZURE_DOC_INTELLIGENCE.value]:
            return ProcessorType.DOCLING

        if source_type == "file":
            source_lower = source.lower()

        return ProcessorType.AZURE_DOC_INTELLIGENCE

    async def get_processor_capabilities(self) -> Dict[str, Any]:
        """Get information about available processors and their capabilities"""
        return {
            "available_processors": self.available_processors,
            "processors": {
                ProcessorType.AZURE_DOC_INTELLIGENCE.value: {
                    "name": "Azure Document Intelligence",
                    "description": "Primary processor with superior accuracy for all document types, especially forms, tables, and structured documents",
                    "strengths": [
                        "Table extraction",
                        "Form fields",
                        "Key-value pairs",
                        "Handwriting",
                        "Figure/chart detection",
                        "General documents",
                        "Complex layouts",
                    ],
                    "features": [
                        "Markdown output",
                        "Table extraction",
                        "Figure extraction with captions",
                        "Downloadable figure images",
                        "Bounding regions",
                        "Key-value pairs",
                    ],
                    "available": self.available_processors[
                        ProcessorType.AZURE_DOC_INTELLIGENCE.value
                    ],
                },
                ProcessorType.DOCLING.value: {
                    "name": "Docling",
                    "description": "Fast and reliable fallback processor for general documents when Azure is unavailable",
                    "strengths": [
                        "Academic papers",
                        "Mixed content",
                        "Fast processing",
                        "Always available",
                    ],
                    "available": self.available_processors[ProcessorType.DOCLING.value],
                },
            },
            "auto_selection": {
                "description": "Automatically chooses the best processor based on document characteristics",
                "default_processor": ProcessorType.AZURE_DOC_INTELLIGENCE.value,
                "fallback_processor": ProcessorType.DOCLING.value,
            },
        }

    async def get_conversion_by_id(
        self, conversion_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get conversion info by ID from any processor"""

        # Try OrganizedFileService first (New Structure)
        org_service = get_organized_file_service()
        # get_file_metadata will check the global file path which includes metadata.json
        # However, for conversion specific metadata we might need to check processed output

        # This part requires deeper integration with OrganizedFileService if we want full parity,
        # but for now, assuming conversion_id is file_hash:
        metadata = await org_service.get_file_metadata(conversion_id)
        if metadata:
            return metadata

        return None

    async def get_markdown_content(
        self, conversion_id: str, processor_used: Optional[str] = None
    ) -> Optional[str]:
        """
        Get markdown content by conversion ID from the specific processor that was used

        Args:
            conversion_id: The conversion ID to retrieve content for
            processor_used: The processor that was used (if known) - improves efficiency
        """

        # Try OrganizedFileService first (New Structure)
        # Note: conversion_id is treated as file_hash in the new structure
        org_service = get_organized_file_service()

        if processor_used:
            # Try specific processor
            content = await org_service.get_processed_content(
                conversion_id, processor_used
            )
            if content:
                return content
        else:
            # Try Azure then Docling
            content = await org_service.get_processed_content(
                conversion_id, ProcessorType.AZURE_DOC_INTELLIGENCE
            )
            if content:
                return content

            content = await org_service.get_processed_content(
                conversion_id, ProcessorType.DOCLING
            )
            if content:
                return content

        return None

    async def get_figures_for_conversion(
        self, conversion_id: str
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Get all figures metadata for a specific conversion

        This method works for conversions processed with either Docling or Azure Document Intelligence

        Args:
            conversion_id: The conversion ID

        Returns:
            List of figure metadata dictionaries or None if not found
        """
        # Try OrganizedFileService first
        org_service = get_organized_file_service()

        # Helper to check organized storage for figures
        async def check_organized_figures(processor):
            try:
                path = (
                    org_service.get_processing_output_path(conversion_id, processor)
                    / "metadata.json"
                )
                if path.exists():
                    import json
                    import aiofiles

                    async with aiofiles.open(path, "r") as f:
                        data = json.loads(await f.read())
                        if "figures" in data:
                            return data["figures"]
            except Exception:
                pass
            return None

        # Try Azure then Docling in organized storage
        figures = await check_organized_figures(ProcessorType.AZURE_DOC_INTELLIGENCE)
        if figures is not None:
            return figures

        figures = await check_organized_figures(ProcessorType.DOCLING)
        if figures is not None:
            return figures

        return None

    async def get_raw_analysis_result(
        self, conversion_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get the complete raw analysis result with ALL bounding boxes

        This is available for documents processed with either Azure Document Intelligence or Docling.
        The raw analysis includes all detected elements with their bounding box coordinates:

        Azure DI provides:
        - Pages with words, lines, selection marks
        - Paragraphs with roles and bounding regions
        - Tables with cells and bounding boxes
        - Figures with bounding regions and captions
        - Sections and structural information

        Docling provides:
        - Pages with dimensions
        - Text items (paragraphs) with bounding regions and roles
        - Tables with cells and bounding boxes
        - Pictures/figures with bounding regions
        - Document structure (body, furniture, groups)

        Args:
            conversion_id: The conversion ID

        Returns:
            Complete analysis result dictionary or None if not found
        """
        # Try OrganizedFileService first
        org_service = get_organized_file_service()

        # Helper to check organized storage for raw analysis
        async def check_organized_analysis(processor):
            try:
                # Azure stores as raw_analysis.json, Docling might differ but let's assume raw_analysis.json standard
                path = (
                    org_service.get_processing_output_path(conversion_id, processor)
                    / "raw_analysis.json"
                )
                if path.exists():
                    import json
                    import aiofiles

                    async with aiofiles.open(path, "r", encoding="utf-8") as f:
                        return json.loads(await f.read())
            except Exception:
                pass
            return None

        # Try Azure then Docling in organized storage
        result = await check_organized_analysis(ProcessorType.AZURE_DOC_INTELLIGENCE)
        if result:
            return result

        result = await check_organized_analysis(ProcessorType.DOCLING)
        if result:
            return result

        return None
