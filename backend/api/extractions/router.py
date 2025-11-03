"""Entity extraction API endpoints"""

import asyncio
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse

from core.dependencies import get_current_user
from schemas.extractions import ExtractRequest, Entity
from services.document.document_service import DocumentService
from services.llm.llm_service import LLMService

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
        markdown = await document_service.get_markdown_content(
            request.conversion_id, request.processor_used
        )
        if markdown is None:
            raise HTTPException(
                status_code=404, detail="Conversion markdown not found or not ready"
            )

        async def run_extraction(entity: Entity):
            result = await llm_service.extract_entities_from_markdown(
                markdown=markdown,
                extraction_prompt=entity.prompt,
                model_type=request.model_type,
                model_id=request.model_id,
                deployment=request.deployment,
                api_version=request.api_version,
                endpoint_override=request.azure_endpoint,
                api_key_override=request.azure_api_key,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
            )
            if result.get("success"):
                return {
                    "name": entity.name,
                    "extracted": result.get("content"),
                    "meta": result.get("meta"),
                }
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
