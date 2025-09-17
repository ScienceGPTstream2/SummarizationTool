import os
import uuid
import aiofiles
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, Union
import json
import asyncio
from concurrent.futures import ThreadPoolExecutor

from docling.document_converter import DocumentConverter

class DoclingService:
    """
    Service for handling document ingestion and conversion using Docling
    """
    
    def __init__(self, markdown_dir: Optional[Union[str, Path]] = None):
        """
        Initialize the docling service

        Args:
            markdown_dir: Directory where converted markdown files will be stored.
                          If None, defaults to backend/markdown_output relative to this file.
        """
        # Determine default markdown dir relative to the backend package (two levels up from this file)
        if markdown_dir is None:
            default_dir = Path(__file__).resolve().parents[1] / "markdown_output"
            self.markdown_dir = default_dir
        else:
            self.markdown_dir = Path(markdown_dir)

        self.metadata_dir = self.markdown_dir / "metadata"

        # Create directories if they don't exist (ensure parents=True for safety)
        self.markdown_dir.mkdir(parents=True, exist_ok=True)
        self.metadata_dir.mkdir(parents=True, exist_ok=True)

        # Initialize docling converter
        self.converter = DocumentConverter()

        # Thread pool for CPU-intensive tasks
        self.executor = ThreadPoolExecutor(max_workers=2)
    
    async def convert_document_to_markdown(self, source: Union[str, Path], source_type: str = "file") -> Dict[str, Any]:
        """
        Convert a document to markdown using Docling
        
        Args:
            source: File path or URL to the document
            source_type: Type of source ("file", "url")
            
        Returns:
            Dict containing conversion results and metadata
        """
        try:
            # Generate unique conversion ID
            conversion_id = str(uuid.uuid4())

            # Prepare log file for this conversion and attach a file handler to capture logs
            import logging as _logging
            log_path = self.metadata_dir / f"{conversion_id}.log"
            # Ensure the metadata/log directory exists
            log_path.parent.mkdir(parents=True, exist_ok=True)

            handler = _logging.FileHandler(str(log_path), mode='w', encoding='utf-8')
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
                    self.executor,
                    self._convert_document_sync,
                    source
                )
            finally:
                # Remove the temporary handler so subsequent conversions won't write to this file
                try:
                    root_logger.removeHandler(handler)
                    handler.close()
                    _logging.captureWarnings(False)
                except Exception:
                    pass

            # Extract markdown content
            markdown_content = result.document.export_to_markdown()
            
            # Create safe filename for markdown
            if source_type == "url":
                base_filename = f"url_document_{conversion_id}"
            else:
                source_path = Path(source)
                base_filename = f"{source_path.stem}_{conversion_id}"
            
            markdown_filename = f"{base_filename}.md"
            markdown_path = self.markdown_dir / markdown_filename
            
            # Save markdown content
            async with aiofiles.open(markdown_path, 'w', encoding='utf-8') as f:
                await f.write(markdown_content)
            
            # Create metadata (include path to log file)
            metadata = {
                "conversion_id": conversion_id,
                "source": str(source),
                "source_type": source_type,
                "markdown_filename": markdown_filename,
                "markdown_path": str(markdown_path),
                "log_path": str(log_path),
                "conversion_time": datetime.now().isoformat(),
                "content_length": len(markdown_content),
                "status": "success"
            }
            
            # Save metadata
            await self._save_conversion_metadata(conversion_id, metadata)
            
            return {
                "success": True,
                "conversion_id": conversion_id,
                "markdown_path": str(markdown_path),
                "markdown_content": markdown_content,
                "metadata": metadata
            }
            
        except Exception as e:
            # Create error metadata
            error_metadata = {
                "conversion_id": conversion_id if 'conversion_id' in locals() else str(uuid.uuid4()),
                "source": str(source),
                "source_type": source_type,
                "conversion_time": datetime.now().isoformat(),
                "status": "error",
                "error_message": str(e),
                "log_path": str(log_path) if 'log_path' in locals() else None
            }
            
            await self._save_conversion_metadata(error_metadata["conversion_id"], error_metadata)
            
            return {
                "success": False,
                "error": str(e),
                "conversion_id": error_metadata["conversion_id"],
                "metadata": error_metadata
            }
    
    async def start_conversion(self, source: Union[str, Path], source_type: str = "file") -> Dict[str, Any]:
        """
        Start a conversion in the background and return immediately with a conversion_id.
        The conversion runs in the configured thread pool and writes logs and metadata
        to the metadata directory so the frontend can stream logs.
        """
        conversion_id = str(uuid.uuid4())
        log_path = self.metadata_dir / f"{conversion_id}.log"
        # initial metadata marking as running
        metadata = {
            "conversion_id": conversion_id,
            "source": str(source),
            "source_type": source_type,
            "markdown_filename": None,
            "markdown_path": None,
            "log_path": str(log_path),
            "conversion_time": datetime.now().isoformat(),
            "content_length": 0,
            "status": "running"
        }
        # Save initial metadata (async)
        await self._save_conversion_metadata(conversion_id, metadata)

        def _run_and_finalize(conv_id: str, src: Union[str, Path], s_type: str):
            import logging as _logging
            try:
                # Attach file handler to capture logs for this conversion
                handler = _logging.FileHandler(str(log_path), mode='a', encoding='utf-8')
                handler.setLevel(_logging.INFO)
                formatter = _logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
                handler.setFormatter(formatter)
                root_logger = _logging.getLogger()
                root_logger.addHandler(handler)
                _logging.captureWarnings(True)

                # Run the actual conversion synchronously (in executor)
                result = self._convert_document_sync(src)

                # Extract markdown and save
                markdown_content = result.document.export_to_markdown()

                # Determine filenames
                if s_type == "url":
                    base_filename = f"url_document_{conv_id}"
                else:
                    source_path = Path(src)
                    base_filename = f"{source_path.stem}_{conv_id}"

                markdown_filename = f"{base_filename}.md"
                markdown_path = self.markdown_dir / markdown_filename

                # Write markdown synchronously
                with open(markdown_path, 'w', encoding='utf-8') as mf:
                    mf.write(markdown_content)

                # Build final metadata
                final_meta = {
                    "conversion_id": conv_id,
                    "source": str(src),
                    "source_type": s_type,
                    "markdown_filename": markdown_filename,
                    "markdown_path": str(markdown_path),
                    "log_path": str(log_path),
                    "conversion_time": datetime.now().isoformat(),
                    "content_length": len(markdown_content),
                    "status": "success"
                }

                # Save metadata synchronously
                metadata_path = self.metadata_dir / f"{conv_id}.json"
                try:
                    with open(metadata_path, 'w', encoding='utf-8') as mf:
                        json.dump(final_meta, mf, indent=2)
                except Exception:
                    # best-effort; if this fails, ignore — the async saver may not be available here
                    pass

            except Exception as e:
                # Write error metadata synchronously
                error_meta = {
                    "conversion_id": conv_id,
                    "source": str(src),
                    "source_type": s_type,
                    "conversion_time": datetime.now().isoformat(),
                    "status": "error",
                    "error_message": str(e),
                    "log_path": str(log_path)
                }
                metadata_path = self.metadata_dir / f"{conv_id}.json"
                try:
                    with open(metadata_path, 'w', encoding='utf-8') as mf:
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
        loop.run_in_executor(self.executor, _run_and_finalize, conversion_id, source, source_type)

        return {
            "success": True,
            "conversion_id": conversion_id,
            "markdown_path": None,
            "metadata": metadata
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
    
    async def get_conversion_by_id(self, conversion_id: str) -> Optional[Dict[str, Any]]:
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
        metadata = await self._load_conversion_metadata(conversion_id)
        if not metadata or metadata.get("status") != "success":
            return None
        
        markdown_path = Path(metadata["markdown_path"])
        if not markdown_path.exists():
            return None
        
        try:
            async with aiofiles.open(markdown_path, 'r', encoding='utf-8') as f:
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
        for metadata_file in self.metadata_dir.glob("*.json"):
            conversion_id = metadata_file.stem
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
        metadata = await self._load_conversion_metadata(conversion_id)
        if not metadata:
            return False
        
        # Delete markdown file if it exists
        if "markdown_path" in metadata:
            markdown_path = Path(metadata["markdown_path"])
            if markdown_path.exists():
                markdown_path.unlink()
        
        # Delete metadata
        metadata_path = self.metadata_dir / f"{conversion_id}.json"
        if metadata_path.exists():
            metadata_path.unlink()
        
        return True
    
    async def _save_conversion_metadata(self, conversion_id: str, metadata: Dict[str, Any]):
        """
        Save conversion metadata to JSON file
        
        Args:
            conversion_id: Unique conversion identifier
            metadata: Metadata dictionary
        """
        metadata_path = self.metadata_dir / f"{conversion_id}.json"
        async with aiofiles.open(metadata_path, 'w', encoding='utf-8') as f:
            await f.write(json.dumps(metadata, indent=2))
    
    async def _load_conversion_metadata(self, conversion_id: str) -> Optional[Dict[str, Any]]:
        """
        Load conversion metadata from JSON file
        
        Args:
            conversion_id: Unique conversion identifier
            
        Returns:
            Metadata dictionary or None if not found
        """
        metadata_path = self.metadata_dir / f"{conversion_id}.json"
        if not metadata_path.exists():
            return None
        
        try:
            async with aiofiles.open(metadata_path, 'r', encoding='utf-8') as f:
                content = await f.read()
                return json.loads(content)
        except (json.JSONDecodeError, IOError):
            return None
