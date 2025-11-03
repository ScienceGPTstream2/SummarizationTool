"""API endpoints for generating paragraph summaries"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Dict, Optional

from core.dependencies import get_current_user
from services.llm.llm_service import LLMService

router = APIRouter(prefix="/api", tags=["paragraph_generator"])
llm_service = LLMService()

class ParagraphGenerationRequest(BaseModel):
    entities: List[Dict]
    summary_prompt: str
    model_type: Optional[str] = "azure" # New field for model type
    model_id: Optional[str] = None # New field for Gemini model ID
    deployment: Optional[str] = None # Made optional
    api_version: Optional[str] = None # Made optional
    azure_endpoint: Optional[str] = None
    azure_api_key: Optional[str] = None
    max_tokens: int = 2048
    temperature: float = 0.0 # Added temperature

@router.post("/generate_paragraph", dependencies=[Depends(get_current_user)])
async def generate_paragraph(request: ParagraphGenerationRequest):
    """
    Generate a paragraph from a list of extracted entities.
    """
    try:
        # Format the extracted entities into a string for the prompt
        entities_str = "\n".join(
            [f"- {entity['name']}: {entity['extracted']}" for entity in request.entities]
        )
        
        # Replace the placeholder in the prompt with the actual entities
        prompt = request.summary_prompt.replace("{{entities}}", entities_str)
        print(f"[Summarize] Final prompt:\n{prompt}")

        # Call the LLM service to generate the summary
        result = await llm_service.generate_paragraph(
            prompt=prompt,
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
            return {"summary": result.get("content"), "meta": result.get("meta")}
        else:
            raise HTTPException(
                status_code=500, detail=f"Error generating summary: {result.get('error')}"
            )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error during summarization: {str(e)}"
        )
