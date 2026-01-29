"""Entity extraction API endpoints"""

import asyncio
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse

from core.dependencies import get_current_user
from schemas.extractions import ExtractRequest, Entity
from services.document.document_service import DocumentService
from services.llm.llm_service import LLMService
from services.document.processors.azure_doc_intelligence.bounding_box_matcher import (
    match_references_to_bounding_boxes as match_azure_references,
)
from services.document.processors.docling.bounding_box_matcher import (
    match_references_to_bounding_boxes as match_docling_references,
)

router = APIRouter(prefix="/api", tags=["extractions"])

from services.session.session_service import SessionService, get_session_service
from schemas.sessions import ExtractionResult

# Initialize services
document_service = DocumentService()
llm_service = LLMService()
session_service = get_session_service()


@router.post("/extract", dependencies=[Depends(get_current_user)])
async def extract_entities(
    request: ExtractRequest, user_model=Depends(get_current_user)
):
    """
    Run entity extraction for a list of entities using Azure OpenAI.
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

        async def run_extraction(entity: Entity):
            nonlocal raw_analysis  # Allow access to outer scope variable

            async with sem:
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
                    system_message=entity.system_prompt,
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

        # Persist results if session_id and user_model are available
        if request.session_id and user_model:
            try:
                user_id = str(user_model["id"] if isinstance(user_model, dict) else user_model.id)
                document_id = None
                session_docs = session_service.db.get_documents_by_session(
                    request.session_id
                )
                for doc in session_docs:
                    if doc["file_hash"] == request.conversion_id:
                        document_id = doc["id"]
                        break

                # If found, save all successful extractions
                if document_id:
                    for entity_res in extracted_entities:
                        # Skip if error string
                        if isinstance(entity_res.get("extracted"), str) and entity_res[
                            "extracted"
                        ].startswith("Error:"):
                            continue

                        # Convert to ExtractionResult schema
                        result_obj = ExtractionResult(
                            entity_name=entity_res["name"],
                            model_id=request.model_id
                            or request.deployment
                            or "unknown-model",
                            extracted_text=entity_res["extracted"],
                            references=entity_res.get("references"),
                            status="completed",
                            extracted_at=None,  # will happen in add_extraction_result
                        )

                        # Save to DB
                        session_service.add_extraction_result(
                            user_id=user_id,
                            session_id=request.session_id,
                            result=result_obj,
                            document_id=document_id,
                        )
                        print(
                            f"Persisted extraction for {entity_res['name']} to session {request.session_id}"
                        )
                else:
                    print(
                        f"Warning: Could not find document with hash {request.conversion_id} in session {request.session_id}"
                    )

            except Exception as e:
                import traceback
                print(f"Error persisting extractions for session {request.session_id}:")
                print(f"  conversion_id: {request.conversion_id}")
                print(f"  document_id: {document_id if 'document_id' in dir() else 'not assigned'}")
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
