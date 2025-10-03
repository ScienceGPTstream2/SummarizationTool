"""
Azure Document Intelligence Service for PDF processing

This service uses Azure's Document Intelligence to extract 
structured content from PDF documents. It provides an alternative to Docling for 
document processing with potentially better handling of complex layouts, tables, 
and structured documents.

Key Features:
- Superior table extraction
- Form field recognition
- Multi-language support
- Layout analysis with reading order
- Handwriting recognition
- Key-value pair extraction
"""
import os
import uuid
import json
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List

try:
    from azure.ai.documentintelligence import DocumentIntelligenceClient
    from azure.ai.documentintelligence.models import AnalyzeDocumentRequest
    from azure.core.credentials import AzureKeyCredential
    AZURE_DOC_INTELLIGENCE_AVAILABLE = True
except ImportError:
    AZURE_DOC_INTELLIGENCE_AVAILABLE = False
    print("Azure Document Intelligence SDK not installed. Install with: pip install azure-ai-documentintelligence azure-core")

class AzureDocIntelligenceService:
    """Service for processing documents using Azure Document Intelligence"""
    
    def __init__(self):
        self.base_path = Path(__file__).parent.parent.parent.parent.parent
        self.markdown_output_dir = self.base_path / "markdown_output"
        self.logs_dir = self.base_path / "logs" / "azure_doc_intelligence"
        self.metadata_dir = self.base_path / "metadata" / "azure_doc_intelligence"
        
        # Create directories
        for directory in [self.markdown_output_dir, self.logs_dir, self.metadata_dir]:
            directory.mkdir(parents=True, exist_ok=True)
        
        # Initialize Azure client
        self.client = self._init_client()
    
    def _init_client(self) -> Optional[DocumentIntelligenceClient]:
        """Initialize Azure Document Intelligence client"""
        if not AZURE_DOC_INTELLIGENCE_AVAILABLE:
            return None
        
        endpoint = os.getenv("AZURE_DOC_INTELLIGENCE_ENDPOINT")
        key = os.getenv("AZURE_DOC_INTELLIGENCE_KEY")
        
        if not endpoint or not key:
            print("Azure Document Intelligence credentials not found. Set AZURE_DOC_INTELLIGENCE_ENDPOINT and AZURE_DOC_INTELLIGENCE_KEY")
            return None
        
        try:
            return DocumentIntelligenceClient(
                endpoint=endpoint,
                credential=AzureKeyCredential(key)
            )
        except Exception as e:
            print(f"Failed to initialize Azure Document Intelligence client: {e}")
            return None
    
    async def convert_document_to_markdown(self, source: str, source_type: str = "file") -> Dict[str, Any]:
        """
        Convert document to markdown using Azure Document Intelligence
        
        Args:
            source: File path or URL
            source_type: "file" or "url"
            
        Returns:
            Dict with conversion results
        """
        if not self.client:
            return {
                "success": False,
                "error": "Azure Document Intelligence client not available",
                "conversion_id": str(uuid.uuid4())
            }
        
        conversion_id = str(uuid.uuid4())
        start_time = datetime.now()
        
        try:
            # Log start
            log_path = self.logs_dir / f"{conversion_id}.log"
            await self._log(log_path, f"Starting Azure Document Intelligence conversion: {source}")
            
            # Analyze document - Updated API format
            if source_type == "file":
                with open(source, "rb") as f:
                    file_content = f.read()
                # Use the correct API format
                poller = self.client.begin_analyze_document(
                    model_id="prebuilt-layout",
                    body=file_content,
                    content_type="application/octet-stream",
                    output_content_format="markdown"
                )
            else:  # URL
                # For URL, use AnalyzeDocumentRequest
                analyze_request = AnalyzeDocumentRequest(url_source=source)
                poller = self.client.begin_analyze_document(
                    model_id="prebuilt-layout",
                    analyze_request=analyze_request,
                    output_content_format="markdown"
                )
            
            await self._log(log_path, "Document analysis started...")
            
            # Wait for completion
            result = poller.result()
            await self._log(log_path, "Document analysis completed")
            
            # Extract markdown content
            markdown_content = result.content if result.content else ""
            
            # Save markdown
            markdown_filename = f"{conversion_id}.md"
            markdown_path = self.markdown_output_dir / markdown_filename
            
            with open(markdown_path, "w", encoding="utf-8") as f:
                f.write(markdown_content)
            
            # Create metadata
            end_time = datetime.now()
            conversion_time = (end_time - start_time).total_seconds()
            
            metadata = {
                "conversion_id": conversion_id,
                "source": source,
                "source_type": source_type,
                "processor": "azure_doc_intelligence",
                "model_id": "prebuilt-layout",
                "status": "success",
                "markdown_path": str(markdown_path),
                "log_path": str(log_path),
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat(),
                "conversion_time": conversion_time,
                "content_length": len(markdown_content),
                "page_count": len(result.pages) if result.pages else 0,
                "tables_found": len(result.tables) if result.tables else 0,
                "key_value_pairs_found": len(result.key_value_pairs) if result.key_value_pairs else 0
            }
            
            # Save metadata
            metadata_path = self.metadata_dir / f"{conversion_id}.json"
            with open(metadata_path, "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2)
            
            await self._log(log_path, f"Conversion completed successfully in {conversion_time:.2f}s")
            await self._log(log_path, f"Pages processed: {metadata['page_count']}")
            await self._log(log_path, f"Tables found: {metadata['tables_found']}")
            await self._log(log_path, f"Key-value pairs found: {metadata['key_value_pairs_found']}")
            
            return {
                "success": True,
                "conversion_id": conversion_id,
                "markdown_path": str(markdown_path),
                "metadata": {
                    "content_length": len(markdown_content),
                    "conversion_time": conversion_time,
                    "page_count": metadata['page_count'],
                    "tables_found": metadata['tables_found'],
                    "key_value_pairs_found": metadata['key_value_pairs_found']
                }
            }
            
        except Exception as e:
            error_msg = f"Azure Document Intelligence conversion failed: {str(e)}"
            await self._log(log_path, f"ERROR: {error_msg}")
            
            # Save error metadata
            metadata = {
                "conversion_id": conversion_id,
                "source": source,
                "source_type": source_type,
                "processor": "azure_doc_intelligence",
                "status": "error",
                "error": error_msg,
                "log_path": str(log_path),
                "start_time": start_time.isoformat(),
                "end_time": datetime.now().isoformat()
            }
            
            metadata_path = self.metadata_dir / f"{conversion_id}.json"
            with open(metadata_path, "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2)
            
            return {
                "success": False,
                "error": error_msg,
                "conversion_id": conversion_id
            }
    
    async def _log(self, log_path: Path, message: str):
        """Write log message"""
        timestamp = datetime.now().isoformat()
        log_entry = f"[{timestamp}] {message}\n"
        
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(log_entry)
    
    async def get_conversion_by_id(self, conversion_id: str) -> Optional[Dict[str, Any]]:
        """Get conversion metadata by ID"""
        metadata_path = self.metadata_dir / f"{conversion_id}.json"
        
        if not metadata_path.exists():
            return None
        
        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    
    async def get_markdown_content(self, conversion_id: str) -> Optional[str]:
        """Get markdown content by conversion ID"""
        markdown_path = self.markdown_output_dir / f"{conversion_id}.md"
        
        if not markdown_path.exists():
            return None
        
        try:
            with open(markdown_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            return None
    
    def is_available(self) -> bool:
        """Check if Azure Document Intelligence is available and configured"""
        return AZURE_DOC_INTELLIGENCE_AVAILABLE and self.client is not None