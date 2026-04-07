"""
Azure Blob Storage client for persistent file storage.

Requires AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER_NAME.
The container is created automatically on first upload if it does not exist
(handles fresh Azurite instances in local dev and newly provisioned Azure accounts).

Container structure:
  global/{file_hash}/original.{ext}
  global/{file_hash}/metadata.json
  global/{file_hash}/processed/{processor}/document.md
  global/{file_hash}/processed/{processor}/figures/...
  global/{file_hash}/processed/{processor}/tables/...
"""

import asyncio
import os
from pathlib import Path
from typing import Optional


class BlobStorageClient:
    """Async Azure Blob Storage client."""

    def __init__(self, connection_string: str, container_name: str):
        from azure.storage.blob.aio import BlobServiceClient

        self._service = BlobServiceClient.from_connection_string(connection_string)
        self._container = container_name

    async def _ensure_container(self) -> None:
        """Create the container if it does not exist (idempotent)."""
        from azure.core.exceptions import ResourceExistsError

        try:
            await self._service.create_container(self._container)
        except ResourceExistsError:
            pass

    async def upload_bytes(
        self, blob_path: str, data: bytes, overwrite: bool = True
    ) -> None:
        from azure.core.exceptions import ResourceNotFoundError

        try:
            async with self._service.get_blob_client(self._container, blob_path) as blob:
                await blob.upload_blob(data, overwrite=overwrite)
        except ResourceNotFoundError:
            # Container doesn't exist yet — create it and retry once
            await self._ensure_container()
            async with self._service.get_blob_client(self._container, blob_path) as blob:
                await blob.upload_blob(data, overwrite=overwrite)

    async def download_bytes(self, blob_path: str) -> Optional[bytes]:
        try:
            async with self._service.get_blob_client(
                self._container, blob_path
            ) as blob:
                stream = await blob.download_blob()
                return await stream.readall()
        except Exception:
            return None

    async def exists(self, blob_path: str) -> bool:
        try:
            async with self._service.get_blob_client(
                self._container, blob_path
            ) as blob:
                return await blob.exists()
        except Exception:
            return False

    async def upload_directory(self, blob_prefix: str, local_dir: Path) -> None:
        """Upload all files under local_dir to blob, preserving relative structure."""
        tasks = []
        for local_file in local_dir.rglob("*"):
            if local_file.is_file():
                rel = local_file.relative_to(local_dir)
                blob_path = f"{blob_prefix}/{rel}".replace("\\", "/")
                tasks.append(self.upload_bytes(blob_path, local_file.read_bytes()))
        if tasks:
            await asyncio.gather(*tasks)

    @classmethod
    def from_env(cls) -> Optional["BlobStorageClient"]:
        """Create client from environment variables, or return None if not configured."""
        conn_str = os.environ.get("AZURE_STORAGE_CONNECTION_STRING")
        if not conn_str:
            return None
        container = os.environ.get(
            "AZURE_STORAGE_CONTAINER_NAME", "summarization-uploads"
        )
        return cls(conn_str, container)
