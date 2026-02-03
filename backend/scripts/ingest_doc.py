#!/usr/bin/env python3
"""
Simple standalone test script that uses Docling directly to convert a document
to Markdown format and print it to stdout.

Usage:
    # From backend directory
    python scripts/ingest_doc.py --url https://arxiv.org/pdf/2408.09869

    # Or for a local file
    python scripts/ingest_doc.py --file /path/to/file.pdf
"""

import argparse
from pathlib import Path
import sys

from docling.document_converter import DocumentConverter


def run_conversion_url(url: str):
    print(f"Converting URL: {url}", file=sys.stderr)
    converter = DocumentConverter()
    result = converter.convert(url)

    # Export to markdown
    markdown_content = result.document.export_to_markdown()

    print("\n" + "=" * 80, file=sys.stderr)
    print("MARKDOWN OUTPUT:", file=sys.stderr)
    print("=" * 80, file=sys.stderr)
    print(markdown_content)
    return 0


def run_conversion_file(file_path: str):
    p = Path(file_path)
    if not p.exists():
        print(f"File not found: {file_path}", file=sys.stderr)
        return 3

    print(f"Converting file: {file_path}", file=sys.stderr)
    converter = DocumentConverter()
    result = converter.convert(str(p))

    # Export to markdown
    markdown_content = result.document.export_to_markdown()

    print("\n" + "=" * 80, file=sys.stderr)
    print("MARKDOWN OUTPUT:", file=sys.stderr)
    print("=" * 80, file=sys.stderr)
    print(markdown_content)
    return 0


def parse_args():
    parser = argparse.ArgumentParser(
        description="Convert document to Markdown using Docling and print to stdout."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--url",
        "-u",
        help="URL of the document to convert (e.g. https://arxiv.org/pdf/...)",
    )
    group.add_argument("--file", "-f", help="Local PDF file path to convert")
    return parser.parse_args()


def main():
    args = parse_args()
    if args.url:
        exit_code = run_conversion_url(args.url)
        sys.exit(exit_code)
    elif args.file:
        exit_code = run_conversion_file(args.file)
        sys.exit(exit_code)


if __name__ == "__main__":
    main()
