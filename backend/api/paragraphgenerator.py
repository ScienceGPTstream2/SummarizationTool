"""API endpoints for generating paragraph summaries"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Dict, Optional

from core.dependencies import get_current_user
from services.llm.llm_service import LLMService
from services.session.session_service import get_session_service
from schemas.sessions import ExtractionResult

router = APIRouter(prefix="/api", tags=["paragraph_generator"])
llm_service = LLMService()


class ParagraphGenerationRequest(BaseModel):
    entities: List[Dict]
    summary_prompt: str
    session_id: Optional[str] = None  # Added for persistence
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


@router.post("/generate_paragraph")
async def generate_paragraph(
    request: ParagraphGenerationRequest, user: Dict = Depends(get_current_user)
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
        )

        if result.get("success"):
            summary_text = result.get("content")

            # Persist to database if session_id is provided
            print(
                f"[Summarize] Persistence requested. Session ID: {request.session_id}, User ID: {user.get('id')}"
            )
            if request.session_id:
                try:
                    session_service = get_session_service()
                    user_id = user.get("id")

                    if user_id:
                        # Create extraction result object
                        summary_result = ExtractionResult(
                            entity_name="__paragraph_summary__",
                            model_id=request.model_id or "summary-generator",
                            extracted_text=summary_text,
                            status="completed",
                        )

                        # Save using the service
                        session_service.add_extraction_result_fast(
                            user_id=user_id,
                            session_id=request.session_id,
                            result=summary_result,
                        )
                        print(
                            f"Successfully saved generated summary for session {request.session_id}"
                        )
                except Exception as db_err:
                    print(f"Error saving summary to DB: {db_err}")
                    # We log but don't fail the request

            return {"summary": summary_text, "meta": result.get("meta")}
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Error generating summary: {result.get('error')}",
            )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error during summarization: {str(e)}"
        )
