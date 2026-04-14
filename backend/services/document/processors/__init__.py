"""Document processors for different PDF processing methods"""

from .docling import DoclingRemoteClient, DoclingService
from .azure_doc_intelligence import AzureDocIntelligenceService

__all__ = [
    "DoclingRemoteClient",
    "DoclingService",  # alias for DoclingRemoteClient
    "AzureDocIntelligenceService",
]
