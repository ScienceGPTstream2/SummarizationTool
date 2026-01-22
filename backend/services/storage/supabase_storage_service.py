"""
Supabase Storage Service for SummarizationTool

This service provides integration with self-hosted Supabase for:
- Database operations via PostgREST API
- File storage operations via Storage API
- User data management (files, prompts, settings)
"""

import os
import httpx
from typing import Optional, Dict, Any, List
from datetime import datetime
import json


class SupabaseStorageService:
    """
    Service for interacting with self-hosted Supabase Storage and Database.
    
    Uses the PostgREST API for database operations and the Storage API for file operations.
    All operations use the SERVICE_ROLE_KEY for backend operations.
    """

    def __init__(self):
        """Initialize Supabase connection with environment variables."""
        self.supabase_url = os.getenv("SUPABASE_URL", "http://localhost:8000")
        self.service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        self.anon_key = os.getenv("SUPABASE_ANON_KEY")
        
        if not self.service_role_key:
            print("Warning: SUPABASE_SERVICE_ROLE_KEY not configured. Supabase operations will fail.")
        
        # API endpoints
        self.rest_url = f"{self.supabase_url}/rest/v1"
        self.storage_url = f"{self.supabase_url}/storage/v1"
        self.auth_url = f"{self.supabase_url}/auth/v1"

    @property
    def is_configured(self) -> bool:
        """Check if Supabase is properly configured."""
        return self.service_role_key is not None

    def _get_headers(self, use_service_role: bool = True) -> Dict[str, str]:
        """Get headers for API requests."""
        key = self.service_role_key if use_service_role else self.anon_key
        return {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }

    # ==================== Database Operations ====================

    async def query(
        self, 
        table: str, 
        select: str = "*",
        filters: Optional[Dict[str, Any]] = None,
        order: Optional[str] = None,
        limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Query a table using PostgREST.
        
        Args:
            table: Table name
            select: Columns to select (default: all)
            filters: Filter conditions as key-value pairs (e.g., {"user_id": "eq.uuid"})
            order: Order by column (e.g., "created_at.desc")
            limit: Maximum number of rows to return
            
        Returns:
            List of records matching the query
        """
        url = f"{self.rest_url}/{table}"
        params = {"select": select}
        
        if filters:
            params.update(filters)
        if order:
            params["order"] = order
        if limit:
            params["limit"] = str(limit)
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=self._get_headers(), params=params)
            response.raise_for_status()
            return response.json()

    async def insert(self, table: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Insert a record into a table.
        
        Args:
            table: Table name
            data: Record data
            
        Returns:
            The inserted record
        """
        url = f"{self.rest_url}/{table}"
        
        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=self._get_headers(), json=data)
            response.raise_for_status()
            result = response.json()
            return result[0] if isinstance(result, list) and len(result) > 0 else result

    async def update(
        self, 
        table: str, 
        data: Dict[str, Any],
        filters: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Update records in a table.
        
        Args:
            table: Table name
            data: Fields to update
            filters: Filter conditions
            
        Returns:
            List of updated records
        """
        url = f"{self.rest_url}/{table}"
        params = filters
        
        async with httpx.AsyncClient() as client:
            response = await client.patch(url, headers=self._get_headers(), json=data, params=params)
            response.raise_for_status()
            return response.json()

    async def upsert(self, table: str, data: Dict[str, Any], on_conflict: str = "id") -> Dict[str, Any]:
        """
        Upsert a record (insert or update if exists).
        
        Args:
            table: Table name
            data: Record data
            on_conflict: Column to check for conflicts (default: id)
            
        Returns:
            The upserted record
        """
        url = f"{self.rest_url}/{table}"
        headers = self._get_headers()
        headers["Prefer"] = "resolution=merge-duplicates,return=representation"
        
        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, json=data)
            response.raise_for_status()
            result = response.json()
            return result[0] if isinstance(result, list) and len(result) > 0 else result

    async def delete(self, table: str, filters: Dict[str, Any]) -> bool:
        """
        Delete records from a table.
        
        Args:
            table: Table name
            filters: Filter conditions
            
        Returns:
            True if successful
        """
        url = f"{self.rest_url}/{table}"
        
        async with httpx.AsyncClient() as client:
            response = await client.delete(url, headers=self._get_headers(), params=filters)
            response.raise_for_status()
            return True

    # ==================== Global Files Operations ====================

    async def get_file_by_hash(self, file_hash: str) -> Optional[Dict[str, Any]]:
        """
        Check if a file with the given hash already exists globally.
        
        Args:
            file_hash: SHA-256 hash of the file
            
        Returns:
            File record if exists, None otherwise
        """
        results = await self.query(
            table="global_files",
            filters={"file_hash": f"eq.{file_hash}"},
            limit=1
        )
        return results[0] if results else None

    async def register_global_file(
        self,
        file_hash: str,
        original_filename: str,
        file_size: int,
        storage_path: str,
        mime_type: str = "application/pdf"
    ) -> Dict[str, Any]:
        """
        Register a new file in the global files table.
        
        Args:
            file_hash: SHA-256 hash of the file
            original_filename: Original filename
            file_size: File size in bytes
            storage_path: Path to the stored file
            mime_type: MIME type of the file
            
        Returns:
            The created file record
        """
        data = {
            "file_hash": file_hash,
            "original_filename": original_filename,
            "file_size": file_size,
            "storage_path": storage_path,
            "mime_type": mime_type
        }
        return await self.insert("global_files", data)

    async def update_file_processing(
        self,
        file_id: str,
        conversion_id: str,
        processor_used: str,
        markdown_path: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Update file with processing information.
        
        Args:
            file_id: UUID of the global file
            conversion_id: UUID of the conversion
            processor_used: Processor name (azure_doc_intelligence or docling)
            markdown_path: Path to the markdown output
            metadata: Additional metadata
            
        Returns:
            Updated file record
        """
        data = {
            "conversion_id": conversion_id,
            "processor_used": processor_used,
            "processed_at": datetime.utcnow().isoformat(),
        }
        if markdown_path:
            data["markdown_path"] = markdown_path
        if metadata:
            data["metadata"] = json.dumps(metadata)
        
        results = await self.update("global_files", data, {"id": f"eq.{file_id}"})
        return results[0] if results else None

    # ==================== User Files Operations ====================

    async def add_user_file(
        self,
        user_id: str,
        file_id: str,
        nickname: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Associate a file with a user.
        
        Args:
            user_id: User UUID
            file_id: Global file UUID
            nickname: Optional user-defined name
            
        Returns:
            The created user-file association
        """
        data = {
            "user_id": user_id,
            "file_id": file_id
        }
        if nickname:
            data["nickname"] = nickname
        
        return await self.insert("user_files", data)

    async def get_user_files(self, user_id: str) -> List[Dict[str, Any]]:
        """
        Get all files associated with a user.
        
        Args:
            user_id: User UUID
            
        Returns:
            List of user-file associations with file details
        """
        return await self.query(
            table="user_files",
            select="*, global_files(*)",
            filters={"user_id": f"eq.{user_id}"},
            order="last_accessed_at.desc"
        )

    async def update_user_file_access(self, user_id: str, file_id: str) -> None:
        """Update the last accessed timestamp for a user-file association."""
        await self.update(
            "user_files",
            {"last_accessed_at": datetime.utcnow().isoformat()},
            {"user_id": f"eq.{user_id}", "file_id": f"eq.{file_id}"}
        )

    async def user_has_file(self, user_id: str, file_id: str) -> bool:
        """Check if a user already has access to a file."""
        results = await self.query(
            table="user_files",
            filters={"user_id": f"eq.{user_id}", "file_id": f"eq.{file_id}"},
            limit=1
        )
        return len(results) > 0

    # ==================== User Prompts Operations ====================

    async def get_user_prompts(
        self, 
        user_id: str, 
        prompt_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Get user's saved prompts.
        
        Args:
            user_id: User UUID
            prompt_type: Optional filter by prompt type
            
        Returns:
            List of user prompts
        """
        filters = {"user_id": f"eq.{user_id}"}
        if prompt_type:
            filters["prompt_type"] = f"eq.{prompt_type}"
        
        return await self.query(
            table="user_prompts",
            filters=filters,
            order="created_at.desc"
        )

    async def save_user_prompt(
        self,
        user_id: str,
        name: str,
        prompt_type: str,
        content: str,
        is_default: bool = False
    ) -> Dict[str, Any]:
        """
        Save a user prompt.
        
        Args:
            user_id: User UUID
            name: Prompt name
            prompt_type: Type of prompt (extraction, summary, etc.)
            content: Prompt content
            is_default: Whether this is the default prompt for this type
            
        Returns:
            The created prompt record
        """
        data = {
            "user_id": user_id,
            "name": name,
            "prompt_type": prompt_type,
            "content": content,
            "is_default": is_default
        }
        return await self.insert("user_prompts", data)

    async def update_user_prompt(
        self,
        prompt_id: str,
        user_id: str,
        updates: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a user prompt."""
        updates["updated_at"] = datetime.utcnow().isoformat()
        results = await self.update(
            "user_prompts",
            updates,
            {"id": f"eq.{prompt_id}", "user_id": f"eq.{user_id}"}
        )
        return results[0] if results else None

    async def delete_user_prompt(self, prompt_id: str, user_id: str) -> bool:
        """Delete a user prompt."""
        return await self.delete(
            "user_prompts",
            {"id": f"eq.{prompt_id}", "user_id": f"eq.{user_id}"}
        )

    # ==================== User Settings Operations ====================

    async def get_user_settings(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user settings."""
        results = await self.query(
            table="user_settings",
            filters={"user_id": f"eq.{user_id}"},
            limit=1
        )
        return results[0] if results else None

    async def save_user_settings(
        self,
        user_id: str,
        default_processor: Optional[str] = None,
        default_llm_model: Optional[str] = None,
        preferences: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Save or update user settings (upsert).
        
        Args:
            user_id: User UUID
            default_processor: Default document processor
            default_llm_model: Default LLM model
            preferences: Additional preferences as JSON
            
        Returns:
            The saved settings record
        """
        data = {
            "user_id": user_id,
            "updated_at": datetime.utcnow().isoformat()
        }
        if default_processor:
            data["default_processor"] = default_processor
        if default_llm_model:
            data["default_llm_model"] = default_llm_model
        if preferences:
            data["preferences"] = json.dumps(preferences)
        
        return await self.upsert("user_settings", data, on_conflict="user_id")


# Singleton instance
_supabase_service: Optional[SupabaseStorageService] = None


def get_supabase_service() -> SupabaseStorageService:
    """Get or create the Supabase storage service singleton."""
    global _supabase_service
    if _supabase_service is None:
        _supabase_service = SupabaseStorageService()
    return _supabase_service
