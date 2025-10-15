#!/usr/bin/env python3
"""
Analyze PDF with Azure Document Intelligence and Visualize Bounding Boxes

This script:
1. Analyzes a PDF using Azure Document Intelligence layout model
2. Saves the raw JSON response
3. Generates an annotated PDF with bounding boxes visualized

Usage:
    python analyze_and_visualize_pdf.py --pdf input.pdf --output-dir ./output
"""

import os
import sys
import json
import argparse
import asyncio
from pathlib import Path
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from azure.ai.documentintelligence import DocumentIntelligenceClient
    from azure.core.credentials import AzureKeyCredential

    AZURE_AVAILABLE = True
except ImportError:
    AZURE_AVAILABLE = False
    print("⚠️  Azure Document Intelligence SDK not installed")
    print("Install with: pip install azure-ai-documentintelligence azure-core")

from utils.pdf_bbox_visualizer import PDFBBoxVisualizer


class DocumentAnalyzer:
    """Analyzes documents using Azure Document Intelligence"""

    def __init__(self):
        """Initialize the analyzer with Azure credentials"""
        if not AZURE_AVAILABLE:
            raise ImportError("Azure Document Intelligence SDK is not available")

        self.endpoint = os.getenv("AZURE_DOC_INTELLIGENCE_ENDPOINT")
        self.key = os.getenv("AZURE_DOC_INTELLIGENCE_KEY")

        if not self.endpoint or not self.key:
            raise ValueError(
                "Azure credentials not found. Set environment variables:\n"
                "  AZURE_DOC_INTELLIGENCE_ENDPOINT\n"
                "  AZURE_DOC_INTELLIGENCE_KEY"
            )

        self.client = DocumentIntelligenceClient(
            endpoint=self.endpoint, credential=AzureKeyCredential(self.key)
        )

    def analyze_pdf(self, pdf_path: str, output_json_path: str) -> dict:
        """
        Analyze a PDF and save the JSON result

        Args:
            pdf_path: Path to the PDF file
            output_json_path: Path to save the JSON result

        Returns:
            The analysis result as a dictionary
        """
        print(f"📄 Analyzing PDF: {pdf_path}")
        print("⏳ This may take a minute...")

        start_time = datetime.now()

        # Read the PDF file
        with open(pdf_path, "rb") as f:
            pdf_content = f.read()

        # Analyze with layout model
        # Include figures in the output
        poller = self.client.begin_analyze_document(
            model_id="prebuilt-layout",
            body=pdf_content,
            content_type="application/octet-stream",
            output=["figures"],  # Request figure extraction
        )

        result = poller.result()

        # Convert to dictionary for JSON serialization
        result_dict = result.as_dict()

        # Save JSON result
        output_json_path = Path(output_json_path)
        output_json_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_json_path, "w", encoding="utf-8") as f:
            json.dump(result_dict, f, indent=2, ensure_ascii=False)

        elapsed = (datetime.now() - start_time).total_seconds()

        print(f"✅ Analysis complete in {elapsed:.2f}s")
        print(f"📊 Pages analyzed: {len(result_dict.get('pages', []))}")
        print(f"📋 Tables found: {len(result_dict.get('tables', []))}")
        print(f"🖼️  Figures found: {len(result_dict.get('figures', []))}")
        print(f"📝 Paragraphs found: {len(result_dict.get('paragraphs', []))}")
        print(f"💾 Saved JSON to: {output_json_path}")

        return result_dict


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="Analyze PDF with Azure Document Intelligence and visualize bounding boxes"
    )
    parser.add_argument("--pdf", required=True, help="Path to the PDF file to analyze")
    parser.add_argument(
        "--output-dir",
        default="./pdf_analysis_output",
        help="Directory to save output files (default: ./pdf_analysis_output)",
    )
    parser.add_argument(
        "--elements",
        nargs="+",
        choices=[
            "words",
            "lines",
            "paragraphs",
            "tables",
            "figures",
            "selection_marks",
            "all",
        ],
        default=["paragraphs", "tables", "figures"],
        help="Element types to visualize (default: paragraphs tables figures)",
    )
    parser.add_argument(
        "--no-labels", action="store_true", help="Don't show labels on bounding boxes"
    )
    parser.add_argument(
        "--json-only",
        action="store_true",
        help="Only perform analysis and save JSON (skip visualization)",
    )

    args = parser.parse_args()

    # Check if PDF exists
    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        print(f"❌ Error: PDF file not found: {pdf_path}")
        sys.exit(1)

    # Create output directory
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Generate output filenames based on input PDF name
    pdf_stem = pdf_path.stem
    json_path = output_dir / f"{pdf_stem}_analysis.json"
    annotated_pdf_path = output_dir / f"{pdf_stem}_annotated.pdf"

    try:
        # Step 1: Analyze the PDF
        print("\n" + "=" * 60)
        print("STEP 1: Analyzing PDF with Azure Document Intelligence")
        print("=" * 60 + "\n")

        analyzer = DocumentAnalyzer()
        result_dict = analyzer.analyze_pdf(str(pdf_path), str(json_path))

        # Step 2: Visualize bounding boxes (unless json-only flag is set)
        if not args.json_only:
            print("\n" + "=" * 60)
            print("STEP 2: Visualizing Bounding Boxes")
            print("=" * 60 + "\n")

            # Handle "all" option
            if "all" in args.elements:
                elements = [
                    "words",
                    "lines",
                    "paragraphs",
                    "tables",
                    "figures",
                    "selection_marks",
                ]
            else:
                elements = args.elements

            print(f"🎨 Visualizing elements: {', '.join(elements)}")

            with PDFBBoxVisualizer(str(pdf_path), str(json_path)) as visualizer:
                visualizer.visualize_all(
                    elements=elements, show_labels=not args.no_labels
                )
                visualizer.save(str(annotated_pdf_path))

            print("\n" + "=" * 60)
            print("✅ ALL DONE!")
            print("=" * 60)
            print(f"\n📁 Output files:")
            print(f"   JSON result:     {json_path}")
            print(f"   Annotated PDF:   {annotated_pdf_path}")
        else:
            print("\n" + "=" * 60)
            print("✅ ANALYSIS COMPLETE (JSON only)")
            print("=" * 60)
            print(f"\n📁 Output file:")
            print(f"   JSON result:     {json_path}")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
