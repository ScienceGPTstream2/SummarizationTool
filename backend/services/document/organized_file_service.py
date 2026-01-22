"""
Organized File Service for SummarizationTool

This service manages file storage with a structured organization:
- files/global/{hash}/ - Deduplicated files with processing outputs
- files/users/{user_id}/documents/{hash}/ - User-specific data per document

Integrates with Supabase for tracking file ownership and metadata.
"""

import os
import uuid
import hashlib
import aiofiles
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
import json

from services.storage.supabase_storage_service import get_supabase_service


class OrganizedFileService:
    """
    Service for handling file upload, storage, and management with organized structure.
    
    Directory Structure:
    files/
    ├── global/{file_hash}/
    │   ├── original.pdf (or original file)
    │   ├── metadata.json
    │   └── processed/
    │       ├── azure_doc_intelligence/
    │       └── docling/
    └── users/{user_id}/documents/{file_hash}/
        ├── prompts/
        ├── extractions/
        └── reports/
    """

    def __init__(self, base_dir: str = "files"):
        """
        Initialize the organized file service.
        
        Args:
            base_dir: Base directory for all file storage
        """
        self.base_path = Path(__file__).parent.parent.parent / base_dir
        self.global_path = self.base_path / "global"
        self.users_path = self.base_path / "users"
        
        # Ensure base directories exist
        self.global_path.mkdir(parents=True, exist_ok=True)
        self.users_path.mkdir(parents=True, exist_ok=True)
        
        # Supabase service for database tracking
        self._supabase = None

    @property
    def supabase(self):
        """Lazy-load Supabase service."""
        if self._supabase is None:
            self._supabase = get_supabase_service()
        return self._supabase

    # ==================== File Hash Utilities ====================

    def compute_file_hash(self, content: bytes) -> str:
        """Compute SHA-256 hash of file content."""
        return hashlib.sha256(content).hexdigest()

    def get_global_file_path(self, file_hash: str) -> Path:
        """Get the global directory path for a file hash."""
        return self.global_path / file_hash

    def get_user_document_path(self, user_id: str, file_hash: str) -> Path:
        """Get the user-specific directory path for a document."""
        return self.users_path / user_id / "documents" / file_hash

    # ==================== File Upload & Storage ====================

    async def save_uploaded_file(
        self,
        filename: str,
        content: bytes,
        user_id: Optional[str] = None,
        file_hash: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Save an uploaded file with deduplication.
        
        Args:
            filename: Original filename
            content: File content as bytes
            user_id: Optional user ID to associate the file with
            file_hash: Optional pre-computed hash
            
        Returns:
            Dict with file info including hash, paths, and whether it was deduplicated
        """
        if not file_hash:
            file_hash = self.compute_file_hash(content)
        
        file_dir = self.get_global_file_path(file_hash)
        is_new_file = not file_dir.exists()
        
        # Get file extension
        ext = Path(filename).suffix.lower() or '.pdf'
        original_file_path = file_dir / f"original{ext}"
        metadata_path = file_dir / "metadata.json"
        
        if is_new_file:
            # Create directory and save file
            file_dir.mkdir(parents=True, exist_ok=True)
            (file_dir / "processed").mkdir(exist_ok=True)
            
            # Save the original file
            async with aiofiles.open(original_file_path, "wb") as f:
                await f.write(content)
            
            # Save metadata
            metadata = {
                "file_hash": file_hash,
                "original_filename": filename,
                "file_size": len(content),
                "mime_type": self._get_mime_type(filename),
                "created_at": datetime.now().isoformat(),
                "extension": ext
            }
            async with aiofiles.open(metadata_path, "w") as f:
                await f.write(json.dumps(metadata, indent=2))
            
            # Register in Supabase if configured
            if self.supabase.is_configured:
                try:
                    await self.supabase.register_global_file(
                        file_hash=file_hash,
                        original_filename=filename,
                        file_size=len(content),
                        storage_path=str(file_dir.relative_to(self.base_path)),
                        mime_type=metadata["mime_type"]
                    )
                except Exception as e:
                    print(f"Warning: Failed to register file in Supabase: {e}")
        
        # Associate with user if provided
        if user_id:
            await self._associate_file_with_user(file_hash, user_id)
        
        return {
            "file_hash": file_hash,
            "file_path": str(original_file_path),
            "file_dir": str(file_dir),
            "is_new": is_new_file,
            "deduplicated": not is_new_file,
            "original_filename": filename,
            "file_size": len(content)
        }

    async def _associate_file_with_user(self, file_hash: str, user_id: str) -> None:
        """
        Associate a file with a user.
        Creates a user-specific document directory with symlinks to global storage
        for visibility while maintaining deduplication.
        """
        global_dir = self.get_global_file_path(file_hash)
        user_doc_path = self.get_user_document_path(user_id, file_hash)
        
        # 1. Create directory structure
        if not user_doc_path.exists():
            user_doc_path.mkdir(parents=True, exist_ok=True)
            (user_doc_path / "prompts").mkdir(exist_ok=True)
            (user_doc_path / "extractions").mkdir(exist_ok=True)
            (user_doc_path / "reports").mkdir(exist_ok=True)
            
        # 2. Add symlinks to global storage for easier visibility in the filesystem
        # Use relative symlinks so the structure remains valid if moved
        try:
            # Point to original file(s)
            for global_file in global_dir.glob("original.*"):
                user_link = user_doc_path / global_file.name
                if not user_link.exists():
                    # Calculate relative path from user_doc_path to global_file
                    rel_path = os.path.relpath(global_file, user_doc_path)
                    os.symlink(rel_path, user_link)
            
            # Point to processed output
            global_processed = global_dir / "processed"
            user_processed_link = user_doc_path / "processed"
            if global_processed.exists() and not user_processed_link.exists():
                rel_path = os.path.relpath(global_processed, user_doc_path)
                os.symlink(rel_path, user_processed_link)
                
            # Create a simple mapping file for quick identification
            mapping_file = user_doc_path / "file_info.json"
            if not mapping_file.exists():
                global_meta = await self.get_file_metadata(file_hash)
                info = {
                    "user_id": user_id,
                    "file_hash": file_hash,
                    "original_filename": global_meta.get("original_filename") if global_meta else "unknown",
                    "associated_at": datetime.now().isoformat()
                }
                async with aiofiles.open(mapping_file, "w") as f:
                    await f.write(json.dumps(info, indent=2))
                    
        except Exception as e:
            print(f"Warning: Failed to create symlinks for user visibility: {e}")

        # 3. Register in Supabase
        if self.supabase.is_configured:
            try:
                # Get global file ID
                global_file = await self.supabase.get_file_by_hash(file_hash)
                if global_file:
                    # Check if user already has this file
                    if not await self.supabase.user_has_file(user_id, global_file["id"]):
                        await self.supabase.add_user_file(user_id, global_file["id"])
                    else:
                        # Update last accessed
                        await self.supabase.update_user_file_access(user_id, global_file["id"])
            except Exception as e:
                print(f"Warning: Failed to associate file with user in Supabase: {e}")

    # ==================== Processing Output Paths ====================

    def get_processing_output_path(self, file_hash: str, processor: Any) -> Path:
        """
        Get the path for storing processing outputs.
        
        Args:
            file_hash: The file hash
            processor: Processor name ('azure_doc_intelligence' or 'docling') or ProcessorType enum
            
        Returns:
            Path to the processor output directory
        """
        proc_str = self._get_processor_str(processor)
        output_path = self.get_global_file_path(file_hash) / "processed" / proc_str
        output_path.mkdir(parents=True, exist_ok=True)
        return output_path

    def _get_processor_str(self, processor: Any) -> str:
        """Helper to get string value from processor name or enum."""
        if hasattr(processor, "value"):
            return str(processor.value)
        return str(processor)

    async def is_file_processed(self, file_hash: str, processor: Any) -> bool:
        """Check if a file has already been processed by a specific processor."""
        proc_str = self._get_processor_str(processor)
        output_path = self.get_global_file_path(file_hash) / "processed" / proc_str
        if not output_path.exists():
            return False
        
        # Check for document.md as indicator of successful processing
        return (output_path / "document.md").exists()

    async def get_processed_content(self, file_hash: str, processor: Any) -> Optional[str]:
        """Get the processed markdown content if available."""
        proc_str = self._get_processor_str(processor)
        md_path = self.get_global_file_path(file_hash) / "processed" / proc_str / "document.md"
        if not md_path.exists():
            return None
        
        async with aiofiles.open(md_path, "r") as f:
            return await f.read()

    # ==================== User Document Data ====================

    async def save_user_extraction(
        self,
        user_id: str,
        file_hash: str,
        model_name: str,
        extraction_data: Dict[str, Any]
    ) -> Path:
        """
        Save an LLM extraction result for a user's document.
        
        Args:
            user_id: User ID
            file_hash: File hash
            model_name: LLM model name (e.g., 'gemini-2.5-pro')
            extraction_data: The extraction result
            
        Returns:
            Path to the saved extraction file
        """
        user_doc_path = self.get_user_document_path(user_id, file_hash)
        extractions_path = user_doc_path / "extractions" / self._sanitize_name(model_name)
        extractions_path.mkdir(parents=True, exist_ok=True)
        
        # Save with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = extractions_path / f"extraction_{timestamp}.json"
        
        async with aiofiles.open(output_file, "w") as f:
            await f.write(json.dumps(extraction_data, indent=2))
        
        return output_file

    async def save_user_prompt(
        self,
        user_id: str,
        file_hash: str,
        prompt_name: str,
        prompt_content: str,
        prompt_type: str = "extraction"
    ) -> Path:
        """
        Save a user's custom prompt for a document.
        
        Args:
            user_id: User ID
            file_hash: File hash
            prompt_name: Name for the prompt
            prompt_content: The prompt text
            prompt_type: Type of prompt
            
        Returns:
            Path to the saved prompt file
        """
        user_doc_path = self.get_user_document_path(user_id, file_hash)
        prompts_path = user_doc_path / "prompts"
        prompts_path.mkdir(parents=True, exist_ok=True)
        
        prompt_file = prompts_path / f"{self._sanitize_name(prompt_name)}.json"
        
        prompt_data = {
            "name": prompt_name,
            "type": prompt_type,
            "content": prompt_content,
            "created_at": datetime.now().isoformat()
        }
        
        async with aiofiles.open(prompt_file, "w") as f:
            await f.write(json.dumps(prompt_data, indent=2))
        
        # Also save to Supabase if configured
        if self.supabase.is_configured:
            try:
                await self.supabase.save_user_prompt(
                    user_id=user_id,
                    name=prompt_name,
                    prompt_type=prompt_type,
                    content=prompt_content
                )
            except Exception as e:
                print(f"Warning: Failed to save prompt to Supabase: {e}")
        
        return prompt_file

    async def save_user_report(
        self,
        user_id: str,
        file_hash: str,
        report_name: str,
        report_content: bytes,
        report_ext: str = ".docx"
    ) -> Path:
        """
        Save a generated report for a user's document.
        
        Args:
            user_id: User ID
            file_hash: File hash
            report_name: Name for the report
            report_content: Report content as bytes
            report_ext: File extension
            
        Returns:
            Path to the saved report file
        """
        user_doc_path = self.get_user_document_path(user_id, file_hash)
        reports_path = user_doc_path / "reports"
        reports_path.mkdir(parents=True, exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        report_file = reports_path / f"{self._sanitize_name(report_name)}_{timestamp}{report_ext}"
        
        async with aiofiles.open(report_file, "wb") as f:
            await f.write(report_content)
        
        return report_file

    # ==================== File Retrieval ====================

    async def get_file_content(self, file_hash: str) -> Optional[bytes]:
        """Get the original file content by hash."""
        file_dir = self.get_global_file_path(file_hash)
        if not file_dir.exists():
            return None
        
        # Find the original file (could be any extension)
        for file in file_dir.glob("original.*"):
            async with aiofiles.open(file, "rb") as f:
                return await f.read()
        
        return None

    async def get_file_metadata(self, file_hash: str) -> Optional[Dict[str, Any]]:
        """Get file metadata by hash."""
        metadata_path = self.get_global_file_path(file_hash) / "metadata.json"
        if not metadata_path.exists():
            return None
        
        async with aiofiles.open(metadata_path, "r") as f:
            return json.loads(await f.read())

    async def get_original_file_path(self, file_hash: str) -> Optional[Path]:
        """Get the path to the original file."""
        file_dir = self.get_global_file_path(file_hash)
        if not file_dir.exists():
            return None
        
        for file in file_dir.glob("original.*"):
            return file
        
        return None

    async def list_user_files(self, user_id: str) -> List[Dict[str, Any]]:
        """
        List all files associated with a user.
        
        Returns list of file info including hash, metadata, and processing status.
        """
        user_docs_path = self.users_path / user_id / "documents"
        if not user_docs_path.exists():
            return []
        
        files = []
        for file_hash_dir in user_docs_path.iterdir():
            if file_hash_dir.is_dir():
                file_hash = file_hash_dir.name
                metadata = await self.get_file_metadata(file_hash)
                if metadata:
                    # Check processing status
                    is_processed_azure = await self.is_file_processed(file_hash, "azure_doc_intelligence")
                    is_processed_docling = await self.is_file_processed(file_hash, "docling")
                    
                    files.append({
                        **metadata,
                        "file_hash": file_hash,
                        "processed": {
                            "azure_doc_intelligence": is_processed_azure,
                            "docling": is_processed_docling
                        }
                    })
        
        return sorted(files, key=lambda x: x.get("created_at", ""), reverse=True)

    # ==================== Utility Methods ====================

    def _get_mime_type(self, filename: str) -> str:
        """Get MIME type from filename."""
        ext = Path(filename).suffix.lower()
        mime_types = {
            ".pdf": "application/pdf",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".bmp": "image/bmp",
            ".tiff": "image/tiff",
            ".tif": "image/tiff"
        }
        return mime_types.get(ext, "application/octet-stream")

    def _sanitize_name(self, name: str) -> str:
        """Create a safe filename from a name."""
        safe_chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
        sanitized = "".join(c if c in safe_chars else "_" for c in name)
        return sanitized[:100]  # Limit length


# Singleton instance
_organized_file_service: Optional[OrganizedFileService] = None


def get_organized_file_service() -> OrganizedFileService:
    """Get or create the organized file service singleton."""
    global _organized_file_service
    if _organized_file_service is None:
        _organized_file_service = OrganizedFileService()
    return _organized_file_service
