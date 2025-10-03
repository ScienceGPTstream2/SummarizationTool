#!/usr/bin/env python3
"""
Test script for Azure Document Intelligence
Tests the Azure Document Intelligence service with a local PDF file
"""
import asyncio
import sys
from pathlib import Path

# Add the backend directory to Python path
sys.path.append(str(Path(__file__).parent.parent))

# Load configuration first
from core.config import load_config
load_config()

# Import Azure Document Intelligence service
from services.document.processors.azure_doc_intelligence.azure_doc_intelligence_service import AzureDocIntelligenceService

async def test_azure_doc_intelligence(pdf_path: str):
    """Test Azure Document Intelligence with the provided PDF"""
    
    print("🚀 Testing Azure Document Intelligence")
    print(f"📄 PDF File: {pdf_path}")
    print("-" * 50)
    
    # Check if file exists
    if not Path(pdf_path).exists():
        print(f"❌ Error: File not found: {pdf_path}")
        return 1
    
    # Initialize service
    service = AzureDocIntelligenceService()
    
    # Check if service is available
    if not service.is_available():
        print("❌ Azure Document Intelligence service is not available")
        print("   Please check your configuration in backend/core/secrets.toml:")
        print("   [azure_doc_intelligence]")
        print("   endpoint = \"https://your-resource.cognitiveservices.azure.com/\"")
        print("   key = \"your-key-here\"")
        return 1
    
    print("✅ Azure Document Intelligence service is configured and available")
    print("🔄 Starting document conversion...")
    
    # Convert document
    try:
        result = await service.convert_document_to_markdown(pdf_path, "file")
        
        if result.get("success"):
            print("\n🎉 Conversion succeeded!")
            print(f"📋 Conversion ID: {result['conversion_id']}")
            print(f"📁 Markdown saved to: {result['markdown_path']}")
            print(f"📊 Content length: {result['metadata']['content_length']} characters")
            print(f"⏱️  Conversion time: {result['metadata']['conversion_time']:.2f} seconds")
            print(f"📄 Pages processed: {result['metadata']['page_count']}")
            print(f"📋 Tables found: {result['metadata']['tables_found']}")
            print(f"🔑 Key-value pairs found: {result['metadata']['key_value_pairs_found']}")
            
            # Show full markdown content
            try:
                with open(result['markdown_path'], 'r', encoding='utf-8') as f:
                    content = f.read()
                    print(f"\n📝 Full Markdown Content:")
                    print("=" * 50)
                    print(content)
                    print("=" * 50)
            except Exception as e:
                print(f"⚠️  Could not read markdown file: {e}")
            
            return 0
            
        else:
            print(f"❌ Conversion failed: {result.get('error', 'Unknown error')}")
            return 1
            
    except Exception as e:
        print(f"❌ Error during conversion: {str(e)}")
        return 1

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python test_azure_doc_intel.py <pdf_file_path>")
        print("Example: python test_azure_doc_intel.py /path/to/document.pdf")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    exit_code = asyncio.run(test_azure_doc_intelligence(pdf_path))
    sys.exit(exit_code)