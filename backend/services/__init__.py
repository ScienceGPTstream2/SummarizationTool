"""
Services package for the Document Summarization Tool.

This package contains all business logic services organized by domain:
- auth/: Authentication and authorization services
- document/: Document processing and file management services
- llm/: Large Language Model and AI provider services
"""

# Import all services for backward compatibility
from .auth import SupabaseAuthService
from .document import DoclingService, FileService
from .llm import LLMService, AzureLLMClient, GeminiLLMClient

__all__ = [
    "SupabaseAuthService",
    "DoclingService",
    "FileService",
    "LLMService",
    "AzureLLMClient",
    "GeminiLLMClient",
]
