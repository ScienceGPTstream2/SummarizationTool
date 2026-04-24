"""
Services package for the Document Summarization Tool.

This package contains all business logic services organized by domain:
- document/: Document processing and file management services
- llm/: Large Language Model and AI provider services
- session/: Session management services
"""

from .document import DoclingRemoteClient, DoclingService, FileService
from .llm import LLMService, AzureLLMClient, GeminiLLMClient

__all__ = [
    "DoclingRemoteClient",
    "DoclingService",  # alias for DoclingRemoteClient
    "FileService",
    "LLMService",
    "AzureLLMClient",
    "GeminiLLMClient",
]
