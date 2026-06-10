"""Chat API endpoint for support staff chatbot"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from core.auth import get_current_user
from services.chat_memory import ChatMemoryRequest, ChatMemoryService
from services.chat_memory.chat_memory_service import GENERIC_MODEL_ERROR_MESSAGE

router = APIRouter(prefix="/api/chat", tags=["chat"])
chat_memory_service: Optional[ChatMemoryService] = None


class ChatQueryRequest(BaseModel):
    chat_session_id: str = Field(min_length=1)
    query: str = Field(min_length=1)
    document_markdown: Optional[str] = None
    model_type: str
    model_id: Optional[str] = None
    deployment: Optional[str] = None
    api_version: Optional[str] = None


class ChatHistoryMessage(BaseModel):
    id: str
    role: str
    content: str


class ChatHistorySummary(BaseModel):
    chat_session_id: str
    title: str
    message_count: int
    latest_message: str
    latest_checkpoint_id: Optional[str] = None


class ChatHistoryListResponse(BaseModel):
    chats: list[ChatHistorySummary]
    total: int


class ChatHistoryDetailResponse(BaseModel):
    chat_session_id: str
    messages: list[ChatHistoryMessage]
    conversation_summary: str = ""
    summarized_message_count: int = 0
    context_usage: Optional[dict[str, Any]] = None


def get_chat_memory_service() -> ChatMemoryService:
    global chat_memory_service
    if chat_memory_service is None:
        chat_memory_service = ChatMemoryService()
    return chat_memory_service


@router.get("/history", response_model=ChatHistoryListResponse)
async def list_chat_history(
    current_user: dict = Depends(get_current_user),
):
    try:
        return await get_chat_memory_service().list_chat_sessions(current_user["id"])
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Error listing chat history: {str(exc)}",
        ) from exc


@router.get("/history/{chat_session_id}", response_model=ChatHistoryDetailResponse)
async def get_chat_history(
    chat_session_id: str,
    current_user: dict = Depends(get_current_user),
):
    try:
        chat = await get_chat_memory_service().get_chat_session(
            user_id=current_user["id"],
            chat_session_id=chat_session_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Error loading chat history: {str(exc)}",
        ) from exc

    if chat is None:
        raise HTTPException(status_code=404, detail="Chat history not found")
    return chat


@router.delete("/history/{chat_session_id}")
async def delete_chat_history(
    chat_session_id: str,
    current_user: dict = Depends(get_current_user),
):
    try:
        deleted = await get_chat_memory_service().delete_chat_session(
            user_id=current_user["id"],
            chat_session_id=chat_session_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Error deleting chat history: {str(exc)}",
        ) from exc

    if not deleted:
        raise HTTPException(status_code=404, detail="Chat history not found")
    return {"message": f"Chat history {chat_session_id} deleted successfully"}


@router.post("/query", dependencies=[Depends(get_current_user)])
async def chat_query(
    request: ChatQueryRequest,
    current_user: dict = Depends(get_current_user),
):
    document_context = request.document_markdown

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
            )
        )
        return result
    except Exception:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": GENERIC_MODEL_ERROR_MESSAGE,
            },
        )
