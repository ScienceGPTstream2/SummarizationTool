"""Shared enums for the application"""

from enum import Enum


class ProcessorType(str, Enum):
    """Document processor types"""

    AUTO = "auto"
    DOCLING = "docling"
    AZURE_DOC_INTELLIGENCE = "azure_doc_intelligence"
