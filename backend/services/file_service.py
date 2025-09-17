import os
import uuid
import aiofiles
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
import json

class FileService:
    """
    Service for handling file upload, storage, and management operations
    """
    
    def __init__(self, upload_dir: str = "uploads"):
        """
        Initialize the file service
        
        Args:
            upload_dir: Directory where uploaded files will be stored
        """
        self.upload_dir = Path(upload_dir)
        self.metadata_dir = self.upload_dir / "metadata"
        
        # Create directories if they don't exist
        self.upload_dir.mkdir(exist_ok=True)
        self.metadata_dir.mkdir(exist_ok=True)
    
    async def save_uploaded_file(self, filename: str, content: bytes) -> str:
        """
        Save an uploaded file to the local storage
        
        Args:
            filename: Original filename
            content: File content as bytes
            
        Returns:
            str: Path to the saved file
        """
        # Generate unique file ID
        file_id = str(uuid.uuid4())
        
        # Create safe filename
        safe_filename = self._create_safe_filename(filename)
        file_path = self.upload_dir / f"{file_id}_{safe_filename}"
        
        # Save file content
        async with aiofiles.open(file_path, 'wb') as f:
            await f.write(content)
        
        # Save metadata
        metadata = {
            "file_id": file_id,
            "original_filename": filename,
            "safe_filename": safe_filename,
            "file_path": str(file_path),
            "file_size": len(content),
            "upload_time": datetime.now().isoformat(),
            "mime_type": "application/pdf"
        }
        
        await self._save_metadata(file_id, metadata)
        
        return str(file_path)
    
    async def get_file_info(self, file_path: str) -> Dict[str, Any]:
        """
        Get file information from file path
        
        Args:
            file_path: Path to the file
            
        Returns:
            Dict containing file information
        """
        # Extract file_id from filename
        filename = Path(file_path).name
        file_id = filename.split('_')[0]
        
        metadata = await self._load_metadata(file_id)
        return metadata
    
    async def get_file_by_id(self, file_id: str) -> Optional[Dict[str, Any]]:
        """
        Get file information by file ID
        
        Args:
            file_id: Unique file identifier
            
        Returns:
            Dict containing file information or None if not found
        """
        return await self._load_metadata(file_id)
    
    async def delete_file(self, file_id: str) -> bool:
        """
        Delete a file and its metadata
        
        Args:
            file_id: Unique file identifier
            
        Returns:
            bool: True if file was deleted, False if not found
        """
        metadata = await self._load_metadata(file_id)
        if not metadata:
            return False
        
        # Delete the actual file
        file_path = Path(metadata["file_path"])
        if file_path.exists():
            file_path.unlink()
        
        # Delete metadata
        metadata_path = self.metadata_dir / f"{file_id}.json"
        if metadata_path.exists():
            metadata_path.unlink()
        
        return True
    
    async def get_file_content(self, file_id: str) -> Optional[bytes]:
        """
        Get file content by file ID
        
        Args:
            file_id: Unique file identifier
            
        Returns:
            File content as bytes or None if not found
        """
        metadata = await self._load_metadata(file_id)
        if not metadata:
            return None
        
        file_path = Path(metadata["file_path"])
        if not file_path.exists():
            return None
        
        async with aiofiles.open(file_path, 'rb') as f:
            return await f.read()
    
    async def list_files(self) -> List[Dict[str, Any]]:
        """
        List all uploaded files
        
        Returns:
            List of file information dictionaries
        """
        files = []
        for metadata_file in self.metadata_dir.glob("*.json"):
            file_id = metadata_file.stem
            metadata = await self._load_metadata(file_id)
            if metadata:
                files.append(metadata)
        
        return sorted(files, key=lambda x: x["upload_time"], reverse=True)
    
    def _create_safe_filename(self, filename: str) -> str:
        """
        Create a safe filename by removing/replacing unsafe characters
        
        Args:
            filename: Original filename
            
        Returns:
            Safe filename
        """
        # Remove directory separators and other unsafe characters
        safe_chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_"
        safe_filename = "".join(c if c in safe_chars else "_" for c in filename)
        
        # Ensure it's not too long
        if len(safe_filename) > 100:
            name, ext = os.path.splitext(safe_filename)
            safe_filename = name[:90] + ext
        
        return safe_filename
    
    async def _save_metadata(self, file_id: str, metadata: Dict[str, Any]):
        """
        Save file metadata to JSON file
        
        Args:
            file_id: Unique file identifier
            metadata: Metadata dictionary
        """
        metadata_path = self.metadata_dir / f"{file_id}.json"
        async with aiofiles.open(metadata_path, 'w') as f:
            await f.write(json.dumps(metadata, indent=2))
    
    async def _load_metadata(self, file_id: str) -> Optional[Dict[str, Any]]:
        """
        Load file metadata from JSON file
        
        Args:
            file_id: Unique file identifier
            
        Returns:
            Metadata dictionary or None if not found
        """
        metadata_path = self.metadata_dir / f"{file_id}.json"
        if not metadata_path.exists():
            return None
        
        try:
            async with aiofiles.open(metadata_path, 'r') as f:
                content = await f.read()
                return json.loads(content)
        except (json.JSONDecodeError, IOError):
            return None
