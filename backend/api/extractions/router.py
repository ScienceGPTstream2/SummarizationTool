"""Entity extraction API endpoints"""

import asyncio
import os
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse

from core.auth import get_current_user
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

from services.session.session_service import SessionService, get_session_service
from schemas.sessions import ExtractionResult
from services.telemetry.cost_tracker import cost_tracker

# Initialize services
document_service = DocumentService()
llm_service = LLMService()
session_service = get_session_service()

# Maps request.model_type → provider key used by cost_tracker (matches llm_service._record_session_metrics)
_EXTRACTION_PROVIDER_MAP = {
    "azure": "azure",
    "gemini": "gcp",
    "anthropic": "gcp",
    "llama": "gcp",
    "azure-llama": "azure",
    "macbook": "macbook",
    "vllm": "vllm",
    "cohere": "cohere",
}

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
async def extract_entities(
    request: ExtractRequest,
    http_request: Request,
    user_model=Depends(get_current_user),
):
    """
    Run entity extraction for a list of entities using Azure OpenAI.
    Includes figure content for comprehensive analysis and figure referencing.
    """
    # Limit concurrent LLM calls. Thread pool is 64 (set in main.py lifespan).
    # Bench showed no provider rate limits at N=24; raised to 48 to double
    # throughput for large batches (10 docs × 5 models × 16 entities = 800 calls).
    sem = asyncio.Semaphore(48)
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
            figures = await document_service.get_figures_for_conversion(
                request.conversion_id
            )
            print(
                f"[EXTRACTION] Found {len(figures) if figures else 0} figures for document {request.conversion_id}"
            )
            if figures:
                # Debug: print figure IDs
                figure_ids = [f.get("id", "unknown") for f in figures]
                print(
                    f"[EXTRACTION] Figure IDs from Azure Doc Intelligence: {figure_ids}"
                )
                figures_content = await _build_figures_context(
                    figures, request.conversion_id
                )
                print(
                    f"[EXTRACTION] Generated {len(figures_content)} characters of figure content"
                )
        except Exception as e:
            print(f"Warning: Could not load figure content for analysis: {e}")

        # Combine document content with figure content
        enhanced_markdown = markdown
        if figures_content:
            enhanced_markdown = f"{markdown}\n\n--- FIGURES ---\n{figures_content}"

        async def run_extraction(entity: Entity):
            nonlocal raw_analysis  # Allow access to outer scope variable

            async with sem:
                print(
                    f"[EXTRACTION] Running extraction for entity '{entity.name}' with model {request.model_type}"
                )
                print(f"[EXTRACTION] Prompt preview: {entity.prompt[:100]}...")
                print(
                    f"[EXTRACTION] Enhanced markdown length: {len(enhanced_markdown)}"
                )

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

                print(
                    f"[EXTRACTION] LLM response for '{entity.name}': {result.get('content', '')[:200]}..."
                )
                print(
                    f"[EXTRACTION] References found: {len(result.get('references', []))}"
                )
            if result.get("success"):
                # Compute per-extraction cost and inject into meta so it's available
                # both in the API response and in the persistence loop below.
                _meta = result.get("meta") or {}
                _provider = _EXTRACTION_PROVIDER_MAP.get(request.model_type, "azure")
                _model = (
                    _meta.get("deployment")
                    or _meta.get("model")
                    or request.model_id
                    or request.deployment
                    or "unknown"
                )
                _pt = _meta.get("prompt_tokens")
                _ct = _meta.get("completion_tokens")
                if _pt is not None or _ct is not None:
                    try:
                        _cost = cost_tracker.estimate_call_cost(
                            provider=_provider,
                            model=_model,
                            prompt_tokens=_pt or 0,
                            completion_tokens=_ct or 0,
                        )
                        _meta["cost"] = _cost
                    except Exception as _e:
                        print(
                            f"[COST_TRACKER] Failed to compute extraction cost for '{entity.name}': {_e}"
                        )
                    result["meta"] = _meta

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
                                    figures = await document_service.get_figures_for_conversion(
                                        request.conversion_id
                                    )
                                    if figures:
                                        matched_references = (
                                            match_azure_figure_references(
                                                references=references,
                                                raw_analysis=raw_analysis,
                                                figures=figures,
                                            )
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

        # For macbook models: process entities SEQUENTIALLY to avoid overwhelming
        # the MacBook GPU with concurrent model loads. The FIFO queue in
        # MacbookLLMClient is the primary gate, but sequential dispatch here avoids
        # holding N-1 idle coroutines waiting in the queue and allows results to be
        # ready in order.
        # For cloud models: continue using asyncio.gather for maximum throughput.
        if request.model_type == "macbook":
            print(
                f"[EXTRACTION] Macbook model detected — processing {len(request.entities)} "
                f"entities SEQUENTIALLY (serialized for GPU reliability)"
            )
            extracted_entities = []
            for i, entity in enumerate(request.entities):
                print(
                    f"[EXTRACTION] Macbook entity {i + 1}/{len(request.entities)}: '{entity.name}'"
                )
                result = await run_extraction(entity)
                extracted_entities.append(result)
        else:
            tasks = [run_extraction(entity) for entity in request.entities]
            extracted_entities = await asyncio.gather(*tasks)

        # Persist results if session_id and user_model are available
        if request.session_id and user_model:
            try:
                user_id = str(
                    user_model["id"] if isinstance(user_model, dict) else user_model.id
                )
                document_id = None
                session_docs = session_service.db.get_documents_by_session(
                    request.session_id
                )
                for doc in session_docs:
                    if doc["file_hash"] == request.conversion_id:
                        document_id = doc["id"]
                        break

                # Always persist all successful extractions. document_id is passed when the
                # file_hash lookup above succeeded; if it's None, add_extraction_result_fast
                # will use result.file_hash to find the document (same pattern as paragraph
                # generator — this prevents silent cost loss on any hash-lookup edge case).
                if not document_id:
                    print(
                        f"Warning: Could not find document with hash {request.conversion_id} "
                        f"in session {request.session_id} — using file_hash fallback"
                    )

                # Persist all extraction results concurrently — previously a
                # sequential for-loop with one blocking DB call per entity.
                async def _persist_entity(entity_res: dict) -> None:
                    if isinstance(entity_res.get("extracted"), str) and entity_res[
                        "extracted"
                    ].startswith("Error:"):
                        return

                    meta = entity_res.get("meta", {}) or {}
                    prompt_tokens = meta.get("prompt_tokens")
                    completion_tokens = meta.get("completion_tokens")
                    duration = meta.get("duration")
                    duration_ms = int(duration * 1000) if duration else None
                    extraction_cost = meta.get("cost")

                    result_obj = ExtractionResult(
                        entity_name=entity_res["name"],
                        model_id=request.model_id
                        or request.deployment
                        or "unknown-model",
                        extracted_text=entity_res["extracted"],
                        references=entity_res.get("references"),
                        status="completed",
                        extracted_at=None,
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        duration_ms=duration_ms,
                        cost=extraction_cost,
                        file_hash=request.conversion_id,
                    )

                    await asyncio.to_thread(
                        session_service.add_extraction_result,
                        user_id,
                        request.session_id,
                        result_obj,
                        document_id,
                    )
                    print(
                        f"Persisted extraction for {entity_res['name']} to session {request.session_id}"
                    )

                await asyncio.gather(*[_persist_entity(e) for e in extracted_entities])

            except Exception as e:
                import traceback

                print(f"Error persisting extractions for session {request.session_id}:")
                print(f"  conversion_id: {request.conversion_id}")
                print(
                    f"  document_id: {document_id if 'document_id' in dir() else 'not assigned'}"
                )
                print(f"  Error: {e}")
                traceback.print_exc()
                # Don't fail the request if persistence fails, just log it

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
            if figure.get("scientific_summary") and figure["scientific_summary"].get(
                "summary"
            ):
                summary_content = figure["scientific_summary"]["summary"]
                figure_context += f"Summary: {summary_content}\n"
            # Fallback to legacy OCR content if no summary exists
            elif figure.get("extracted_content") and figure["extracted_content"].get(
                "content"
            ):
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
