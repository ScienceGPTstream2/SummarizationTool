"""Session API endpoints for managing user extraction sessions"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from schemas.sessions import (
    Session,
    CreateSessionRequest,
    UpdateSessionRequest,
    SessionListResponse,
    ExtractionResult,
    EvaluationResult,
)
from services.session.session_service import get_session_service

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

# Get singleton service
session_service = get_session_service()


@router.post("", response_model=Session)
async def create_session(request: CreateSessionRequest):
    """
    Create a new extraction session for a user.

    Sessions store the full configuration (models, entities, prompts) along with
    extraction and evaluation results.
    """
    try:
        session = session_service.create_session(request)
        return session
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating session: {str(e)}")


@router.get("", response_model=SessionListResponse)
async def list_sessions(
    user_id: str = Query(..., description="User ID to list sessions for")
):
    """
    List all sessions for a user.

    Returns session summaries ordered by most recently updated.
    """
    try:
        sessions = session_service.list_sessions(user_id)
        return SessionListResponse(sessions=sessions, total=len(sessions))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing sessions: {str(e)}")


@router.get("/{session_id}", response_model=Session)
async def get_session(
    session_id: str, user_id: str = Query(..., description="User ID")
):
    """
    Get a session by ID with full details including extraction and evaluation results.
    """
    session = session_service.get_session(user_id, session_id)

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    return session


@router.patch("/{session_id}", response_model=Session)
async def update_session(session_id: str, request: UpdateSessionRequest):
    """
    Update a session's name, status, configuration, or results.

    Only provided fields will be updated.
    """
    session = session_service.update_session(request.user_id, session_id, request)

    if session is None:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    return session


@router.delete("/{session_id}")
async def delete_session(
    session_id: str, user_id: str = Query(..., description="User ID")
):
    """
    Delete a session and all its data.
    """
    success = session_service.delete_session(user_id, session_id)

    if not success:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    return {"message": f"Session {session_id} deleted successfully"}


@router.post("/{session_id}/extractions")
async def add_extraction_result(
    session_id: str,
    result: ExtractionResult,
    user_id: str = Query(..., description="User ID"),
):
    """
    Add or update an extraction result in a session.

    Returns {"ok": true} — the frontend does not consume the full session
    response so we skip the expensive get_session() reload to avoid
    'URI too long' errors on large sessions with many extraction results.
    """
    ok = session_service.add_extraction_result_fast(user_id, session_id, result)

    if not ok:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found or document mismatch")

    return {"ok": True}


@router.post("/{session_id}/evaluations", response_model=Session)
async def add_evaluation_result(
    session_id: str,
    result: EvaluationResult,
    user_id: str = Query(..., description="User ID"),
):
    """
    Add or update an evaluation result in a session.

    If a result for the same entity and model already exists, it will be updated.
    """
    try:
        session = session_service.add_evaluation_result(user_id, session_id, result)

        if session is None:
            raise HTTPException(
                status_code=404,
                detail=f"Session {session_id} not found or no extraction exists for entity {result.entity_name}",
            )

        return session
    except HTTPException:
        raise
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail=f"Error saving evaluation: {str(e)}"
        )
