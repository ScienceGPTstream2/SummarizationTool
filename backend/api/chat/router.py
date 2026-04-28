"""Chat API endpoint for support staff chatbot"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

from core.auth import get_current_user
from services.llm.llm_service import LLMService

router = APIRouter(prefix="/api/chat", tags=["chat"])
llm_service = LLMService()


class ChatQueryRequest(BaseModel):
    query: str
    document_markdown: Optional[str] = None
    model_type: str  # "azure", "gemini", "anthropic", "llama", "azure-llama", "macbook"
    model_id: Optional[str] = None
    deployment: Optional[str] = None
    api_version: Optional[str] = None


@router.post("/query", dependencies=[Depends(get_current_user)])
async def chat_query(request: ChatQueryRequest):
    """
    Send a chat message with optional document context.

    When document_markdown is provided, it is injected into the prompt so the
    model can answer questions about the uploaded document.
    """
    if request.document_markdown:
        user_prompt = (
            "The following document has been uploaded by the user:\n\n"
            f"<document>\n{request.document_markdown}\n</document>\n\n"
            f"User question: {request.query}"
        )
        system_message = (
            "You are a helpful document assistant for Health Canada support staff. "
            "Answer the user's question based on the provided document. "
            "If the answer is not found in the document, say so clearly and offer "
            "general guidance if possible."
        )
    else:
        user_prompt = request.query
        system_message = (
            "You are a helpful assistant for Health Canada support staff. "
            "Answer questions clearly and concisely."
        )

    result = await llm_service.generate_paragraph(
        user_prompt=user_prompt,
        model_type=request.model_type,
        model_id=request.model_id,
        deployment=request.deployment,
        api_version=request.api_version,
        max_tokens=4096,
        temperature=0.3,
        system_message=system_message,
    )

    if not result.get("success"):
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": result.get(
                    "error", "The model call failed. Please try again."
                ),
            },
        )

    return {"success": True, "response": result.get("content", "")}
