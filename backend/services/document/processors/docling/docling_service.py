import os
import uuid
import aiofiles
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, Union
import json
import asyncio
from concurrent.futures import ThreadPoolExecutor

from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling_core.types.doc import ImageRefMode, PictureItem, TableItem


class DoclingService:
    """
    Service for handling document ingestion and conversion using Docling
    """

    def __init__(
        self,
        markdown_dir: Optional[Union[str, Path]] = None,
        image_resolution_scale: float = 2.0,
    ):
        """
        Initialize the docling service

        Args:
            markdown_dir: Directory where converted markdown files will be stored.
                          If None, defaults to output/docling relative to this file.
            image_resolution_scale: Resolution scale for image extraction (1.0 = 72 DPI, 2.0 = 144 DPI)
        """
        # Base path is 4 levels up from this file (backend/)
        self.base_path = Path(__file__).resolve().parents[4]

        # Unified directory structure: output/docling/{conversion_id}/
        if markdown_dir is None:
            self.output_base_dir = self.base_path / "output" / "docling"
        else:
            self.output_base_dir = Path(markdown_dir)

        # Create base directory if it doesn't exist
        self.output_base_dir.mkdir(parents=True, exist_ok=True)

        # Configure PDF pipeline options for image extraction
        pipeline_options = PdfPipelineOptions()
        pipeline_options.images_scale = image_resolution_scale
        pipeline_options.generate_page_images = True
        pipeline_options.generate_picture_images = True

        # Initialize docling converter with image extraction enabled
        self.converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
            }
        )

        # Thread pool for CPU-intensive tasks
        self.executor = ThreadPoolExecutor(max_workers=2)

    async def convert_document_to_markdown(
        self, source: Union[str, Path], source_type: str = "file", **kwargs
    ) -> Dict[str, Any]:
        """
        Convert a document to markdown using Docling

        Args:
            source: File path or URL to the document
            source_type: Type of source ("file", "url")
            **kwargs: Additional arguments (e.g., extract_figures) - accepted for API compatibility

        Returns:
            Dict containing conversion results and metadata
        """
        try:
            # Generate unique conversion ID
            conversion_id = str(uuid.uuid4())

            # Create conversion-specific directory: output/docling/{conversion_id}/
            conversion_dir = self.output_base_dir / conversion_id
            conversion_dir.mkdir(parents=True, exist_ok=True)

            # Define all file paths within the conversion directory
            log_path = conversion_dir / "conversion.log"
            metadata_path = conversion_dir / "metadata.json"

            # Prepare log file for this conversion
            import logging as _logging

            handler = _logging.FileHandler(str(log_path), mode="w", encoding="utf-8")
            handler.setLevel(_logging.INFO)
            formatter = _logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
            handler.setFormatter(formatter)
            root_logger = _logging.getLogger()
            root_logger.addHandler(handler)
            # Capture warnings into the logging framework (optional)
            _logging.captureWarnings(True)

            # Run the conversion in a thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            try:
                result = await loop.run_in_executor(
                    self.executor, self._convert_document_sync, source
                )
            finally:
                # Remove the temporary handler so subsequent conversions won't write to this file
                try:
                    root_logger.removeHandler(handler)
                    handler.close()
                    _logging.captureWarnings(False)
                except Exception:
                    pass

            # Create safe filename for document
            if source_type == "url":
                base_filename = f"url_document"
            else:
                source_path = Path(source)
                base_filename = source_path.stem

            # Extract images in thread pool
            image_info = await loop.run_in_executor(
                self.executor,
                self._extract_images_sync,
                result,
                conversion_dir,
                base_filename,
            )

            # Save markdown to conversion_dir/document.md
            markdown_filename = "document.md"
            markdown_path = conversion_dir / markdown_filename

            # Save markdown with image references and convert tables to HTML
            await loop.run_in_executor(
                self.executor,
                self._save_markdown_with_html_tables,
                result,
                markdown_path,
            )

            # Extract and save bounding box information from DoclingDocument
            raw_analysis_path = conversion_dir / "raw_analysis.json"
            await loop.run_in_executor(
                self.executor,
                self._extract_bounding_boxes_sync,
                result,
                raw_analysis_path,
            )

            # Read the markdown content for response
            async with aiofiles.open(markdown_path, "r", encoding="utf-8") as f:
                markdown_content = await f.read()

            # Create metadata (include path to log file and image info)
            metadata = {
                "conversion_id": conversion_id,
                "source": str(source),
                "source_type": source_type,
                "processor": "docling",
                "conversion_dir": str(conversion_dir),
                "markdown_filename": markdown_filename,
                "markdown_path": str(markdown_path),
                "log_path": str(log_path),
                "conversion_time": datetime.now().isoformat(),
                "content_length": len(markdown_content),
                "status": "success",
                **image_info,  # Add image extraction info
            }

            # Save metadata to conversion directory
            async with aiofiles.open(metadata_path, "w", encoding="utf-8") as f:
                await f.write(json.dumps(metadata, indent=2))

            return {
                "success": True,
                "conversion_id": conversion_id,
                "markdown_path": str(markdown_path),
                "markdown_content": markdown_content,
                "metadata": metadata,
            }

        except Exception as e:
            # Create error metadata
            conv_id = (
                conversion_id if "conversion_id" in locals() else str(uuid.uuid4())
            )
            error_metadata = {
                "conversion_id": conv_id,
                "source": str(source),
                "source_type": source_type,
                "conversion_time": datetime.now().isoformat(),
                "status": "error",
                "error_message": str(e),
                "conversion_dir": (
                    str(conversion_dir) if "conversion_dir" in locals() else None
                ),
                "log_path": str(log_path) if "log_path" in locals() else None,
            }

            # Save error metadata to conversion directory if it exists
            try:
                if "metadata_path" in locals():
                    async with aiofiles.open(metadata_path, "w", encoding="utf-8") as f:
                        await f.write(json.dumps(error_metadata, indent=2))
            except:
                pass

            return {
                "success": False,
                "error": str(e),
                "conversion_id": error_metadata["conversion_id"],
                "metadata": error_metadata,
            }

    async def start_conversion(
        self, source: Union[str, Path], source_type: str = "file"
    ) -> Dict[str, Any]:
        """
        Start a conversion in the background and return immediately with a conversion_id.
        The conversion runs in the configured thread pool and writes logs and metadata
        to the conversion directory so the frontend can stream logs.
        """
        conversion_id = str(uuid.uuid4())

        # Create conversion-specific directory: output/docling/{conversion_id}/
        conversion_dir = self.output_base_dir / conversion_id
        conversion_dir.mkdir(parents=True, exist_ok=True)

        log_path = conversion_dir / "conversion.log"
        metadata_path = conversion_dir / "metadata.json"

        # initial metadata marking as running
        metadata = {
            "conversion_id": conversion_id,
            "source": str(source),
            "source_type": source_type,
            "processor": "docling",
            "conversion_dir": str(conversion_dir),
            "markdown_filename": None,
            "markdown_path": None,
            "log_path": str(log_path),
            "conversion_time": datetime.now().isoformat(),
            "content_length": 0,
            "status": "running",
        }
        # Save initial metadata to conversion directory
        async with aiofiles.open(metadata_path, "w", encoding="utf-8") as f:
            await f.write(json.dumps(metadata, indent=2))

        # Capture self references for use in executor
        output_base_dir = self.output_base_dir
        convert_sync = self._convert_document_sync
        extract_images_sync = self._extract_images_sync
        extract_bboxes_sync = self._extract_bounding_boxes_sync
        save_markdown_sync = self._save_markdown_with_html_tables

        def _run_and_finalize(conv_id: str, src: Union[str, Path], s_type: str):
            import logging as _logging

            try:
                # Get conversion directory
                conv_dir = output_base_dir / conv_id
                log_path = conv_dir / "conversion.log"
                metadata_path = conv_dir / "metadata.json"

                # Attach file handler to capture logs for this conversion
                handler = _logging.FileHandler(
                    str(log_path), mode="a", encoding="utf-8"
                )
                handler.setLevel(_logging.INFO)
                formatter = _logging.Formatter(
                    "%(asctime)s - %(levelname)s - %(message)s"
                )
                handler.setFormatter(formatter)
                root_logger = _logging.getLogger()
                root_logger.addHandler(handler)
                _logging.captureWarnings(True)

                # Run the actual conversion synchronously (in executor)
                result = convert_sync(src)

                # Determine base filename
                if s_type == "url":
                    base_filename = "url_document"
                else:
                    source_path = Path(src)
                    base_filename = source_path.stem

                # Extract images
                image_info = extract_images_sync(result, conv_dir, base_filename)

                markdown_filename = "document.md"
                markdown_path = conv_dir / markdown_filename

                # Save markdown with image references and convert tables to HTML
                save_markdown_sync(result, markdown_path)

                # Extract and save bounding box information
                raw_analysis_path = conv_dir / "raw_analysis.json"
                extract_bboxes_sync(result, raw_analysis_path)

                # Read markdown content for metadata
                with open(markdown_path, "r", encoding="utf-8") as mf:
                    markdown_content = mf.read()

                # Build final metadata
                final_meta = {
                    "conversion_id": conv_id,
                    "source": str(src),
                    "source_type": s_type,
                    "processor": "docling",
                    "conversion_dir": str(conv_dir),
                    "markdown_filename": markdown_filename,
                    "markdown_path": str(markdown_path),
                    "log_path": str(log_path),
                    "conversion_time": datetime.now().isoformat(),
                    "content_length": len(markdown_content),
                    "status": "success",
                    **image_info,  # Add image extraction info
                }

                # Save metadata to conversion directory
                try:
                    with open(metadata_path, "w", encoding="utf-8") as mf:
                        json.dump(final_meta, mf, indent=2)
                except Exception:
                    # best-effort; if this fails, ignore
                    pass

            except Exception as e:
                # Write error metadata synchronously
                error_meta = {
                    "conversion_id": conv_id,
                    "source": str(src),
                    "source_type": s_type,
                    "conversion_dir": str(conv_dir) if "conv_dir" in locals() else None,
                    "conversion_time": datetime.now().isoformat(),
                    "status": "error",
                    "error_message": str(e),
                    "log_path": str(log_path) if "log_path" in locals() else None,
                }
                # Save error metadata to conversion directory if available
                try:
                    if "metadata_path" in locals():
                        with open(metadata_path, "w", encoding="utf-8") as mf:
                            json.dump(error_meta, mf, indent=2)
                except Exception:
                    pass
            finally:
                # Remove handler
                try:
                    root_logger.removeHandler(handler)
                    handler.close()
                    _logging.captureWarnings(False)
                except Exception:
                    pass

        # Schedule the conversion to run in the executor (background)
        loop = asyncio.get_event_loop()
        loop.run_in_executor(
            self.executor, _run_and_finalize, conversion_id, source, source_type
        )

        return {
            "success": True,
            "conversion_id": conversion_id,
            "markdown_path": None,
            "metadata": metadata,
        }

    def _convert_document_sync(self, source: Union[str, Path]):
        """
        Synchronous document conversion (runs in thread pool)

        Args:
            source: File path or URL to the document

        Returns:
            Docling conversion result
        """
        return self.converter.convert(source)

    def _extract_images_sync(
        self, result, conversion_dir: Path, doc_filename: str
    ) -> Dict[str, Any]:
        """
        Synchronously extract images from conversion result and generate figure metadata

        Args:
            result: Docling conversion result
            conversion_dir: Conversion-specific directory
            doc_filename: Base filename for the document

        Returns:
            Dict containing figure metadata in Azure DI compatible format
        """
        # Create figures directory inside conversion_dir
        figures_dir = conversion_dir / "figures"
        figures_dir.mkdir(parents=True, exist_ok=True)

        figures_metadata = []
        picture_image_count = 0
        table_count = 0

        try:
            # Extract only pictures (not tables) as images
            for element, _level in result.document.iterate_items():
                # Count tables but don't extract as images
                if isinstance(element, TableItem):
                    table_count += 1

                # Extract picture images only
                if isinstance(element, PictureItem):
                    picture_image_count += 1
                    figure_id = f"picture-{picture_image_count}"
                    element_image_filename = figures_dir / f"{figure_id}.png"

                    with element_image_filename.open("wb") as fp:
                        element.get_image(result.document).save(fp, "PNG")

                    # Extract page number and caption if available
                    page_num = None
                    caption = None

                    if hasattr(element, "prov") and element.prov:
                        for prov in element.prov:
                            if hasattr(prov, "page_no"):
                                page_num = prov.page_no
                                break

                    if hasattr(element, "caption"):
                        caption = str(element.caption)

                    figures_metadata.append(
                        {
                            "id": figure_id,
                            "page": page_num,
                            "caption": caption or f"Figure {picture_image_count}",
                            "image_path": f"figures/{figure_id}.png",
                            "type": "picture",
                        }
                    )

        except Exception as e:
            # Log error but don't fail conversion
            import logging

            logging.warning(f"Error extracting images: {str(e)}")

        return {
            "figures_found": len(figures_metadata),
            "figures": figures_metadata,
            "tables_found": table_count,
            "pictures_found": picture_image_count,
        }

    def _save_markdown_with_html_tables(self, result, markdown_path: Path) -> None:
        """
        Save markdown with tables converted to HTML format (matching Azure Doc Intelligence output)
        Also saves individual table HTML files to tables/ directory

        Args:
            result: Docling conversion result
            markdown_path: Path to save the markdown file
        """
        import re

        # Create tables directory
        conversion_dir = markdown_path.parent
        tables_dir = conversion_dir / "tables"
        tables_dir.mkdir(parents=True, exist_ok=True)

        # First, get the standard markdown output
        markdown_content = result.document.export_to_markdown(
            image_mode=ImageRefMode.REFERENCED
        )

        # Extract HTML for each table and save to separate files
        table_html_list = []
        for idx, table in enumerate(result.document.tables, start=1):
            try:
                html_table = table.export_to_html(doc=result.document)
                table_html_list.append(html_table)

                # Save individual table HTML file
                table_html_path = tables_dir / f"table-{idx}.html"
                with open(table_html_path, "w", encoding="utf-8") as f:
                    f.write(html_table)

            except Exception as e:
                import logging

                logging.warning(f"Failed to export table {idx} to HTML: {str(e)}")
                table_html_list.append(None)

        # Replace markdown tables with HTML tables
        # Find all markdown tables in the content
        table_pattern = r"\|[^\n]*\|[\n\r]+\|[-:\s|]+\|[\n\r]+(?:\|[^\n]*\|[\n\r]+)+"

        markdown_tables = list(re.finditer(table_pattern, markdown_content))

        # Replace from end to start to maintain correct positions
        table_idx = 0
        for match in reversed(markdown_tables):
            if table_idx < len(table_html_list) and table_html_list[-(table_idx + 1)]:
                # Replace markdown table with HTML table
                start, end = match.span()
                html_table = table_html_list[-(table_idx + 1)]
                markdown_content = (
                    markdown_content[:start] + html_table + markdown_content[end:]
                )
            table_idx += 1

        # Save the modified markdown
        with open(markdown_path, "w", encoding="utf-8") as f:
            f.write(markdown_content)

    def _extract_bounding_boxes_sync(self, result, raw_analysis_path: Path) -> None:
        """
        Extract bounding box information from DoclingDocument and save to JSON

        This creates a structured representation of the document with all layout information
        including bounding boxes for texts, tables, pictures, and document structure.

        Args:
            result: Docling conversion result
            raw_analysis_path: Path to save the raw analysis JSON
        """
        try:
            doc = result.document

            # Build comprehensive analysis structure
            analysis = {
                "processor": "docling",
                "api_version": "2.0",
                "model_id": "docling-document",
                "pages": [],
                "paragraphs": [],
                "tables": [],
                "figures": [],
                "document_structure": {"body": None, "furniture": None, "groups": []},
            }

            # Try to get markdown content (optional, may fail)
            try:
                analysis["content"] = doc.export_to_markdown()
            except Exception:
                analysis["content"] = ""

            # Extract page information with bounding boxes
            if hasattr(doc, "pages") and doc.pages:
                for page_no, page in doc.pages.items():
                    page_info = {
                        "page_number": page_no,
                        "width": (
                            page.size.width
                            if hasattr(page, "size") and page.size
                            else None
                        ),
                        "height": (
                            page.size.height
                            if hasattr(page, "size") and page.size
                            else None
                        ),
                        "unit": "pt",  # Docling uses points
                        "words": [],
                        "lines": [],
                    }
                    analysis["pages"].append(page_info)

            # Extract text items with bounding boxes
            if hasattr(doc, "texts") and doc.texts:
                import logging

                logging.info(f"[BBOX] Found {len(doc.texts)} text items")

                for idx, text_item in enumerate(doc.texts):
                    paragraph = {
                        "id": f"text_{idx}",
                        "content": text_item.text if hasattr(text_item, "text") else "",
                        "role": (
                            text_item.label
                            if hasattr(text_item, "label")
                            else "paragraph"
                        ),
                        "bounding_regions": [],
                    }

                    # Extract bounding box information from provenance
                    if hasattr(text_item, "prov") and text_item.prov:
                        for prov in text_item.prov:
                            if hasattr(prov, "bbox") and prov.bbox:
                                bbox = prov.bbox
                                bounding_region = {
                                    "page_number": (
                                        prov.page_no
                                        if hasattr(prov, "page_no")
                                        else None
                                    ),
                                    "polygon": [
                                        bbox.l,
                                        bbox.t,  # top-left x, y
                                        bbox.r,
                                        bbox.t,  # top-right x, y
                                        bbox.r,
                                        bbox.b,  # bottom-right x, y
                                        bbox.l,
                                        bbox.b,  # bottom-left x, y
                                    ],
                                }
                                paragraph["bounding_regions"].append(bounding_region)
                    else:
                        # Debug: log when bbox is missing
                        if idx < 5:  # Only log first 5
                            logging.debug(
                                f"[BBOX] Text item {idx} has no prov or prov.bbox"
                            )

                    analysis["paragraphs"].append(paragraph)

                # Log summary
                bbox_count = sum(
                    len(p["bounding_regions"]) for p in analysis["paragraphs"]
                )
                logging.info(
                    f"[BBOX] Extracted {bbox_count} bounding regions from {len(analysis['paragraphs'])} paragraphs"
                )

            # Extract table items with bounding boxes
            if hasattr(doc, "tables") and doc.tables:
                for idx, table_item in enumerate(doc.tables):
                    table = {
                        "id": f"table_{idx}",
                        "row_count": 0,
                        "column_count": 0,
                        "cells": [],
                        "bounding_regions": [],
                    }

                    # Extract table structure if available
                    if hasattr(table_item, "data") and table_item.data:
                        table["row_count"] = (
                            len(table_item.data.table_cells)
                            if hasattr(table_item.data, "table_cells")
                            else 0
                        )

                        # Extract cells with positions
                        if hasattr(table_item.data, "table_cells"):
                            for cell in table_item.data.table_cells:
                                cell_info = {
                                    "row_index": (
                                        cell.row_index
                                        if hasattr(cell, "row_index")
                                        else 0
                                    ),
                                    "column_index": (
                                        cell.col_index
                                        if hasattr(cell, "col_index")
                                        else 0
                                    ),
                                    "row_span": (
                                        cell.row_span
                                        if hasattr(cell, "row_span")
                                        else 1
                                    ),
                                    "column_span": (
                                        cell.col_span
                                        if hasattr(cell, "col_span")
                                        else 1
                                    ),
                                    "content": (
                                        cell.text if hasattr(cell, "text") else ""
                                    ),
                                    "kind": "content",
                                }
                                table["cells"].append(cell_info)

                    # Extract bounding box from provenance
                    if hasattr(table_item, "prov") and table_item.prov:
                        for prov in table_item.prov:
                            if hasattr(prov, "bbox") and prov.bbox:
                                bbox = prov.bbox
                                bounding_region = {
                                    "page_number": (
                                        prov.page_no
                                        if hasattr(prov, "page_no")
                                        else None
                                    ),
                                    "polygon": [
                                        bbox.l,
                                        bbox.t,
                                        bbox.r,
                                        bbox.t,
                                        bbox.r,
                                        bbox.b,
                                        bbox.l,
                                        bbox.b,
                                    ],
                                }
                                table["bounding_regions"].append(bounding_region)

                    analysis["tables"].append(table)

            # Extract picture items with bounding boxes
            if hasattr(doc, "pictures") and doc.pictures:
                for idx, picture_item in enumerate(doc.pictures):
                    figure = {
                        "id": f"picture_{idx}",
                        "caption": {
                            "content": (
                                str(picture_item.caption)
                                if hasattr(picture_item, "caption")
                                and picture_item.caption
                                else None
                            )
                        },
                        "bounding_regions": [],
                    }

                    # Extract bounding box from provenance
                    if hasattr(picture_item, "prov") and picture_item.prov:
                        for prov in picture_item.prov:
                            if hasattr(prov, "bbox") and prov.bbox:
                                bbox = prov.bbox
                                bounding_region = {
                                    "page_number": (
                                        prov.page_no
                                        if hasattr(prov, "page_no")
                                        else None
                                    ),
                                    "polygon": [
                                        bbox.l,
                                        bbox.t,
                                        bbox.r,
                                        bbox.t,
                                        bbox.r,
                                        bbox.b,
                                        bbox.l,
                                        bbox.b,
                                    ],
                                }
                                figure["bounding_regions"].append(bounding_region)

                    analysis["figures"].append(figure)

            # Extract document structure (body, furniture, groups)
            if hasattr(doc, "body") and doc.body:
                analysis["document_structure"]["body"] = self._serialize_node_item(
                    doc.body
                )

            if hasattr(doc, "furniture") and doc.furniture:
                analysis["document_structure"]["furniture"] = self._serialize_node_item(
                    doc.furniture
                )

            if hasattr(doc, "groups") and doc.groups:
                for group in doc.groups:
                    analysis["document_structure"]["groups"].append(
                        self._serialize_node_item(group)
                    )

            # Save to JSON file
            with open(raw_analysis_path, "w", encoding="utf-8") as f:
                json.dump(analysis, f, indent=2, ensure_ascii=False)

        except Exception as e:
            import logging
            import traceback

            error_trace = traceback.format_exc()
            logging.error(f"Error extracting bounding boxes: {str(e)}\n{error_trace}")
            # Create minimal analysis structure on error
            analysis = {
                "processor": "docling",
                "error": str(e),
                "error_trace": error_trace,
                "pages": [],
                "paragraphs": [],
                "tables": [],
                "figures": [],
            }
            with open(raw_analysis_path, "w", encoding="utf-8") as f:
                json.dump(analysis, f, indent=2)

    def _serialize_node_item(self, node) -> Optional[Dict[str, Any]]:
        """
        Serialize a NodeItem to a dictionary

        Args:
            node: NodeItem from DoclingDocument

        Returns:
            Dictionary representation of the node
        """
        if not node:
            return None

        # Convert RefItem objects to strings for JSON serialization
        def to_string(obj):
            """Convert RefItem or any object to string"""
            if obj is None:
                return None
            return str(obj)

        def to_string_list(items):
            """Convert list of RefItems to list of strings"""
            if not items:
                return []
            return [str(item) for item in items]

        return {
            "label": to_string(node.label) if hasattr(node, "label") else None,
            "self_ref": to_string(node.self_ref) if hasattr(node, "self_ref") else None,
            "parent": to_string(node.parent) if hasattr(node, "parent") else None,
            "children": (
                to_string_list(node.children) if hasattr(node, "children") else []
            ),
        }

    async def get_conversion_by_id(
        self, conversion_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get conversion information by conversion ID

        Args:
            conversion_id: Unique conversion identifier

        Returns:
            Dict containing conversion information or None if not found
        """
        return await self._load_conversion_metadata(conversion_id)

    async def get_markdown_content(self, conversion_id: str) -> Optional[str]:
        """
        Get markdown content by conversion ID

        Args:
            conversion_id: Unique conversion identifier

        Returns:
            Markdown content as string or None if not found
        """
        markdown_path = self.output_base_dir / conversion_id / "document.md"

        if not markdown_path.exists():
            return None

        try:
            async with aiofiles.open(markdown_path, "r", encoding="utf-8") as f:
                return await f.read()
        except (IOError, UnicodeDecodeError):
            return None

    async def list_conversions(self) -> list[Dict[str, Any]]:
        """
        List all document conversions

        Returns:
            List of conversion metadata dictionaries
        """
        conversions = []
        # Iterate through conversion directories
        for conv_dir in self.output_base_dir.iterdir():
            if conv_dir.is_dir():
                conversion_id = conv_dir.name
                metadata = await self._load_conversion_metadata(conversion_id)
                if metadata:
                    conversions.append(metadata)

        return sorted(conversions, key=lambda x: x["conversion_time"], reverse=True)

    async def delete_conversion(self, conversion_id: str) -> bool:
        """
        Delete a conversion and its associated files

        Args:
            conversion_id: Unique conversion identifier

        Returns:
            bool: True if conversion was deleted, False if not found
        """
        # Check if conversion directory exists
        conversion_dir = self.output_base_dir / conversion_id
        if not conversion_dir.exists():
            return False

        import shutil

        # Delete entire conversion directory (contains markdown, figures, metadata, and logs)
        try:
            shutil.rmtree(conversion_dir)
            return True
        except Exception:
            return False

    async def get_figures_for_conversion(
        self, conversion_id: str
    ) -> Optional[list[Dict[str, Any]]]:
        """
        Get all figures metadata for a specific conversion

        Args:
            conversion_id: The conversion ID

        Returns:
            List of figure metadata dictionaries or None if not found
        """
        metadata = await self._load_conversion_metadata(conversion_id)
        if metadata and "figures" in metadata:
            return metadata["figures"]
        return None

    async def get_raw_analysis_result(
        self, conversion_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get the complete raw analysis result with ALL bounding boxes from Docling

        This includes:
        - All pages with dimensions
        - All text items (paragraphs) with bounding regions and roles
        - All tables with cells and bounding boxes
        - All pictures/figures with bounding regions
        - Document structure (body, furniture, groups)

        Args:
            conversion_id: The conversion ID

        Returns:
            Complete analysis result dictionary or None if not found
        """
        raw_analysis_path = self.output_base_dir / conversion_id / "raw_analysis.json"

        if not raw_analysis_path.exists():
            return None

        try:
            async with aiofiles.open(raw_analysis_path, "r", encoding="utf-8") as f:
                content = await f.read()
                return json.loads(content)
        except (json.JSONDecodeError, IOError):
            return None

    async def _save_conversion_metadata(
        self, conversion_id: str, metadata: Dict[str, Any]
    ):
        """
        Save conversion metadata to JSON file in the conversion directory

        Args:
            conversion_id: Unique conversion identifier
            metadata: Metadata dictionary
        """
        metadata_path = self.output_base_dir / conversion_id / "metadata.json"
        async with aiofiles.open(metadata_path, "w", encoding="utf-8") as f:
            await f.write(json.dumps(metadata, indent=2))

    async def _load_conversion_metadata(
        self, conversion_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Load conversion metadata from JSON file in the conversion directory

        Args:
            conversion_id: Unique conversion identifier

        Returns:
            Metadata dictionary or None if not found
        """
        metadata_path = self.output_base_dir / conversion_id / "metadata.json"
        if not metadata_path.exists():
            return None

        try:
            async with aiofiles.open(metadata_path, "r", encoding="utf-8") as f:
                content = await f.read()
                return json.loads(content)
        except (json.JSONDecodeError, IOError):
            return None
