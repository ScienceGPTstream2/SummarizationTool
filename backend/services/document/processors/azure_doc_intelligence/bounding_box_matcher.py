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
    Find matching paragraphs for the search text.

    Args:
        search_text: Text to search for
        paragraphs: List of paragraph dictionaries from raw_analysis.json
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
                    "similarity": similarity,
                    "bounding_regions": para.get("boundingRegions", []),
                    "role": para.get("role"),
                    "spans": para.get("spans", []),
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
                        "similarity": word_similarity,
                        "bounding_regions": para.get("boundingRegions", []),
                        "role": para.get("role"),
                        "spans": para.get("spans", []),
                    }
                    matches.append(match_info)

    return matches


def find_text_in_lines(
    search_text: str, pages: List[Dict[str, Any]], threshold: float = 0.5
) -> List[Dict[str, Any]]:
    """
    Find matching lines for the search text.

    Args:
        search_text: Text to search for
        pages: List of page dictionaries from raw_analysis.json
        threshold: Minimum similarity threshold

    Returns:
        List of matching lines with bounding box information
    """
    normalized_search = normalize_text(search_text)
    matches = []

    for page in pages:
        page_number = page.get("pageNumber", 0)
        lines = page.get("lines", [])

        for line in lines:
            line_content = line.get("content", "")
            normalized_line = normalize_text(line_content)

            # Check for substring match
            if (
                normalized_search in normalized_line
                or normalized_line in normalized_search
            ):
                search_chars = set(normalized_search.lower())
                line_chars = set(normalized_line.lower())
                overlap = len(search_chars & line_chars)
                similarity = overlap / max(len(search_chars), len(line_chars), 1)

                if similarity >= threshold:
                    match_info = {
                        "line_content": line_content,
                        "page_number": page_number,
                        "similarity": similarity,
                        "polygon": line.get("polygon", []),
                        "spans": line.get("spans", []),
                    }
                    matches.append(match_info)
            # Also check word-level matching for longer texts
            elif len(normalized_search) > 15:
                search_words = set(normalized_search.lower().split())
                line_words = set(normalized_line.lower().split())
                if len(search_words) > 0:
                    word_overlap = len(search_words & line_words)
                    word_similarity = word_overlap / len(search_words)
                    if word_similarity >= 0.4:
                        match_info = {
                            "line_content": line_content,
                            "page_number": page_number,
                            "similarity": word_similarity,
                            "polygon": line.get("polygon", []),
                            "spans": line.get("spans", []),
                        }
                        matches.append(match_info)

    return matches


def match_reference_to_bounding_box(
    reference_text: str,
    raw_analysis: Dict[str, Any],
    para_threshold: float = 0.6,
    line_threshold: float = 0.5,
) -> Dict[str, Any]:
    """
    Match a single reference text to bounding boxes in the raw analysis.

    Args:
        reference_text: The text excerpt to match
        raw_analysis: The complete raw analysis dictionary from Azure Document Intelligence
        para_threshold: Minimum similarity threshold for paragraph matching
        line_threshold: Minimum similarity threshold for line matching

    Returns:
        Dictionary with matching information including bounding boxes
    """
    paragraphs = raw_analysis.get("paragraphs", [])
    pages = raw_analysis.get("pages", [])

    # Try to find in paragraphs first (more accurate)
    para_matches = find_text_in_paragraphs(reference_text, paragraphs, para_threshold)

    # Also try to find in lines (for more granular matching)
    line_matches = find_text_in_lines(reference_text, pages, line_threshold)

    result = {
        "text": reference_text,
        "paragraph_matches": para_matches,
        "line_matches": line_matches,
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
            page_num = region.get("pageNumber", region.get("page_number"))
            if page_num and not page_number:
                page_number = page_num
            bbox_info.append(
                {"page_number": page_num, "polygon": region.get("polygon", [])}
            )

        result["best_match"] = {
            "type": "paragraph",
            "content": best_para["paragraph_content"],
            "similarity": best_para["similarity"],
            "page_number": page_number,  # Add page_number at top level for easy access
            "bounding_regions": bbox_info,
            "role": best_para.get("role"),
        }
    elif line_matches:
        best_line = max(line_matches, key=lambda x: x["similarity"])
        result["best_match"] = {
            "type": "line",
            "content": best_line["line_content"],
            "similarity": best_line["similarity"],
            "page_number": best_line["page_number"],
            "polygon": best_line["polygon"],
        }

    return result


def match_references_to_bounding_boxes(
    references: List[Dict[str, Any]],
    raw_analysis: Dict[str, Any],
    para_threshold: float = 0.6,
    line_threshold: float = 0.5,
) -> List[Dict[str, Any]]:
    """
    Match multiple reference texts to bounding boxes in the raw analysis.

    Args:
        references: List of reference dictionaries, each with at least a 'text' field
        raw_analysis: The complete raw analysis dictionary from Azure Document Intelligence
        para_threshold: Minimum similarity threshold for paragraph matching
        line_threshold: Minimum similarity threshold for line matching

    Returns:
        List of dictionaries with matching information for each reference
    """
    results = []

    for ref_idx, ref in enumerate(references):
        ref_text = ref.get("text", "")
        if not ref_text:
            continue

        match_result = match_reference_to_bounding_box(
            ref_text, raw_analysis, para_threshold, line_threshold
        )

        # Add reference index and preserve any additional fields from the original reference
        match_result["reference_index"] = ref_idx
        if "context" in ref:
            match_result["context"] = ref["context"]

        results.append(match_result)

    return results
