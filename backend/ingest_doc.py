#!/usr/bin/env python3
"""
Simple standalone ingestion script that uses the backend DoclingService to
convert a document (local file or URL) to Markdown and save it under the
backend/markdown_output directory.

Usage:
    # From repository root
    python3 Summarization_tool/backend/ingest_doc.py --url https://arxiv.org/pdf/2408.09869

    # Or for a local file
    python3 Summarization_tool/backend/ingest_doc.py --file /path/to/file.pdf
"""
import argparse
import asyncio
from pathlib import Path
import sys

# Import the service from the backend package
from services.docling_service import DoclingService

async def run_conversion_url(url: str):
    svc = DoclingService()
    print(f"Converting URL: {url}")
    result = await svc.convert_document_to_markdown(url, source_type="url")
    if result.get("success"):
        print("Conversion succeeded.")
        print(f"Conversion ID: {result['conversion_id']}")
        print(f"Saved markdown path: {result['markdown_path']}")
        return 0
    else:
        print("Conversion failed:", result.get("error"))
        return 2

async def run_conversion_file(file_path: str):
    p = Path(file_path)
    if not p.exists():
        print(f"File not found: {file_path}", file=sys.stderr)
        return 3
    svc = DoclingService()
    print(f"Converting file: {file_path}")
    result = await svc.convert_document_to_markdown(str(p), source_type="file")
    if result.get("success"):
        print("Conversion succeeded.")
        print(f"Conversion ID: {result['conversion_id']}")
        print(f"Saved markdown path: {result['markdown_path']}")
        return 0
    else:
        print("Conversion failed:", result.get("error"))
        return 2

def parse_args():
    parser = argparse.ArgumentParser(description="Ingest document via Docling and save markdown locally.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--url", "-u", help="URL of the document to convert (e.g. https://arxiv.org/pdf/...)")
    group.add_argument("--file", "-f", help="Local PDF file path to convert")
    return parser.parse_args()

def main():
    args = parse_args()
    if args.url:
        exit_code = asyncio.run(run_conversion_url(args.url))
        sys.exit(exit_code)
    elif args.file:
        exit_code = asyncio.run(run_conversion_file(args.file))
        sys.exit(exit_code)

if __name__ == "__main__":
    main()
