"""API endpoints for generating paragraph summaries"""

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import List, Dict, Optional

from core.dependencies import get_current_user
from services.llm.llm_service import LLMService
from services.session.session_service import get_session_service
from services.telemetry.cost_tracker import cost_tracker
from schemas.sessions import ExtractionResult

router = APIRouter(prefix="/api", tags=["paragraph_generator"])
llm_service = LLMService()

# Maps request.model_type → provider key used by cost_tracker
_PARAGRAPH_PROVIDER_MAP = {
    "azure": "azure",
    "gemini": "gcp",
    "anthropic": "gcp",
    "llama": "gcp",
    "macbook": "macbook",
}


class ParagraphGenerationRequest(BaseModel):
    entities: List[Dict]
    summary_prompt: str
    session_id: Optional[str] = None  # Added for persistence
    file_hash: Optional[str] = None  # File hash for multi-document sessions
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
    temperature: Optional[float] = (
        None  # Temperature for paragraph generation (None = use model default)
    )


@router.post("/generate_paragraph", dependencies=[Depends(get_current_user)])
async def generate_paragraph(
    request: ParagraphGenerationRequest,
    http_request: Request,
    user: Dict = Depends(get_current_user),
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
        print(
            f"[Summarize] model_type={request.model_type}, model_id={request.model_id}, deployment={request.deployment}, temperature={request.temperature}"
        )
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
            summary_text = result.get("content")

            # Extract token/duration info from meta (used for cost + DB persistence)
            meta = result.get("meta", {}) or {}
            prompt_tokens = meta.get("prompt_tokens")
            completion_tokens = meta.get("completion_tokens")
            duration = meta.get("duration")
            duration_ms = int(duration * 1000) if duration else None

            # Compute paragraph LLM cost regardless of whether session_id is present
            _provider = _PARAGRAPH_PROVIDER_MAP.get(
                request.model_type or "azure", "azure"
            )
            _model = (
                meta.get("deployment")
                or meta.get("model")
                or request.model_id
                or "unknown"
            )
            paragraph_cost = None
            if prompt_tokens is not None or completion_tokens is not None:
                try:
                    paragraph_cost = cost_tracker.estimate_call_cost(
                        provider=_provider,
                        model=_model,
                        prompt_tokens=prompt_tokens or 0,
                        completion_tokens=completion_tokens or 0,
                    )
                except Exception as cost_err:
                    print(
                        f"[COST_TRACKER] Failed to compute paragraph cost: {cost_err}"
                    )

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
                            file_hash=request.file_hash,  # CRITICAL: Include file_hash for multi-doc sessions
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                            duration_ms=duration_ms,
                            cost=paragraph_cost,
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

            response_meta = {**meta}
            if paragraph_cost is not None:
                response_meta["cost"] = paragraph_cost
            return {"summary": summary_text, "meta": response_meta}
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Error generating summary: {result.get('error')}",
            )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error during summarization: {str(e)}"
        )
