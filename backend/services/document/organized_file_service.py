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

    def _get_processor_str(self, processor: Any) -> str:
        if hasattr(processor, "value"):
            return str(processor.value)
        return str(processor)

    async def is_file_processed(self, file_hash: str, processor: Any) -> bool:
        """Check if a file has already been processed by a specific processor."""
        proc_str = self._get_processor_str(processor)
        return await self._blob.exists(
            f"global/{file_hash}/processed/{proc_str}/document.md"
        )

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
            data = await self._blob.download_bytes(
                f"global/{file_hash}/original{ext}"
            )
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
            Path(tempfile.gettempdir())
            / "summarization"
            / file_hash
            / f"original{ext}"
        )
        if not tmp_file.exists():
            data = await self._blob.download_bytes(
                f"global/{file_hash}/original{ext}"
            )
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
