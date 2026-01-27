"""Entity extraction API endpoints"""

import asyncio
import os
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse

from core.dependencies import get_current_user
from schemas.extractions import ExtractRequest, Entity
from services.document.document_service import DocumentService
from services.llm.llm_service import LLMService
from services.document.processors.azure_doc_intelligence.bounding_box_matcher import (
    match_references_to_bounding_boxes as match_azure_references,
    match_figure_references_to_bounding_boxes as match_azure_figure_references,
)
from services.document.processors.docling.bounding_box_matcher import (
    match_references_to_bounding_boxes as match_docling_references,
)

router = APIRouter(prefix="/api", tags=["extractions"])

# Initialize services
document_service = DocumentService()
llm_service = LLMService()

# Timeout logging setup
TIMEOUT_LOG_DIR = Path(__file__).resolve().parents[2] / "output" / "timeout_logs"
TIMEOUT_LOG_DIR.mkdir(parents=True, exist_ok=True)
TIMEOUT_LOG_FILE = TIMEOUT_LOG_DIR / "timeout_log.txt"

def log_timeout_event(operation: str, details: str, duration: float = None):
    """
    Log timeout events to a file for monitoring API request issues.

    Args:
        operation: The operation that timed out (e.g., "entity_extraction", "figure_ocr")
        details: Additional details about the timeout
        duration: How long it took before timing out (if available)
    """
    timestamp = datetime.now().isoformat()
    duration_str = f" ({duration:.2f}s)" if duration else ""

    log_entry = f"[{timestamp}] TIMEOUT - {operation}{duration_str}: {details}\n"

    try:
        with open(TIMEOUT_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(log_entry)
        print(f"[TIMEOUT_LOG] {log_entry.strip()}")
    except Exception as e:
        print(f"[TIMEOUT_LOG_ERROR] Failed to write to log file: {e}")


@router.post("/extract", dependencies=[Depends(get_current_user)])
async def extract_entities(request: ExtractRequest, http_request: Request):
    """
    Run entity extraction for a list of entities using Azure OpenAI.
    Includes figure content for comprehensive analysis and figure referencing.
    """
    # Create a semaphore to limit concurrency
    sem = asyncio.Semaphore(50)
    try:
        # For Azure Document Intelligence, use raw_analysis.content
        # This provides clean markdown without tags
        markdown = None
        raw_analysis = None

        # Fetch raw_analysis for processors that support bounding box matching
        if request.processor_used in ["azure_doc_intelligence", "docling"]:
            raw_analysis = await document_service.get_raw_analysis_result(
                request.conversion_id
            )
            if raw_analysis and "content" in raw_analysis:
                markdown = raw_analysis["content"]

        # Fallback to regular markdown if raw_analysis not available
        if not markdown:
            markdown = await document_service.get_markdown_content(
                request.conversion_id, request.processor_used
            )

        if markdown is None:
            raise HTTPException(
                status_code=404, detail="Conversion markdown not found or not ready"
            )

        # Fetch and include figure content for enhanced analysis
        figures_content = ""
        figures = None
        try:
            figures = await document_service.get_figures_for_conversion(request.conversion_id)
            print(f"[EXTRACTION] Found {len(figures) if figures else 0} figures for document {request.conversion_id}")
            if figures:
                # Debug: print figure IDs
                figure_ids = [f.get("id", "unknown") for f in figures]
                print(f"[EXTRACTION] Figure IDs from Azure Doc Intelligence: {figure_ids}")
                figures_content = await _build_figures_context(figures, request.conversion_id)
                print(f"[EXTRACTION] Generated {len(figures_content)} characters of figure content")
        except Exception as e:
            print(f"Warning: Could not load figure content for analysis: {e}")

        # Combine document content with figure content
        enhanced_markdown = markdown
        if figures_content:
            enhanced_markdown = f"{markdown}\n\n--- FIGURES ---\n{figures_content}"

        async def run_extraction(entity: Entity):
            nonlocal raw_analysis  # Allow access to outer scope variable

            async with sem:
                print(f"[EXTRACTION] Running extraction for entity '{entity.name}' with model {request.model_type}")
                print(f"[EXTRACTION] Prompt preview: {entity.prompt[:100]}...")
                print(f"[EXTRACTION] Enhanced markdown length: {len(enhanced_markdown)}")

                session_id = http_request.headers.get("X-Session-Id")
                result = await llm_service.extract_entities_from_markdown(
                    markdown=enhanced_markdown,
                    extraction_prompt=entity.prompt,
                    model_type=request.model_type,
                    model_id=request.model_id,
                    deployment=request.deployment,
                    api_version=request.api_version,
                    endpoint_override=request.azure_endpoint,
                    api_key_override=request.azure_api_key,
                    gemini_api_key_override=request.gemini_api_key,
                    gemini_project_id_override=request.gemini_project_id,
                    gemini_location_override=request.gemini_location,
                    max_tokens=request.max_tokens,
                    temperature=request.temperature,
                    system_message=entity.system_prompt,
                    session_id=session_id,
                )

                print(f"[EXTRACTION] LLM response for '{entity.name}': {result.get('content', '')[:200]}...")
                print(f"[EXTRACTION] References found: {len(result.get('references', []))}")
            if result.get("success"):
                response_data = {
                    "name": entity.name,
                    "extracted": result.get("content"),
                    "meta": result.get("meta"),
                }

                # Add references and bounding boxes if available
                references = result.get("references", [])
                if references:
                    response_data["references"] = references

                    # Try to add bounding boxes if processor supports it
                    if request.processor_used in ["azure_doc_intelligence", "docling"]:
                        try:
                            # Use the raw_analysis we already fetched, or fetch it if not available
                            if not raw_analysis:
                                raw_analysis = (
                                    await document_service.get_raw_analysis_result(
                                        request.conversion_id
                                    )
                                )
                            if raw_analysis:
                                # Match references to bounding boxes based on processor
                                if request.processor_used == "azure_doc_intelligence":
                                    # Get figures for figure reference matching
                                    figures = await document_service.get_figures_for_conversion(request.conversion_id)
                                    if figures:
                                        matched_references = match_azure_figure_references(
                                            references=references,
                                            raw_analysis=raw_analysis,
                                            figures=figures,
                                        )
                                    else:
                                        matched_references = match_azure_references(
                                            references=references,
                                            raw_analysis=raw_analysis,
                                        )
                                elif request.processor_used == "docling":
                                    matched_references = match_docling_references(
                                        references=references,
                                        raw_analysis=raw_analysis,
                                    )
                                else:
                                    matched_references = references

                                response_data["references"] = matched_references
                        except Exception as e:
                            # If bounding box matching fails, still return references without bboxes
                            print(
                                f"Warning: Failed to match bounding boxes for {entity.name}: {e}"
                            )

                # Also include answer if available (from structured output)
                if "answer" in result:
                    response_data["answer"] = result.get("answer")

                return response_data
            else:
                # Even on failure, the result might have useful metadata
                return {
                    "name": entity.name,
                    "extracted": f"Error: {result.get('error')}",
                    "meta": result.get("meta"),
                }

        tasks = [run_extraction(entity) for entity in request.entities]
        extracted_entities = await asyncio.gather(*tasks)

        return JSONResponse(
            status_code=200,
            content={
                "message": "Extraction completed",
                "extracted_entities": extracted_entities,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error extracting entities: {str(e)}"
        )


async def _build_figures_context(figures: list, conversion_id: str) -> str:
    """
    Build a formatted context string containing figure information for entity extraction.

    Args:
        figures: List of figure metadata dictionaries
        conversion_id: The conversion ID for API calls

    Returns:
        Formatted string with figure information and OCR content
    """
    if not figures:
        return ""

    context_parts = []

    for figure in figures:
        figure_id = figure.get("id", "unknown")
        page = figure.get("page")
        caption = figure.get("caption", "")

        # Start building figure context
        figure_context = f"Figure {figure_id}:"

        # Add page information if available
        if page:
            figure_context += f" (Page {page})"

        figure_context += "\n"

        # Add caption if available
        if caption:
            figure_context += f"Caption: {caption}\n"

        # Try to get scientific summary - this is the new preferred method
        try:
            # Check if we have a stored scientific summary (preferred)
            if figure.get("scientific_summary") and figure["scientific_summary"].get("summary"):
                summary_content = figure["scientific_summary"]["summary"]
                figure_context += f"Summary: {summary_content}\n"
            # Fallback to legacy OCR content if no summary exists
            elif figure.get("extracted_content") and figure["extracted_content"].get("content"):
                ocr_content = figure["extracted_content"]["content"]
                figure_context += f"Content: {ocr_content}\n"
            else:
                # No summary or OCR content available
                figure_context += "Summary: [No summary generated - use 'Generate Summary' to analyze this figure]\n"
        except Exception as e:
            print(f"Warning: Could not get figure content for figure {figure_id}: {e}")
            figure_context += "Summary: [Figure analysis not available]\n"

        context_parts.append(figure_context)

    # Join all figure contexts with double newlines
    return "\n\n".join(context_parts)
