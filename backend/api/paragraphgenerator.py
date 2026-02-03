"""API endpoints for generating paragraph summaries"""

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import List, Dict, Optional

from core.dependencies import get_current_user
from services.llm.llm_service import LLMService

router = APIRouter(prefix="/api", tags=["paragraph_generator"])
llm_service = LLMService()


class ParagraphGenerationRequest(BaseModel):
    entities: List[Dict]
    summary_prompt: str
    system_prompt: Optional[str] = None  # Custom system prompt
    model_type: Optional[str] = "azure"  # New field for model type
    model_id: Optional[str] = None  # New field for Gemini model ID
    deployment: Optional[str] = None  # Made optional
    api_version: Optional[str] = None  # Made optional
    azure_endpoint: Optional[str] = None
    azure_api_key: Optional[str] = None
    gemini_api_key: Optional[str] = None  # Gemini API key
    gemini_project_id: Optional[str] = None  # Gemini project ID
    gemini_location: Optional[str] = None  # Gemini location
    max_tokens: int = 8048
    temperature: float = 0.0  # Added temperature


@router.post("/generate_paragraph", dependencies=[Depends(get_current_user)])
async def generate_paragraph(
    request: ParagraphGenerationRequest, http_request: Request
):
    """
    Generate a paragraph from a list of extracted entities.
    """
    try:
        # Format the extracted entities into a string for the prompt
        entities_str = "\n".join(
            [
                f"**{entity['name']}**: {entity['extracted']}"
                for entity in request.entities
                if entity.get("extracted")
            ]
        )

        # Ensure {{entities}} placeholder exists in prompt (add if missing)
        summary_prompt = request.summary_prompt
        if "{{entities}}" not in summary_prompt:
            summary_prompt = summary_prompt + "\n\n{{entities}}"

        # Replace the placeholder in the prompt with the actual entities
        user_prompt = summary_prompt.replace("{{entities}}", entities_str)
        print(f"[Summarize] Final user prompt:\n{user_prompt}")

        # Call the LLM service to generate the summary
        session_id = http_request.headers.get("X-Session-Id")
        result = await llm_service.generate_paragraph(
            user_prompt=user_prompt,
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
            system_message=request.system_prompt,
            session_id=session_id,
        )

        if result.get("success"):
            return {"summary": result.get("content"), "meta": result.get("meta")}
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Error generating summary: {result.get('error')}",
            )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error during summarization: {str(e)}"
        )
