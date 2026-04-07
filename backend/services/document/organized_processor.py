"""
Organized Document Processor

This module wraps the existing document processors (Azure Doc Intelligence, Docling)
to work with the new organized file structure using hash-based paths.

The key change is:
- Old: output/azure_doc_intelligence/{uuid}/
- New: files/global/{file_hash}/processed/azure_doc_intelligence/
"""

import hashlib
from pathlib import Path
from typing import Dict, Any, Optional
import json
import aiofiles

from services.document.organized_file_service import get_organized_file_service
from services.document.processors.azure_doc_intelligence.azure_doc_intelligence_service import (
    AzureDocIntelligenceService,
)
from services.document.processors.docling.docling_service import DoclingService


class OrganizedDocumentProcessor:
    """
    Document processor that uses the organized file structure.

    This wraps the existing processors and redirects output to the new structure:
    files/global/{file_hash}/processed/{processor}/
    """

    def __init__(self):
        self.file_service = get_organized_file_service()
        self.azure_service = AzureDocIntelligenceService()
        self.docling_service = DoclingService()

    async def process_document(
        self,
        file_path: str,
        processor: str = "azure_doc_intelligence",
        user_id: Optional[str] = None,
        force_reprocess: bool = False,
    ) -> Dict[str, Any]:
        """
        Process a document using the specified processor.

        If the file has already been processed, returns cached results unless force_reprocess=True.

        Args:
            file_path: Path to the file to process
            processor: Processor to use ('azure_doc_intelligence' or 'docling')
            user_id: Optional user ID to associate the file with
            force_reprocess: Force reprocessing even if already done

        Returns:
            Dict with processing results including file_hash, processor_used, and paths
        """
        # Read file and compute hash
        with open(file_path, "rb") as f:
            content = f.read()

        file_hash = self.file_service.compute_file_hash(content)
        filename = Path(file_path).name

        # Save/register the file (handles deduplication)
        file_info = await self.file_service.save_uploaded_file(
            filename=filename, content=content, user_id=user_id, file_hash=file_hash
        )

        # Check if already processed
        if not force_reprocess:
            if await self.file_service.is_file_processed(file_hash, processor):
                # Return cached results
                markdown_content = await self.file_service.get_processed_content(
                    file_hash, processor
                )
                output_path = self.file_service.get_processing_output_path(
                    file_hash, processor
                )

                return {
                    "success": True,
                    "file_hash": file_hash,
                    "processor_used": processor,
                    "cached": True,
                    "output_path": str(output_path),
                    "markdown_content": markdown_content,
                    "metadata": await self._load_metadata(output_path),
                }

        # Get output path for this processor
        output_path = self.file_service.get_processing_output_path(file_hash, processor)

        # Get the original file path
        original_file = await self.file_service.get_original_file_path(file_hash)
        if not original_file:
            return {
                "success": False,
                "error": "Original file not found",
                "file_hash": file_hash,
            }

        # Process with the appropriate service
        if processor == "azure_doc_intelligence":
            result = await self._process_with_azure(str(original_file), output_path)
        else:
            result = await self._process_with_docling(str(original_file), output_path)

        result["file_hash"] = file_hash
        result["cached"] = False
        result["output_path"] = str(output_path)

        # In blob mode, upload the local temp output dir to blob storage
        if result["success"]:
            await self.file_service.sync_processing_output_to_blob(
                file_hash, processor, output_path
            )

        return result

    async def _process_with_azure(
        self, file_path: str, output_path: Path
    ) -> Dict[str, Any]:
        """Process document with Azure Doc Intelligence and save to output_path."""
        try:
            # Use the existing service but we'll move the output
            result = await self.azure_service.convert_document_to_markdown(file_path)

            if not result["success"]:
                return result

            # The existing service saves to its own location
            # We need to copy/move the results to our organized structure
            old_conversion_dir = (
                self.azure_service.output_base_dir / result["conversion_id"]
            )

            # Copy files to new location
            import shutil

            # Copy markdown
            old_md = old_conversion_dir / "document.md"
            new_md = output_path / "document.md"
            if old_md.exists():
                shutil.copy2(old_md, new_md)

            # Copy raw analysis
            old_raw = old_conversion_dir / "raw_analysis.json"
            new_raw = output_path / "raw_analysis.json"
            if old_raw.exists():
                shutil.copy2(old_raw, new_raw)

            # Copy metadata
            old_meta = old_conversion_dir / "metadata.json"
            new_meta = output_path / "metadata.json"
            if old_meta.exists():
                shutil.copy2(old_meta, new_meta)

            # Copy figures directory
            old_figures = old_conversion_dir / "figures"
            new_figures = output_path / "figures"
            if old_figures.exists():
                if new_figures.exists():
                    shutil.rmtree(new_figures)
                shutil.copytree(old_figures, new_figures)

            # Copy tables directory
            old_tables = old_conversion_dir / "tables"
            new_tables = output_path / "tables"
            if old_tables.exists():
                if new_tables.exists():
                    shutil.rmtree(new_tables)
                shutil.copytree(old_tables, new_tables)

            # Read markdown content
            markdown_content = ""
            if new_md.exists():
                async with aiofiles.open(new_md, "r") as f:
                    markdown_content = await f.read()

            return {
                "success": True,
                "processor_used": "azure_doc_intelligence",
                "markdown_content": markdown_content,
                "metadata": result.get("metadata", {}),
                "original_conversion_id": result["conversion_id"],
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "processor_used": "azure_doc_intelligence",
            }

    async def _process_with_docling(
        self, file_path: str, output_path: Path
    ) -> Dict[str, Any]:
        """Process document with Docling and save to output_path."""
        try:
            # Use the existing service
            result = await self.docling_service.convert_document_to_markdown(file_path)

            if not result["success"]:
                return result

            # Copy files to new location
            old_conversion_dir = (
                self.docling_service.output_base_dir / result["conversion_id"]
            )

            import shutil

            # Copy markdown
            old_md = old_conversion_dir / "document.md"
            new_md = output_path / "document.md"
            if old_md.exists():
                shutil.copy2(old_md, new_md)

            # Copy metadata
            old_meta = old_conversion_dir / "metadata.json"
            new_meta = output_path / "metadata.json"
            if old_meta.exists():
                shutil.copy2(old_meta, new_meta)

            # Copy figures directory
            old_figures = old_conversion_dir / "figures"
            new_figures = output_path / "figures"
            if old_figures.exists():
                if new_figures.exists():
                    shutil.rmtree(new_figures)
                shutil.copytree(old_figures, new_figures)

            # Read markdown content
            markdown_content = ""
            if new_md.exists():
                async with aiofiles.open(new_md, "r") as f:
                    markdown_content = await f.read()

            return {
                "success": True,
                "processor_used": "docling",
                "markdown_content": markdown_content,
                "metadata": result.get("metadata", {}),
                "original_conversion_id": result["conversion_id"],
            }

        except Exception as e:
            return {"success": False, "error": str(e), "processor_used": "docling"}

    async def _load_metadata(self, output_path: Path) -> Dict[str, Any]:
        """Load metadata from output path."""
        metadata_path = output_path / "metadata.json"
        if not metadata_path.exists():
            return {}

        try:
            async with aiofiles.open(metadata_path, "r") as f:
                return json.loads(await f.read())
        except:
            return {}

    async def get_processed_markdown(
        self, file_hash: str, processor: str = "azure_doc_intelligence"
    ) -> Optional[str]:
        """Get processed markdown content for a file hash."""
        return await self.file_service.get_processed_content(file_hash, processor)

    async def is_processed(
        self, file_hash: str, processor: str = "azure_doc_intelligence"
    ) -> bool:
        """Check if a file has been processed."""
        return await self.file_service.is_file_processed(file_hash, processor)


# Singleton instance
_organized_processor: Optional[OrganizedDocumentProcessor] = None


def get_organized_processor() -> OrganizedDocumentProcessor:
    """Get or create the organized document processor singleton."""
    global _organized_processor
    if _organized_processor is None:
        _organized_processor = OrganizedDocumentProcessor()
    return _organized_processor
