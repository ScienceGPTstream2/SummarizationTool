"""Document processing services"""

from .file_service import FileService
from .document_service import DocumentService
from .processors.docling import DoclingRemoteClient, DoclingService
from .processors.azure_doc_intelligence.azure_doc_intelligence_service import (
    AzureDocIntelligenceService,
)
from .organized_file_service import OrganizedFileService, get_organized_file_service
from .organized_processor import OrganizedDocumentProcessor, get_organized_processor

__all__ = [
    "FileService",
    "DocumentService",
    "DoclingRemoteClient",
    "DoclingService",  # alias for DoclingRemoteClient
    "AzureDocIntelligenceService",
    "OrganizedFileService",
    "get_organized_file_service",
    "OrganizedDocumentProcessor",
    "get_organized_processor",
]
