"""Chat API endpoint for support staff chatbot"""

from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from core.auth import get_current_user
from services.chat_memory import ChatMemoryRequest, ChatMemoryService
from services.chat_memory.chat_memory_service import GENERIC_MODEL_ERROR_MESSAGE
from services.chat_memory.document_context import build_attached_session_context

router = APIRouter(prefix="/api/chat", tags=["chat"])
chat_memory_service: Optional[ChatMemoryService] = None


class ChatQueryRequest(BaseModel):
    chat_session_id: str = Field(min_length=1)
    query: str = Field(min_length=1)
    document_markdown: Optional[str] = None
    attached_session_id: Optional[str] = None
    model_type: str
    model_id: Optional[str] = None
    deployment: Optional[str] = None
    api_version: Optional[str] = None


def get_chat_memory_service() -> ChatMemoryService:
    global chat_memory_service
    if chat_memory_service is None:
        chat_memory_service = ChatMemoryService()
    return chat_memory_service


@router.post("/query", dependencies=[Depends(get_current_user)])
async def chat_query(
    request: ChatQueryRequest,
    current_user: dict = Depends(get_current_user),
):
    document_context = request.document_markdown
    attached_session_id = request.attached_session_id
    attached_session_warning: Optional[str] = None

    if request.attached_session_id:
        attached_context = await build_attached_session_context(
            user_id=current_user["id"],
            attached_session_id=request.attached_session_id,
        )
        if attached_context is None:
            attached_session_id = None
            attached_session_warning = (
                "Attached session not found or has no processed document content. Continuing without attachment."
            )
        else:
            document_context = attached_context

    try:
        result = await get_chat_memory_service().invoke(
            ChatMemoryRequest(
                user_id=current_user["id"],
                chat_session_id=request.chat_session_id,
                query=request.query,
                model_type=request.model_type,
                model_id=request.model_id,
                deployment=request.deployment,
                api_version=request.api_version,
                document_context=document_context,
                attached_session_id=attached_session_id,
            )
        )
        if attached_session_warning and isinstance(result, dict):
            result["attached_session_warning"] = attached_session_warning
        return result
    except Exception:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": GENERIC_MODEL_ERROR_MESSAGE,
            },
        )
