import re
from typing import Dict, Any, List, Optional


def normalize_text(text: str) -> str:
    """Normalize text for comparison (remove extra whitespace, newlines, etc.)"""
    # Replace multiple whitespace/newlines with single space
    text = re.sub(r"\s+", " ", text)
    # Remove special characters that might differ
    text = text.strip()
    return text


def find_text_in_paragraphs(
    search_text: str, paragraphs: List[Dict[str, Any]], threshold: float = 0.6
) -> List[Dict[str, Any]]:
    """
    Find matching paragraphs for the search text in docling format.

    Args:
        search_text: Text to search for
        paragraphs: List of paragraph dictionaries from docling raw_analysis.json
        threshold: Minimum similarity threshold (0-1)

    Returns:
        List of matching paragraphs with bounding box information
    """
    normalized_search = normalize_text(search_text)
    matches = []

    for para in paragraphs:
        para_content = para.get("content", "")
        normalized_para = normalize_text(para_content)

        # Check for substring match (search text in paragraph or paragraph in search)
        if normalized_search in normalized_para or normalized_para in normalized_search:
            # Calculate similarity using character overlap
            search_chars = set(normalized_search.lower())
            para_chars = set(normalized_para.lower())
            overlap = len(search_chars & para_chars)
            similarity = overlap / max(len(search_chars), len(para_chars), 1)

            if similarity >= threshold:
                match_info = {
                    "paragraph_content": para_content,
                    "paragraph_id": para.get("id"),
                    "similarity": similarity,
                    "bounding_regions": para.get("bounding_regions", []),
                    "role": para.get("role"),
                }
                matches.append(match_info)
        # Also check for partial matches (if search text is long, check if significant portion matches)
        elif len(normalized_search) > 20:
            # Try to find if a significant portion of the search text appears in the paragraph
            search_words = set(normalized_search.lower().split())
            para_words = set(normalized_para.lower().split())
            if len(search_words) > 0:
                word_overlap = len(search_words & para_words)
                word_similarity = word_overlap / len(search_words)
                if word_similarity >= 0.5:  # At least 50% of words match
                    match_info = {
                        "paragraph_content": para_content,
                        "paragraph_id": para.get("id"),
                        "similarity": word_similarity,
                        "bounding_regions": para.get("bounding_regions", []),
                        "role": para.get("role"),
                    }
                    matches.append(match_info)

    return matches


def find_text_in_pages(
    search_text: str, pages: List[Dict[str, Any]], threshold: float = 0.5
) -> List[Dict[str, Any]]:
    """
    Find matching text in pages (for cases where paragraphs don't match but page content does).

    Args:
        search_text: Text to search for
        pages: List of page dictionaries from docling raw_analysis.json
        threshold: Minimum similarity threshold

    Returns:
        List of matching pages with page number information
    """
    normalized_search = normalize_text(search_text)
    matches = []

    for page in pages:
        page_number = page.get("page_number", 0)
        # Docling pages may have words/lines arrays, but they're often empty
        # We'll use this as a fallback if paragraph matching fails
        # For now, we'll just return page info if needed
        matches.append(
            {
                "page_number": page_number,
                "width": page.get("width"),
                "height": page.get("height"),
            }
        )

    return matches


