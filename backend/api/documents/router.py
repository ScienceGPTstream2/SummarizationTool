"""Document processing API endpoints"""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse, FileResponse
from pathlib import Path
from typing import Dict, Any, List

from core.dependencies import get_current_user
from schemas.documents import ProcessFileRequest
from services.document.file_service import FileService
from services.document.document_service import DocumentService
from services.document.bbox_normalizer import normalize_bbox_format
from services.llm.llm_service import LLMService

router = APIRouter(prefix="/api/documents", tags=["documents"])

# Initialize services
file_service = FileService()
document_service = DocumentService()
llm_service = LLMService()


def camel_to_snake_case(name: str) -> str:
    """Convert camelCase to snake_case"""
    import re

    # Insert underscore before capital letters and convert to lowercase
    s1 = re.sub("(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub("([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def transform_keys_to_snake_case(data: Any) -> Any:
    """
    Recursively transform all dictionary keys from camelCase to snake_case.
    This ensures frontend compatibility with Azure Document Intelligence responses.
    """
    if isinstance(data, dict):
        return {
            camel_to_snake_case(k): transform_keys_to_snake_case(v)
            for k, v in data.items()
        }
    elif isinstance(data, list):
        return [transform_keys_to_snake_case(item) for item in data]
    else:
        return data


@router.post("/process/file/{file_id}", dependencies=[Depends(get_current_user)])
async def process_uploaded_file(
    file_id: str, request: ProcessFileRequest = ProcessFileRequest()
):
    """
    Process an uploaded file to markdown using specified or auto-selected processor
    """
    try:
        # Get file info
        file_info = await file_service.get_file_by_id(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")

        # Convert file to markdown using user-selected processor
        file_path = file_info["file_path"]
        result = await document_service.convert_document_to_markdown(
            file_path,
            "file",
            processor=request.processor,
            extract_figures=request.extract_figures,
        )

        if not result["success"]:
            raise HTTPException(
                status_code=500, detail=f"Conversion failed: {result['error']}"
            )

        # Build response with available metadata
        response_content = {
            "message": "Document processed successfully",
            "conversion_id": result["conversion_id"],
            "markdown_path": result["markdown_path"],
            "content_length": result["metadata"]["content_length"],
            "conversion_time": result["metadata"]["conversion_time"],
            "processor_used": result.get("processor_used", "unknown"),
            "processor_fallback": result.get("processor_fallback", False),
            "fallback_reason": result.get("fallback_reason"),
        }

        # Include figures information if available
        if "figures_found" in result["metadata"]:
            response_content["figures_found"] = result["metadata"]["figures_found"]
            response_content["figures"] = result["metadata"].get("figures", [])

        # Include tables information if available
        if "tables_found" in result["metadata"]:
            response_content["tables_found"] = result["metadata"]["tables_found"]

        return JSONResponse(status_code=200, content=response_content)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error converting file: {str(e)}")


@router.get("/{document_id}/content", dependencies=[Depends(get_current_user)])
async def get_document_content(document_id: str, processor_used: str = None):
    """
    Get the processed markdown content of a document

    Args:
        document_id: The document/conversion ID
        processor_used: Optional processor that was used (improves efficiency)
    """
    try:
        markdown_content = await document_service.get_markdown_content(
            document_id, processor_used
        )
        if markdown_content is None:
            raise HTTPException(
                status_code=404, detail="Document processing not found or not ready"
            )

        return JSONResponse(
            status_code=200,
            content={"document_id": document_id, "markdown_content": markdown_content},
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error retrieving document content: {str(e)}"
        )


@router.get("/{document_id}/enhanced-content", dependencies=[Depends(get_current_user)])
async def get_enhanced_document_content(document_id: str, processor_used: str = None):
    """
    Get the enhanced markdown content with figure summaries integrated inline

    Args:
        document_id: The document/conversion ID
        processor_used: Optional processor that was used (improves efficiency)
    """
    try:
        # Get base markdown content
        base_markdown = await document_service.get_markdown_content(
            document_id, processor_used
        )
        if base_markdown is None:
            raise HTTPException(
                status_code=404, detail="Document processing not found or not ready"
            )

        # Get figure summaries
        figures = await document_service.get_figures_for_conversion(document_id)
        enhanced_markdown = base_markdown
        has_enhancements = False

        if figures:
            # Create a map of figure summaries
            figure_summaries = {}
            for figure in figures:
                if figure.get("scientific_summary") and figure["scientific_summary"].get("summary"):
                    figure_summaries[figure["id"]] = {
                        "summary": figure["scientific_summary"]["summary"],
                        "caption": figure.get("caption", ""),
                        "page": figure.get("page")
                    }

            if figure_summaries:
                has_enhancements = True
                # Insert summaries inline near figure references
                enhanced_markdown = await _insert_figure_summaries_inline(base_markdown, figure_summaries)

        return JSONResponse(
            status_code=200,
            content={
                "document_id": document_id,
                "markdown_content": enhanced_markdown,
                "has_enhancements": has_enhancements,
                "base_content": base_markdown
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error retrieving enhanced document content: {str(e)}"
        )


async def _generate_figure_summary_with_retry(
    image_path: str,
    figure_id: str,
    model_type: str,
    model_id: str = None,
    max_tokens: int = 4096,
    temperature: float = 0.0,
    max_retries: int = 2,
) -> Dict[str, Any]:
    """
    Generate figure summary with retry logic to handle truncation and API caching.

    Args:
        image_path: Path to the figure image
        figure_id: Figure identifier for logging
        model_type: LLM model type (gemini, etc.)
        model_id: Specific model ID
        max_tokens: Maximum tokens to generate
        temperature: Sampling temperature
        max_retries: Maximum retry attempts for truncated responses

    Returns:
        LLM response dictionary
    """
    import uuid
    import time

    for attempt in range(max_retries + 1):
        try:
            # Create unique cache buster to prevent API caching
            cache_buster = uuid.uuid4().hex[:12]

            # Base prompt
            base_prompt = """
Analyze this scientific figure and provide a structured summary. Be concise but complete.

FORMAT:
**Type**: [chart/graph type]
**Variables**: [key variables measured]
**Data**: [specific numerical values, ranges, statistical measures]
**Trends**: [main patterns/relationships]
**Findings**: [key conclusions]

Include sample sizes, p-values, time points if visible. Keep total response under 1000 words.
"""

            # Add cache busting and attempt-specific instructions
            if attempt == 0:
                # First attempt - standard prompt
                summary_prompt = base_prompt
                system_message = "You are an expert scientific data analyst. Extract and summarize quantitative data from scientific figures with precision and clarity. Focus on the most important findings and statistical details."
                current_temperature = temperature
            else:
                # Retry attempts - add cache buster and slight variations
                summary_prompt = f"{base_prompt}\n\nCACHE_BUSTER_ID: {cache_buster}_{attempt}\nEnsure complete response - do not truncate important data."
                system_message = f"You are an expert scientific data analyst. Extract and summarize quantitative data from scientific figures with precision and clarity. Focus on the most important findings and statistical details. This is attempt #{attempt + 1} - provide a complete, detailed summary."
                current_temperature = min(0.3, temperature + 0.1 * attempt)  # Slight temperature increase on retries

            print(f"[SUMMARY] Attempt {attempt + 1}/{max_retries + 1} for figure {figure_id} (cache_buster: {cache_buster})")

            # Generate summary
            result = await llm_service.extract_content_from_image(
                image_path=image_path,
                extraction_prompt=summary_prompt,
                model_type=model_type,
                model_id=model_id,
                max_tokens=max_tokens,
                temperature=current_temperature,
                system_message=system_message,
            )

            if not result["success"]:
                if attempt == max_retries:
                    return result  # Return failure on final attempt
                print(f"[SUMMARY] Attempt {attempt + 1} failed, retrying...")
                time.sleep(0.5)  # Brief pause before retry
                continue

            summary_content = result["content"]

            # Check for truncation
            truncation_indicators = ["...", "…", "comet assay", "data", "figure", "results", "significant"]
            is_likely_truncated = (
                len(summary_content) > 300 and  # Long enough to potentially be truncated
                any(summary_content.lower().endswith(indicator) for indicator in truncation_indicators) or
                not summary_content.strip().endswith(('.', '!', '?', ')', ']')) or  # Doesn't end with proper punctuation
                summary_content.count('**') % 2 != 0  # Unmatched bold markers
            )

            if is_likely_truncated and attempt < max_retries:
                print(f"[SUMMARY] ⚠️ Detected potential truncation on attempt {attempt + 1}, retrying...")
                time.sleep(1.0)  # Longer pause for truncation retry
                continue

            # Success - return the result
            print(f"[SUMMARY] ✅ Successfully generated summary for figure {figure_id} on attempt {attempt + 1}")
            return result

        except Exception as e:
            print(f"[SUMMARY] Attempt {attempt + 1} error: {e}")
            if attempt == max_retries:
                raise e
            time.sleep(0.5)

    # This should not be reached, but just in case
    raise Exception(f"All {max_retries + 1} attempts failed to generate summary for figure {figure_id}")


async def _insert_figure_summaries_inline(markdown_content: str, figure_summaries: dict) -> str:
    """
    Insert figure summaries inline near figure references in the markdown content

    Args:
        markdown_content: The base markdown content
        figure_summaries: Dict mapping figure_id to summary info

    Returns:
        Enhanced markdown with summaries inserted inline
    """
    import re

    # Split into lines for processing
    lines = markdown_content.split('\n')
    enhanced_lines = []
    inserted_summaries = set()  # Track which summaries we've already inserted

    for line in lines:
        enhanced_lines.append(line)

        # Look for figure references in this line
        figure_refs_in_line = []

        # Pattern to match various figure reference formats
        patterns = [
            r'\bFigure\s+(\d+(?:\.\d+)*)',  # "Figure 1.1", "Figure 2"
            r'\bFig\.?\s+(\d+(?:\.\d+)*)',  # "Fig 1.1", "Fig. 2.3"
            r'\bFIGURE\s+(\d+(?:\.\d+)*)',  # "FIGURE 1.1"
            r'\bFIG\.?\s+(\d+(?:\.\d+)*)',  # "FIG 1.1"
        ]

        for pattern in patterns:
            matches = re.findall(pattern, line, re.IGNORECASE)
            for match in matches:
                # Try different figure ID mappings
                possible_ids = [match]  # Direct match like "1"

                # Also try sequential mapping (Fig. 1 -> figure at index 0)
                try:
                    sequential_id = str(int(match))  # "1.1" -> "1", "2" -> "2"
                    if sequential_id != match:
                        possible_ids.append(sequential_id)
                except ValueError:
                    pass

                # Find the first matching figure
                for fig_id in possible_ids:
                    if fig_id in figure_summaries and fig_id not in inserted_summaries:
                        summary_data = figure_summaries[fig_id]
                        figure_refs_in_line.append((fig_id, summary_data))
                        inserted_summaries.add(fig_id)
                        break

        # Insert summaries for figures found in this line
        for fig_id, summary_data in figure_refs_in_line:
            summary_block = f"\n\n📊 **Figure {fig_id} Summary**"
            if summary_data.get("caption"):
                summary_block += f" *(Caption: {summary_data['caption']})*"
            if summary_data.get("page"):
                summary_block += f" *(Page {summary_data['page']})*"
            summary_block += f":\n{summary_data['summary']}\n"

            enhanced_lines.append(summary_block)

    # If we still have uninjected summaries, append them at the end
    remaining_summaries = []
    for fig_id, summary_data in figure_summaries.items():
        if fig_id not in inserted_summaries:
            remaining_summaries.append((fig_id, summary_data))

    if remaining_summaries:
        enhanced_lines.append("\n\n--- ADDITIONAL FIGURE SUMMARIES ---")
        for fig_id, summary_data in remaining_summaries:
            summary_block = f"\n📊 **Figure {fig_id} Summary**"
            if summary_data.get("caption"):
                summary_block += f" *(Caption: {summary_data['caption']})*"
            if summary_data.get("page"):
                summary_block += f" *(Page {summary_data['page']})*"
            summary_block += f":\n{summary_data['summary']}"

            enhanced_lines.append(summary_block)

    return '\n'.join(enhanced_lines)


@router.get("/{document_id}/figures", dependencies=[Depends(get_current_user)])
async def get_document_figures(document_id: str):
    """
    Get all figures metadata for a document processed with Azure Document Intelligence

    Args:
        document_id: The document/conversion ID

    Returns:
        List of figure metadata including captions, bounding regions, and image paths
    """
    try:
        figures = await document_service.get_figures_for_conversion(document_id)

        if figures is None:
            raise HTTPException(
                status_code=404,
                detail="No figures found. Document may not exist or was not processed with Azure Document Intelligence.",
            )

        return JSONResponse(
            status_code=200,
            content={
                "document_id": document_id,
                "figures_count": len(figures),
                "figures": figures,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error retrieving document figures: {str(e)}"
        )


@router.get("/{document_id}/analysis", dependencies=[Depends(get_current_user)])
async def get_document_analysis(document_id: str):
    """
    Get the complete raw analysis result with ALL bounding boxes

    This endpoint works for documents processed with either Azure Document Intelligence or Docling.

    Azure Document Intelligence returns:
    - All pages with words, lines, and their bounding polygons
    - All paragraphs with bounding regions and roles (title, sectionHeading, etc.)
    - All tables with cells and bounding boxes
    - All figures with bounding regions and captions
    - All selection marks (checkboxes) with bounding boxes
    - All sections and structural information

    Docling returns:
    - All pages with dimensions
    - All text items (paragraphs) with bounding regions and roles
    - All tables with cells and bounding boxes
    - All pictures/figures with bounding regions and captions
    - Document structure (body, furniture, groups)

    Note: Azure DI field names are transformed from camelCase to snake_case for frontend compatibility.
    Docling already uses snake_case.

    Args:
        document_id: The document/conversion ID

    Returns:
        Complete analysis result with all bounding box data
        The response includes a "processor" field to identify the source (azure_doc_intelligence or docling)
    """
    try:
        analysis_result = await document_service.get_raw_analysis_result(document_id)

        if analysis_result is None:
            raise HTTPException(
                status_code=404,
                detail="Analysis result not found. Document may not exist or was not processed yet.",
            )

        # Normalize both formats to a consistent structure for frontend
        # This ensures both Docling and Azure DI have:
        # - Same field names (snake_case)
        # - Same units (points)
        # - Same structure
        normalized_result = normalize_bbox_format(analysis_result)

        # Ensure processor field is always present in the result
        processor = normalized_result.get("processor", "unknown")

        return JSONResponse(
            status_code=200,
            content={
                "document_id": document_id,
                "processor": processor,
                "analysis_result": normalized_result,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error retrieving document analysis: {str(e)}"
        )


@router.get(
    "/{document_id}/figures/{figure_filename}", dependencies=[Depends(get_current_user)]
)
async def get_figure_image(document_id: str, figure_filename: str):
    """
    Serve a specific figure image file

    Args:
        document_id: The document/conversion ID
        figure_filename: The figure filename (e.g., "1.1.png" or "table-1.png")

    Returns:
        The image file
    """
    try:
        base_path = Path(__file__).resolve().parents[2]

        # Try unified output directory structure for both processors
        # Priority: output/docling -> output/azure_doc_intelligence -> legacy (backward compatibility)
        possible_paths = [
            base_path
            / "output"
            / "docling"
            / document_id
            / "figures"
            / figure_filename,
            base_path
            / "output"
            / "azure_doc_intelligence"
            / document_id
            / "figures"
            / figure_filename,
            # Legacy paths for backward compatibility
            base_path
            / "markdown_output"
            / "docling"
            / document_id
            / "figures"
            / figure_filename,
            base_path
            / "markdown_output"
            / "azure_doc_intelligence"
            / document_id
            / "figures"
            / figure_filename,
            base_path / "markdown_output" / document_id / "figures" / figure_filename,
        ]

        print(f"[FIGURE] Attempting to serve figure: {document_id}/{figure_filename}")

        figure_path = None
        for path in possible_paths:
            print(f"[FIGURE] Checking path: {path.absolute()}")
            if path.exists():
                figure_path = path
                print(f"[FIGURE] ✅ Found at: {path}")
                break

        if not figure_path:
            print(f"[FIGURE] File not found in any location")
            raise HTTPException(
                status_code=404, detail=f"Figure image not found: {figure_filename}"
            )

        # Security check: ensure the file is within the expected output or markdown_output directory
        output_dir = base_path / "output"
        markdown_output_dir = base_path / "markdown_output"
        if not (
            figure_path.is_relative_to(output_dir)
            or figure_path.is_relative_to(markdown_output_dir)
        ):
            print(
                f"[FIGURE] Security check failed - path not within output or markdown_output directory"
            )
            raise HTTPException(status_code=403, detail="Access denied")

        print(f"[FIGURE] ✅ Serving figure: {figure_filename}")

        # Return the image file
        return FileResponse(
            path=str(figure_path), media_type="image/png", filename=figure_filename
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[FIGURE] Error: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error retrieving figure image: {str(e)}"
        )


@router.post(
    "/{document_id}/figures/{figure_id}/generate-summary",
    dependencies=[Depends(get_current_user)]
)
async def generate_figure_summary(
    document_id: str,
    figure_id: str,
    request: Dict[str, Any],
):
    """
    Generate a structured scientific summary from a specific figure using vision models.
    The summary is stored persistently and will be available for entity extraction.

    Args:
        document_id: The document/conversion ID
        figure_id: The figure ID (e.g., "1.1")
        request: Request body with generation parameters

    Request body:
    {
        "model_type": "gemini",  # or "azure"
        "model_id": "gemini-2.5-flash",  # optional
        "max_tokens": 2048,  # optional
        "temperature": 0.0,  # optional
    }
    """
    try:
        # Get figure metadata to find the image path
        figures = await document_service.get_figures_for_conversion(document_id)
        if not figures:
            raise HTTPException(
                status_code=404,
                detail="No figures found for this document",
            )

        # Find the specific figure
        figure = next((f for f in figures if f["id"] == figure_id), None)
        if not figure:
            raise HTTPException(
                status_code=404,
                detail=f"Figure {figure_id} not found",
            )

        # Check if figure has an image path
        if not figure.get("image_path"):
            raise HTTPException(
                status_code=400,
                detail=f"Figure {figure_id} has no associated image",
            )

        # Get the full image path
        base_path = Path(__file__).resolve().parents[2]
        image_path = base_path / "output" / "azure_doc_intelligence" / document_id / figure["image_path"]

        if not image_path.exists():
            # Try legacy path for backward compatibility
            legacy_path = base_path / "output" / "docling" / document_id / figure["image_path"]
            if legacy_path.exists():
                image_path = legacy_path
            else:
                raise HTTPException(
                    status_code=404,
                    detail=f"Figure image not found: {figure['image_path']}",
                )

        # Extract parameters from request
        model_type = request.get("model_type", "gemini")
        model_id = request.get("model_id")
        max_tokens = request.get("max_tokens", 4096)
        temperature = request.get("temperature", 0.0)

        # Generate structured summary with retry logic for truncation
        result = await _generate_figure_summary_with_retry(
            image_path=str(image_path),
            figure_id=figure_id,
            model_type=model_type,
            model_id=model_id,
            max_tokens=max_tokens,
            temperature=temperature,
        )

        if not result["success"]:
            raise HTTPException(
                status_code=500,
                detail=f"Summary generation failed: {result['error']}",
            )

        summary_content = result["content"]

        # Check for potential truncation and retry with more focused prompt if detected
        truncation_indicators = ["...", "…", "comet assay", "data", "figure", "results"]
        is_likely_truncated = (
            len(summary_content) > 500 and  # Long enough to potentially be truncated
            any(summary_content.lower().endswith(indicator) for indicator in truncation_indicators) or
            not summary_content.strip().endswith(('.', '!', '?'))  # Doesn't end with proper punctuation
        )

        # If truncated and we haven't exceeded max retries, try again with focused prompt
        if is_likely_truncated and max_tokens <= 4096:  # Only retry if not already at high limit
            print(f"[SUMMARY] ⚠️ Detected potential truncation in summary for figure {figure_id}, retrying with focused prompt...")

            # Retry with more focused prompt and higher token limit
            focused_result = await _generate_figure_summary_with_retry(
                image_path=str(image_path),
                figure_id=figure_id,
                model_type=model_type,
                model_id=model_id,
                max_tokens=min(max_tokens * 2, 8192),  # Double token limit, max 8K
                temperature=max(temperature, 0.1),  # Slight temperature increase for more complete responses
                max_retries=1,  # Only one additional retry for truncation
            )

            if focused_result["success"]:
                focused_content = focused_result["content"]
                # Check if the focused attempt is significantly longer and more complete
                if len(focused_content) > len(summary_content) * 1.2:  # At least 20% longer
                    summary_content = focused_content
                    result = focused_result
                    is_likely_truncated = False
                    print(f"[SUMMARY] ✅ Successfully regenerated longer summary for figure {figure_id}")
                else:
                    print(f"[SUMMARY] ⚠️ Focused retry did not produce significantly longer summary, keeping original")

        if is_likely_truncated:
            summary_content += "\n\n⚠️ *Note: This summary may be truncated due to length limits. Consider regenerating with a more focused prompt.*"
            print(f"[SUMMARY] ⚠️ Summary for figure {figure_id} may be truncated")

        # Store the summary persistently in figure metadata
        summary_data = {
            "summary": summary_content,
            "generated_at": result.get("meta", {}).get("timestamp"),
            "model_used": result.get("meta", {}).get("model", "unknown"),
            "duration": result.get("meta", {}).get("duration"),
            "summary_type": "scientific_summary",  # Mark as structured summary vs raw OCR
            "potentially_truncated": is_likely_truncated,
        }

        # Try to update the figure metadata file with the summary
        try:
            # Find the metadata file for this conversion
            metadata_paths = [
                base_path / "output" / "azure_doc_intelligence" / document_id / "metadata.json",
                base_path / "output" / "docling" / document_id / "metadata.json",
                # Legacy paths
                base_path / "markdown_output" / "azure_doc_intelligence" / document_id / "metadata.json",
                base_path / "markdown_output" / "docling" / document_id / "metadata.json",
            ]

            metadata_updated = False
            for metadata_path in metadata_paths:
                if metadata_path.exists():
                    import json
                    with open(metadata_path, 'r') as f:
                        metadata = json.load(f)

                    # Update the specific figure with the summary
                    if "figures" in metadata:
                        for fig in metadata["figures"]:
                            if fig.get("id") == figure_id:
                                fig["scientific_summary"] = summary_data
                                metadata_updated = True
                                break

                    if metadata_updated:
                        with open(metadata_path, 'w') as f:
                            json.dump(metadata, f, indent=2)
                        print(f"[SUMMARY] ✅ Stored summary for figure {figure_id} in {metadata_path}")
                        break

        except Exception as e:
            print(f"[SUMMARY] Warning: Could not persist summary to metadata file: {e}")
            # Continue anyway - the summary is still returned to the UI

        return JSONResponse(
            status_code=200,
            content={
                "document_id": document_id,
                "figure_id": figure_id,
                "summary_result": summary_data,
                "figure_metadata": {
                    "caption": figure.get("caption"),
                    "page": figure.get("page"),
                    "image_path": figure["image_path"],
                }
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error generating figure summary: {str(e)}",
        )


# Legacy endpoint for backward compatibility
@router.post(
    "/{document_id}/figures/{figure_id}/extract-content",
    dependencies=[Depends(get_current_user)]
)
async def extract_figure_content(
    document_id: str,
    figure_id: str,
    request: Dict[str, Any],
):
    """
    Legacy endpoint - redirects to new generate-summary endpoint
    """
    # Redirect to the new summary endpoint
    return await generate_figure_summary(document_id, figure_id, request)


@router.get(
    "/{document_id}/tables/{table_filename}", dependencies=[Depends(get_current_user)]
)
async def get_table_html(document_id: str, table_filename: str):
    """
    Serve a specific table HTML file

    Args:
        document_id: The document/conversion ID
        table_filename: The table filename (e.g., "table-1.html")

    Returns:
        The table HTML file
    """
    try:
        base_path = Path(__file__).resolve().parents[2]

        # Try unified output directory structure for both processors
        possible_paths = [
            base_path / "output" / "docling" / document_id / "tables" / table_filename,
            base_path
            / "output"
            / "azure_doc_intelligence"
            / document_id
            / "tables"
            / table_filename,
        ]

        print(f"[TABLE] Attempting to serve table: {document_id}/{table_filename}")

        table_path = None
        for path in possible_paths:
            print(f"[TABLE] Checking path: {path}")
            if path.exists():
                table_path = path
                print(f"[TABLE] ✅ Found at: {path}")
                break

        if not table_path:
            print(f"[TABLE] File not found in any location")
            raise HTTPException(
                status_code=404, detail=f"Table file not found: {table_filename}"
            )

        # Security check: ensure the file is within the expected output directory
        output_dir = base_path / "output"
        if not table_path.is_relative_to(output_dir):
            print(f"[TABLE] Security check failed - path not within output directory")
            raise HTTPException(status_code=403, detail="Access denied")

        print(f"[TABLE] ✅ Serving table: {table_filename}")

        # Return the HTML file
        return FileResponse(
            path=str(table_path), media_type="text/html", filename=table_filename
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[TABLE] Error: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error retrieving table file: {str(e)}"
        )
