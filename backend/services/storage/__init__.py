"""
Storage Services Package

Provides BlobStorageClient for Azure Blob Storage (production) with automatic
fallback to local filesystem when AZURE_STORAGE_CONNECTION_STRING is not set.
"""

from services.storage.blob_storage import BlobStorageClient

__all__ = ["BlobStorageClient"]
