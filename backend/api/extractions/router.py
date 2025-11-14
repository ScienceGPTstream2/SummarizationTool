"""Entity extraction API endpoints"""

import asyncio
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse

from core.dependencies import get_current_user
from schemas.extractions import ExtractRequest, Entity
from services.document.document_service import DocumentService
from services.llm.llm_service import LLMService
from services.document.processors.azure_doc_intelligence.bounding_box_matcher import (
    match_references_to_bounding_boxes,
)

router = APIRouter(prefix="/api", tags=["extractions"])

# Initialize services
document_service = DocumentService()
llm_service = LLMService()


@router.post("/extract", dependencies=[Depends(get_current_user)])
async def extract_entities(request: ExtractRequest):
    """
    Run entity extraction for a list of entities using Azure OpenAI.
    """
    try:
        # For Azure Document Intelligence, use raw_analysis.content
        # This provides clean markdown without tags
        markdown = None
        raw_analysis = None

        if request.processor_used == "azure_doc_intelligence":
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

        async def run_extraction(entity: Entity):
            nonlocal raw_analysis  # Allow access to outer scope variable

            result = await llm_service.extract_entities_from_markdown(
                markdown=markdown,
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
            )
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

                    # Try to add bounding boxes if using Azure Document Intelligence
                    if request.processor_used == "azure_doc_intelligence":
                        try:
                            # Use the raw_analysis we already fetched, or fetch it if not available
                            if not raw_analysis:
                                raw_analysis = (
                                    await document_service.get_raw_analysis_result(
                                        request.conversion_id
                                    )
                                )
                            if raw_analysis:
                                # Match references to bounding boxes
                                matched_references = match_references_to_bounding_boxes(
                                    references=references,
                                    raw_analysis=raw_analysis,
                                )
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
