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

            # Save markdown with image references
            # Use a lambda to properly pass keyword argument
            await loop.run_in_executor(
                self.executor,
                lambda: result.document.save_as_markdown(
                    str(markdown_path), image_mode=ImageRefMode.REFERENCED
                ),
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

                # Save markdown with image references
                result.document.save_as_markdown(
                    str(markdown_path), image_mode=ImageRefMode.REFERENCED
                )

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
        page_image_count = 0
        table_image_count = 0
        picture_image_count = 0

        try:
            # Extract page images (optional - can be disabled if too large)
            # Commenting out for now to match Azure DI behavior (which doesn't save full page images)
            # for page_no, page in result.document.pages.items():
            #     if hasattr(page, 'image') and page.image:
            #         page_no = page.page_no
            #         figure_id = f"page-{page_no}"
            #         page_image_filename = figures_dir / f"{figure_id}.png"
            #         with page_image_filename.open("wb") as fp:
            #             page.image.pil_image.save(fp, format="PNG")
            #
            #         figures_metadata.append({
            #             "id": figure_id,
            #             "page": page_no,
            #             "caption": f"Page {page_no}",
            #             "image_path": f"figures/{figure_id}.png",
            #             "type": "page"
            #         })
            #         page_image_count += 1

            # Extract tables and pictures with metadata
            for element, _level in result.document.iterate_items():
                if isinstance(element, TableItem):
                    table_image_count += 1
                    figure_id = f"table-{table_image_count}"
                    element_image_filename = figures_dir / f"{figure_id}.png"

                    with element_image_filename.open("wb") as fp:
                        element.get_image(result.document).save(fp, "PNG")

                    # Extract page number if available
                    page_num = None
                    if hasattr(element, "prov") and element.prov:
                        for prov in element.prov:
                            if hasattr(prov, "page_no"):
                                page_num = prov.page_no
                                break

                    figures_metadata.append(
                        {
                            "id": figure_id,
                            "page": page_num,
                            "caption": f"Table {table_image_count}",
                            "image_path": f"figures/{figure_id}.png",
                            "type": "table",
                        }
                    )

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
            "tables_found": table_image_count,
            "pictures_found": picture_image_count,
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
