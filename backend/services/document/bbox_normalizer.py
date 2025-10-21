"""
Bounding Box Format Normalizer

Ensures both Azure Document Intelligence and Docling output
the same structure for frontend consumption.
"""

from typing import Dict, Any, List, Optional


def normalize_bbox_format(analysis_result: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize bounding box format to a consistent structure for frontend

    This ensures both Docling and Azure DI produce identical output structure:
    - All keys in snake_case
    - Page dimensions always in points (pt)
    - Consistent polygon format (8 values)
    - Consistent field names across processors

    Args:
        analysis_result: Raw analysis from either processor

    Returns:
        Normalized analysis with consistent structure
    """
    processor = analysis_result.get("processor", "unknown")

    # Auto-detect format if processor field is missing
    if processor == "unknown":
        processor = _detect_processor(analysis_result)

    if processor == "docling":
        return _normalize_docling_format(analysis_result)
    elif processor == "azure_doc_intelligence":
        return _normalize_azure_format(analysis_result)
    else:
        # Unknown processor, return as-is
        return analysis_result


def _detect_processor(data: Dict[str, Any]) -> str:
    """
    Auto-detect which processor generated the data based on structure.

    Azure DI characteristics:
    - Has 'apiVersion' and 'modelId' fields
    - Has 'boundingRegions' (camelCase)
    - Pages have 'unit' field

    Docling characteristics:
    - Has 'api_version' (snake_case)
    - Has 'bounding_regions' (snake_case)
    - May have 'document_structure'
    """
    # Check for Azure DI specific fields
    if "apiVersion" in data or "modelId" in data:
        return "azure_doc_intelligence"

    # Check for Docling specific fields
    if "api_version" in data or "document_structure" in data:
        return "docling"

    # Check field naming convention in paragraphs
    if data.get("paragraphs"):
        first_para = data["paragraphs"][0]
        if "boundingRegions" in first_para:  # camelCase = Azure DI
            return "azure_doc_intelligence"
        elif "bounding_regions" in first_para:  # snake_case = Docling
            return "docling"

    return "unknown"


def _normalize_docling_format(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize Docling format
    Docling is already mostly in the right format, just needs minor adjustments
    """
    normalized = {
        "processor": "docling",
        "api_version": data.get("api_version", "2.0"),
        "model_id": data.get("model_id", "docling-document"),
        "pages": [],
        "paragraphs": [],
        "tables": [],
        "figures": [],
    }

    # Normalize pages
    for page in data.get("pages", []):
        normalized["pages"].append(
            {
                "page_number": page.get("page_number"),
                "width": page.get("width"),
                "height": page.get("height"),
                "unit": page.get("unit", "pt"),
                "angle": 0,  # Docling doesn't provide angle
            }
        )

    # Normalize paragraphs
    for para in data.get("paragraphs", []):
        normalized["paragraphs"].append(
            {
                "id": para.get("id"),
                "content": para.get("content", ""),
                "role": para.get("role", "paragraph"),
                "bounding_regions": para.get("bounding_regions", []),
            }
        )

    # Normalize tables
    for table in data.get("tables", []):
        normalized["tables"].append(
            {
                "id": table.get("id"),
                "row_count": table.get("row_count", 0),
                "column_count": table.get("column_count", 0),
                "cells": table.get("cells", []),
                "bounding_regions": table.get("bounding_regions", []),
            }
        )

    # Normalize figures
    for figure in data.get("figures", []):
        normalized["figures"].append(
            {
                "id": figure.get("id"),
                "caption": figure.get("caption", {}),
                "bounding_regions": figure.get("bounding_regions", []),
            }
        )

    return normalized


def _normalize_azure_format(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize Azure Document Intelligence format
    Converts from camelCase to snake_case and ensures consistent structure
    """
    normalized = {
        "processor": "azure_doc_intelligence",
        "api_version": data.get("apiVersion", "2024-11-30"),
        "model_id": data.get("modelId", "prebuilt-layout"),
        "pages": [],
        "paragraphs": [],
        "tables": [],
        "figures": [],
    }

    # Normalize pages - convert inches to points if needed
    for page in data.get("pages", []):
        unit = page.get("unit", "inch")
        width = page.get("width", 0)
        height = page.get("height", 0)

        # Convert to points if in inches
        if unit == "inch":
            width = width * 72
            height = height * 72
            unit = "pt"

        normalized["pages"].append(
            {
                "page_number": page.get("pageNumber"),
                "width": width,
                "height": height,
                "unit": unit,
                "angle": page.get("angle", 0),
            }
        )

    # Normalize paragraphs
    for para in data.get("paragraphs", []):
        # Transform bounding regions
        bounding_regions = []
        for region in para.get("boundingRegions", []):
            page_num = region.get("pageNumber")
            polygon = region.get("polygon", [])

            # Convert polygon coordinates from inches to points if needed
            page = next(
                (p for p in data.get("pages", []) if p.get("pageNumber") == page_num),
                None,
            )
            if page and page.get("unit") == "inch":
                polygon = [coord * 72 for coord in polygon]

            bounding_regions.append(
                {
                    "page_number": page_num,
                    "polygon": polygon,
                }
            )

        normalized["paragraphs"].append(
            {
                "id": f"para_{len(normalized['paragraphs'])}",  # Azure doesn't have IDs
                "content": para.get("content", ""),
                "role": _normalize_role(para.get("role", "paragraph")),
                "bounding_regions": bounding_regions,
            }
        )

    # Normalize tables
    for idx, table in enumerate(data.get("tables", [])):
        # Transform bounding regions
        bounding_regions = []
        for region in table.get("boundingRegions", []):
            page_num = region.get("pageNumber")
            polygon = region.get("polygon", [])

            # Convert polygon coordinates from inches to points if needed
            page = next(
                (p for p in data.get("pages", []) if p.get("pageNumber") == page_num),
                None,
            )
            if page and page.get("unit") == "inch":
                polygon = [coord * 72 for coord in polygon]

            bounding_regions.append(
                {
                    "page_number": page_num,
                    "polygon": polygon,
                }
            )

        normalized["tables"].append(
            {
                "id": f"table_{idx}",
                "row_count": table.get("rowCount", 0),
                "column_count": table.get("columnCount", 0),
                "cells": [
                    _normalize_cell(cell, data.get("pages", []))
                    for cell in table.get("cells", [])
                ],
                "bounding_regions": bounding_regions,
            }
        )

    # Normalize figures
    for figure in data.get("figures", []):
        # Transform bounding regions
        bounding_regions = []
        for region in figure.get("boundingRegions", []):
            page_num = region.get("pageNumber")
            polygon = region.get("polygon", [])

            # Convert polygon coordinates from inches to points if needed
            page = next(
                (p for p in data.get("pages", []) if p.get("pageNumber") == page_num),
                None,
            )
            if page and page.get("unit") == "inch":
                polygon = [coord * 72 for coord in polygon]

            bounding_regions.append(
                {
                    "page_number": page_num,
                    "polygon": polygon,
                }
            )

        caption_content = None
        if figure.get("caption"):
            caption_content = figure["caption"].get("content")

        normalized["figures"].append(
            {
                "id": figure.get("id", f"figure_{len(normalized['figures'])}"),
                "caption": {"content": caption_content},
                "bounding_regions": bounding_regions,
            }
        )

    return normalized


def _normalize_cell(
    cell: Dict[str, Any], pages: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """Normalize table cell from Azure format"""
    # Transform bounding regions for cells
    bounding_regions = []
    for region in cell.get("boundingRegions", []):
        page_num = region.get("pageNumber")
        polygon = region.get("polygon", [])

        # Convert polygon coordinates from inches to points if needed
        page = next((p for p in pages if p.get("pageNumber") == page_num), None)
        if page and page.get("unit") == "inch":
            polygon = [coord * 72 for coord in polygon]

        bounding_regions.append(
            {
                "page_number": page_num,
                "polygon": polygon,
            }
        )

    return {
        "row_index": cell.get("rowIndex", 0),
        "column_index": cell.get("columnIndex", 0),
        "row_span": cell.get("rowSpan", 1),
        "column_span": cell.get("columnSpan", 1),
        "content": cell.get("content", ""),
        "kind": cell.get("kind", "content"),
        "bounding_regions": bounding_regions,
    }


def _normalize_role(role: str) -> str:
    """
    Normalize role names to snake_case

    Azure DI uses camelCase: pageHeader, sectionHeading
    Docling uses snake_case: page_header, section_header

    Standardize to snake_case for consistency
    """
    # Convert camelCase to snake_case
    import re

    s1 = re.sub("(.)([A-Z][a-z]+)", r"\1_\2", role)
    return re.sub("([a-z0-9])([A-Z])", r"\1_\2", s1).lower()
