"""Docling-based document processing — remote-only mode.

The docling library is no longer installed in the backend image.
All conversions are dispatched to the remote docling-service via HTTP.
Configure via DOCLING_SERVICE_URL env var.
"""

from .docling_remote_client import DoclingRemoteClient

# Keep the name DoclingService as an alias so existing imports don't break
DoclingService = DoclingRemoteClient

__all__ = ["DoclingRemoteClient", "DoclingService"]