def match_reference_to_bounding_box(
    reference_text: str,
    raw_analysis: Dict[str, Any],
    para_threshold: float = 0.6,
) -> Dict[str, Any]:
    """
    Match a single reference text to bounding boxes in the docling raw analysis.

    Args:
        reference_text: The text excerpt to match
        raw_analysis: The complete raw analysis dictionary from docling
        para_threshold: Minimum similarity threshold for paragraph matching

    Returns:
        Dictionary with matching information including bounding boxes
    """
    paragraphs = raw_analysis.get("paragraphs", [])
    pages = raw_analysis.get("pages", [])

    # Try to find in paragraphs (primary method for docling)
    para_matches = find_text_in_paragraphs(reference_text, paragraphs, para_threshold)

    result = {
        "text": reference_text,
        "paragraph_matches": para_matches,
        "best_match": None,
    }

    # Determine best match (prefer paragraph matches with highest similarity)
    if para_matches:
        best_para = max(para_matches, key=lambda x: x["similarity"])
        bounding_regions = best_para["bounding_regions"]
        # Format bounding box info
        bbox_info = []
        page_number = None
        for region in bounding_regions:
            page_num = region.get("page_number")
            if page_num and not page_number:
                page_number = page_num
            bbox_info.append(
                {
                    "page_number": page_num,
                    "polygon": region.get("polygon", []),
                }
            )

        result["best_match"] = {
            "type": "paragraph",
            "content": best_para["paragraph_content"],
            "paragraph_id": best_para.get("paragraph_id"),
            "similarity": best_para["similarity"],
            "page_number": page_number,  # Add page_number at top level for easy access
            "bounding_regions": bbox_info,
            "role": best_para.get("role"),
        }
    else:
        # If no paragraph match, try to find which page might contain it
        # This is a fallback - we can't get exact bounding boxes without paragraph match
        result["best_match"] = {
            "type": "page_fallback",
            "content": reference_text,
            "similarity": 0.0,
            "note": "No paragraph match found, unable to determine exact bounding box",
        }

    return result


def match_references_to_bounding_boxes(
    references: List[Dict[str, Any]],
    raw_analysis: Dict[str, Any],
    para_threshold: float = 0.6,
) -> List[Dict[str, Any]]:
    """
    Match multiple reference texts to bounding boxes in the docling raw analysis.

    Args:
        references: List of reference dictionaries, each with at least a 'text' field
        raw_analysis: The complete raw analysis dictionary from docling
        para_threshold: Minimum similarity threshold for paragraph matching

    Returns:
        List of dictionaries with matching information for each reference
    """
    results = []

    for ref_idx, ref in enumerate(references):
        ref_text = ref.get("text", "")
        if not ref_text:
            continue

        match_result = match_reference_to_bounding_box(
            ref_text, raw_analysis, para_threshold
        )

        # Add reference index and preserve any additional fields from the original reference
        match_result["reference_index"] = ref_idx
        if "context" in ref:
            match_result["context"] = ref["context"]

        results.append(match_result)

    return results


def extract_polygon_coordinates(polygon: List[float]) -> Dict[str, Any]:
    """
    Extract and format polygon coordinates from docling format.

    Docling polygons are arrays of [x1, y1, x2, y2, x3, y3, x4, y4] representing
    the four corners of a bounding box.

    Args:
        polygon: List of coordinates [x1, y1, x2, y2, x3, y3, x4, y4]

    Returns:
        Dictionary with formatted coordinate information
    """
    if not polygon or len(polygon) < 8:
        return {"valid": False, "coordinates": []}

    # Extract coordinates (assuming 4 points: top-left, top-right, bottom-right, bottom-left)
    coords = {
        "valid": True,
        "top_left": {"x": polygon[0], "y": polygon[1]},
        "top_right": {"x": polygon[2], "y": polygon[3]},
        "bottom_right": {"x": polygon[4], "y": polygon[5]},
        "bottom_left": {"x": polygon[6], "y": polygon[7]},
        "raw": polygon,
    }

    # Calculate bounding box dimensions
    x_coords = [polygon[i] for i in range(0, len(polygon), 2)]
    y_coords = [polygon[i] for i in range(1, len(polygon), 2)]

    if x_coords and y_coords:
        coords["width"] = max(x_coords) - min(x_coords)
        coords["height"] = max(y_coords) - min(y_coords)
        coords["x_min"] = min(x_coords)
        coords["y_min"] = min(y_coords)
        coords["x_max"] = max(x_coords)
        coords["y_max"] = max(y_coords)

    return coords
