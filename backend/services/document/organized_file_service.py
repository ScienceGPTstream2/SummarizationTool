"""
Organized File Service for SummarizationTool

Manages file storage using Azure Blob Storage with a structured hierarchy:
  global/{hash}/original.{ext}
  global/{hash}/metadata.json
  global/{hash}/processed/{processor}/document.md
  global/{hash}/processed/{processor}/figures/
  global/{hash}/processed/{processor}/tables/

Requires AZURE_STORAGE_CONNECTION_STRING to be set.
/tmp is used as ephemeral scratch space for processors that need a real filesystem
path, and as a read cache to avoid redundant blob downloads within one container lifetime.
"""

import json
import os
import hashlib
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List

from services.database import get_db_service, SQLAlchemyDBService
from services.storage.blob_storage import BlobStorageClient


class OrganizedFileService:
    """
    Service for file upload, storage, and retrieval using Azure Blob Storage.

    All persistent files live in Azure Blob Storage. /tmp is used as ephemeral
    scratch space for processors that require a real filesystem path, and as a
    read cache to avoid redundant downloads within the same container lifetime.
    """

    def __init__(self):
        conn_str = os.environ.get("AZURE_STORAGE_CONNECTION_STRING")
        if not conn_str:
            raise RuntimeError(
                "AZURE_STORAGE_CONNECTION_STRING is required but not set"
            )
        container = os.environ.get(
            "AZURE_STORAGE_CONTAINER_NAME", "summarization-uploads"
        )
        self._blob = BlobStorageClient(conn_str, container)
        self._db = None
        print("✅ OrganizedFileService: Azure Blob Storage ready")

    @property
    def db(self):
        if self._db is None:
            self._db = get_db_service()
        return self._db

    # ==================== File Hash Utilities ====================

    def compute_file_hash(self, content: bytes) -> str:
        return hashlib.sha256(content).hexdigest()

    # ==================== File Upload & Storage ====================

    async def save_uploaded_file(
        self,
        filename: str,
        content: bytes,
        user_id: Optional[str] = None,
        file_hash: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Save an uploaded file with deduplication."""
        if not file_hash:
            file_hash = self.compute_file_hash(content)

        ext = Path(filename).suffix.lower() or ".pdf"
        original_blob = f"global/{file_hash}/original{ext}"
        is_new_file = not await self._blob.exists(original_blob)

        if is_new_file:
            await self._blob.upload_bytes(original_blob, content)
            metadata = {
                "file_hash": file_hash,
                "original_filename": filename,
                "file_size": len(content),
                "mime_type": self._get_mime_type(filename),
                "created_at": datetime.now().isoformat(),
                "extension": ext,
            }
            await self._blob.upload_bytes(
                f"global/{file_hash}/metadata.json",
                json.dumps(metadata).encode(),
            )

        if user_id:
            try:
                self.db.create_document(
                    user_id=user_id,
                    file_hash=file_hash,
                    filename=filename,
                    session_id=None,
                )
            except Exception as e:
                print(f"Warning: Failed to register file in database: {e}")

        return {
            "file_hash": file_hash,
            "file_path": f"blob:global/{file_hash}/original{ext}",
            "file_dir": f"blob:global/{file_hash}",
            "is_new": is_new_file,
            "deduplicated": not is_new_file,
            "original_filename": filename,
            "file_size": len(content),
        }

    # ==================== Processing Output Paths ====================

    def get_processing_output_path(self, file_hash: str, processor: Any) -> Path:
        """
        Return the /tmp directory where a processor should write its output.

        After processing completes, call sync_processing_output_to_blob() to
        persist the output to blob storage.
        """
        proc_str = self._get_processor_str(processor)
        output_path = (
            Path(tempfile.gettempdir())
            / "summarization"
            / file_hash
            / "processed"
            / proc_str
        )
        output_path.mkdir(parents=True, exist_ok=True)
        return output_path

    async def sync_processing_output_to_blob(
        self, file_hash: str, processor: Any, local_path: Path
    ) -> None:
        """Upload a local processing output directory to blob."""
        proc_str = self._get_processor_str(processor)
        blob_prefix = f"global/{file_hash}/processed/{proc_str}"
        await self._blob.upload_directory(blob_prefix, local_path)

    async def get_processed_metadata(
        self, file_hash: str, processor: Any
    ) -> Optional[Dict[str, Any]]:
        """
        Read the processor-level metadata.json (page_count, figures_found, parse_cost, etc.).

        Distinct from get_file_metadata() which returns upload-level metadata
        (original_filename, file_size, mime_type).
        """
        proc_str = self._get_processor_str(processor)
        data = await self._blob.download_bytes(
            f"global/{file_hash}/processed/{proc_str}/metadata.json"
        )
        return json.loads(data) if data else None

    async def update_processed_metadata(
        self, file_hash: str, processor: Any, metadata: Dict[str, Any]
    ) -> None:
        """Write updated processor-level metadata to blob."""
        proc_str = self._get_processor_str(processor)
        await self._blob.upload_bytes(
            f"global/{file_hash}/processed/{proc_str}/metadata.json",
            json.dumps(metadata).encode(),
        )

    async def get_processing_file_bytes(
        self, file_hash: str, processor: Any, relative_path: str
    ) -> Optional[bytes]:
        """
        Read any file from a processor's output directory.

        relative_path is relative to the processor output dir, e.g.:
          "figures/1.1.png", "tables/table-1.html", "raw_analysis.json"

        Checks /tmp cache first, then downloads from blob and caches locally
        to avoid redundant downloads within the same container lifetime.
        """
        proc_str = self._get_processor_str(processor)
        norm_path = relative_path.replace("\\", "/")

        tmp_file = (
            Path(tempfile.gettempdir())
            / "summarization"
            / file_hash
            / "processed"
            / proc_str
            / Path(norm_path)
        )
        if tmp_file.exists():
            return tmp_file.read_bytes()

        blob_path = f"global/{file_hash}/processed/{proc_str}/{norm_path}"
        data = await self._blob.download_bytes(blob_path)
        if data:
            tmp_file.parent.mkdir(parents=True, exist_ok=True)
            tmp_file.write_bytes(data)
        return data

    async def processing_file_exists(
        self, file_hash: str, processor: Any, relative_path: str
    ) -> bool:
        """Check whether a specific processor output file exists in blob storage."""
        proc_str = self._get_processor_str(processor)
        norm_path = relative_path.replace("\\", "/")
        return await self._blob.exists(
            f"global/{file_hash}/processed/{proc_str}/{norm_path}"
        )

    async def resolve_processed_processor(
        self, file_hash: str, preferred_processor: Optional[Any] = None
    ) -> Optional[str]:
        """Resolve the processor that actually has persisted artifacts for a file."""
        candidates: List[str] = []
        if preferred_processor is not None:
            candidates.append(self._get_processor_str(preferred_processor))
        for proc in ("azure_doc_intelligence", "docling"):
            if proc not in candidates:
                candidates.append(proc)

        for proc in candidates:
            if await self._blob.exists(f"global/{file_hash}/processed/{proc}/metadata.json"):
                return proc
            if await self._blob.exists(f"global/{file_hash}/processed/{proc}/document.md"):
                return proc
            if await self._blob.exists(
                f"global/{file_hash}/processed/{proc}/raw_analysis.json"
            ):
                return proc
            # Last fallback: if *any* blob exists under the processor subtree,
            # treat that processor as valid. This avoids false 404s when a
            # document has tables/figures/raw analysis but no document.md.
            prefix_hits = await self._blob.list_blobs_with_prefix(
                f"global/{file_hash}/processed/{proc}/", limit=1
            )
            if prefix_hits:
                return proc
        return None

    async def build_document_view(
        self,
        file_hash: str,
        preferred_processor: Optional[Any] = None,
        filename: Optional[str] = None,
        parse_cost: Optional[float] = None,
        parse_duration_seconds: Optional[float] = None,
        page_count: Optional[int] = None,
        figure_count: Optional[int] = None,
        table_count: Optional[int] = None,
        status: str = "completed",
        selected_parser: Optional[str] = None,
        extra_file_fields: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Build a canonical backend-owned document/viewer state model."""
        processor_used = await self.resolve_processed_processor(file_hash, preferred_processor)
        file_metadata = await self.get_file_metadata(file_hash) or {}
        processed_metadata = (
            await self.get_processed_metadata(file_hash, processor_used)
            if processor_used
            else {}
        ) or {}

        resolved_filename = (
            filename
            or file_metadata.get("original_filename")
            or f"{file_hash}.pdf"
        )

        resolved_parse_cost = (
            parse_cost
            if parse_cost is not None
            else processed_metadata.get("parse_cost")
        )
        resolved_parse_duration = (
            parse_duration_seconds
            if parse_duration_seconds is not None
            else processed_metadata.get("parse_duration_seconds")
        )
        resolved_page_count = (
            page_count if page_count is not None else processed_metadata.get("page_count")
        )
        resolved_figures = processed_metadata.get("figures", []) or []
        resolved_figure_count = (
            figure_count
            if figure_count is not None
            else processed_metadata.get("figures_found")
        )
        resolved_table_count = (
            table_count
            if table_count is not None
            else processed_metadata.get("tables_found")
        )

        # Fallback: if metadata.json had no figures data, enumerate blob prefix
        if not resolved_figures and not resolved_figure_count and processor_used:
            figure_blobs = await self._blob.list_blobs_with_prefix(
                f"global/{file_hash}/processed/{processor_used}/figures/", limit=50
            )
            image_blobs = [b for b in figure_blobs if b.lower().endswith((".png", ".jpg", ".jpeg"))]
            if image_blobs:
                from pathlib import Path as _Path
                resolved_figures = [
                    {
                        "id": _Path(b).stem,
                        "image_path": f"figures/{_Path(b).name}",
                        "caption": None,
                        "page": None,
                    }
                    for b in sorted(image_blobs)
                ]
                resolved_figure_count = len(resolved_figures)

        # markdown_available checks document.md directly (honest UI flag, independent of
        # the broader is_file_processed cache check which uses 4-tier fallback)
        markdown_available = (
            await self._blob.exists(
                f"global/{file_hash}/processed/{self._get_processor_str(processor_used)}/document.md"
            )
            if processor_used
            else False
        )
        analysis_available = (
            await self.processing_file_exists(file_hash, processor_used, "raw_analysis.json")
            if processor_used
            else False
        )
        # Fallback: if metadata.json had no tables count, enumerate blob prefix
        if not resolved_table_count and processor_used:
            table_blobs = await self._blob.list_blobs_with_prefix(
                f"global/{file_hash}/processed/{processor_used}/tables/", limit=50
            )
            html_blobs = [b for b in table_blobs if b.lower().endswith(".html")]
            if html_blobs:
                resolved_table_count = len(html_blobs)

        tables_available = bool(resolved_table_count) or (
            await self.processing_file_exists(file_hash, processor_used, "tables/table-1.html")
            if processor_used
            else False
        )
        figures_available = bool(resolved_figures) or bool(resolved_figure_count)

        result = {
            "fileName": resolved_filename,
            "fileId": file_hash,
            "status": status,
            "selectedParser": selected_parser or processor_used,
            "processorUsed": processor_used,
            "processingResult": {
                "conversionId": file_hash,
                "fileHash": file_hash,
                "processorUsed": processor_used,
                "markdownPath": None,
                "parseCost": resolved_parse_cost,
                "parse_cost": resolved_parse_cost,
                "parseDuration": resolved_parse_duration,
                "parse_duration_seconds": resolved_parse_duration,
                "pageCount": resolved_page_count,
                "page_count": resolved_page_count,
                "figures": resolved_figures,
                "figuresCount": resolved_figure_count or 0,
                "tablesCount": resolved_table_count or 0,
                "artifactAvailability": {
                    "original": bool(file_metadata),
                    "markdown": markdown_available,
                    "analysis": analysis_available,
                    "figures": figures_available,
                    "tables": tables_available,
                },
            },
        }
        if extra_file_fields:
            result.update(extra_file_fields)
        return result

    def _get_processor_str(self, processor: Any) -> str:
        if hasattr(processor, "value"):
            return str(processor.value)
        return str(processor)

    async def is_file_processed(self, file_hash: str, processor: Any) -> bool:
        """True if any meaningful artifact subtree exists for this processor.

        Uses the same 4-tier fallback as resolve_processed_processor so that
        documents with raw_analysis/figures/tables but no document.md are still
        treated as cached and won't trigger a redundant re-process.
        """
        proc_str = self._get_processor_str(processor)
        base = f"global/{file_hash}/processed/{proc_str}"
        for path in (
            f"{base}/metadata.json",
            f"{base}/document.md",
            f"{base}/raw_analysis.json",
        ):
            if await self._blob.exists(path):
                return True
        hits = await self._blob.list_blobs_with_prefix(f"{base}/", limit=1)
        return bool(hits)

    async def get_processed_content(
        self, file_hash: str, processor: Any
    ) -> Optional[str]:
        """Get the processed markdown content if available."""
        proc_str = self._get_processor_str(processor)
        data = await self._blob.download_bytes(
            f"global/{file_hash}/processed/{proc_str}/document.md"
        )
        return data.decode("utf-8") if data else None

    # ==================== File Retrieval ====================

    async def get_file_content(self, file_hash: str) -> Optional[bytes]:
        """Get the original file content by hash."""
        for ext in (".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif"):
            data = await self._blob.download_bytes(f"global/{file_hash}/original{ext}")
            if data:
                return data
        return None

    async def get_file_metadata(self, file_hash: str) -> Optional[Dict[str, Any]]:
        """Get file metadata by hash."""
        data = await self._blob.download_bytes(f"global/{file_hash}/metadata.json")
        if not data:
            return None
        return json.loads(data)

    async def get_original_file_path(self, file_hash: str) -> Optional[Path]:
        """
        Get a filesystem path to the original file.

        Downloads to /tmp/summarization/{hash}/ on first access and caches it
        there for subsequent calls within the same container lifetime.
        """
        metadata = await self.get_file_metadata(file_hash)
        if not metadata:
            return None
        ext = metadata.get("extension", ".pdf")

        tmp_file = (
            Path(tempfile.gettempdir()) / "summarization" / file_hash / f"original{ext}"
        )
        if not tmp_file.exists():
            data = await self._blob.download_bytes(f"global/{file_hash}/original{ext}")
            if not data:
                return None
            tmp_file.parent.mkdir(parents=True, exist_ok=True)
            tmp_file.write_bytes(data)
        return tmp_file

    async def list_user_files(self, user_id: str) -> List[Dict[str, Any]]:
        """List all files associated with a user using the database."""
        try:
            db_docs = self.db.list_user_documents(user_id)
        except Exception as e:
            print(f"Error fetching user documents from DB: {e}")
            return []

        files = []
        for doc in db_docs:
            file_hash = doc["file_hash"]
            metadata = await self.get_file_metadata(file_hash)

            if not metadata:
                metadata = {
                    "original_filename": doc["filename"],
                    "created_at": doc["created_at"],
                    "file_hash": file_hash,
                }

            is_processed_azure = await self.is_file_processed(
                file_hash, "azure_doc_intelligence"
            )
            is_processed_docling = await self.is_file_processed(file_hash, "docling")

            files.append(
                {
                    **metadata,
                    "file_hash": file_hash,
                    "processed": {
                        "azure_doc_intelligence": is_processed_azure,
                        "docling": is_processed_docling,
                    },
                }
            )

        return sorted(files, key=lambda x: x.get("created_at", ""), reverse=True)

    # ==================== Utility Methods ====================

    def _get_mime_type(self, filename: str) -> str:
        ext = Path(filename).suffix.lower()
        mime_types = {
            ".pdf": "application/pdf",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".bmp": "image/bmp",
            ".tiff": "image/tiff",
            ".tif": "image/tiff",
        }
        return mime_types.get(ext, "application/octet-stream")


# Singleton instance
_organized_file_service: Optional[OrganizedFileService] = None


def get_organized_file_service() -> OrganizedFileService:
    """Get or create the organized file service singleton."""
    global _organized_file_service
    if _organized_file_service is None:
        _organized_file_service = OrganizedFileService()
    return _organized_file_service
