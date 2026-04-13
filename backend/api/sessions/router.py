"""Session API endpoints for managing user extraction sessions"""

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
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
from core.auth import get_current_user


class ShareSessionRequest(BaseModel):
    """Request to share a session with a group"""

    group_id: str


router = APIRouter(prefix="/api/sessions", tags=["sessions"])

# Get singleton service
session_service = get_session_service()


@router.post("", response_model=Session)
async def create_session(
    request: CreateSessionRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Create a new extraction session for the authenticated user.

    Sessions store the full configuration (models, entities, prompts) along with
    extraction and evaluation results.
    """
    try:
        # Override user_id with the authenticated user
        request.user_id = current_user["id"]
        session = session_service.create_session(request)
        return session
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating session: {str(e)}")


@router.get("", response_model=SessionListResponse)
async def list_sessions(
    current_user: dict = Depends(get_current_user),
):
    """
    List all sessions for the authenticated user.

    Returns session summaries ordered by most recently updated.
    """
    try:
        user_id = current_user["id"]
        sessions = session_service.list_sessions(user_id)
        return SessionListResponse(sessions=sessions, total=len(sessions))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing sessions: {str(e)}")


@router.get("/{session_id}", response_model=Session)
async def get_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Get a session by ID with full details including extraction and evaluation results.
    """
    user_id = current_user["id"]
    session = session_service.get_session(user_id, session_id)

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    return session


@router.patch("/{session_id}", response_model=dict)
async def update_session(
    session_id: str,
    request: UpdateSessionRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Update a session's name, status, configuration, or results.

    Only provided fields will be updated.

    Returns {"ok": true} — callers (frontend auto-save for eval config,
    ground truths, batch configs) do not use the returned session data,
    so we skip serialising the full Session object which grows with every
    eval run and can become many MB for large sessions.
    """
    user_id = current_user["id"]
    request.user_id = user_id
    session = session_service.update_session(user_id, session_id, request)

    if session is None:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    return {"ok": True}


@router.delete("/{session_id}")
async def delete_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Delete a session and all its data.
    """
    user_id = current_user["id"]
    success = session_service.delete_session(user_id, session_id)

    if not success:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    return {"message": f"Session {session_id} deleted successfully"}


@router.post("/{session_id}/extractions")
async def add_extraction_result(
    session_id: str,
    result: ExtractionResult,
    current_user: dict = Depends(get_current_user),
):
    """
    Add or update an extraction result in a session.

    Returns {"ok": true} — the frontend does not consume the full session
    response so we skip the expensive get_session() reload to avoid
    'URI too long' errors on large sessions with many extraction results.
    """
    user_id = current_user["id"]
    ok = session_service.add_extraction_result_fast(user_id, session_id, result)

    if not ok:
        raise HTTPException(
            status_code=404,
            detail=f"Session {session_id} not found or document mismatch",
        )

    return {"ok": True}


@router.post("/{session_id}/evaluations")
async def add_evaluation_result(
    session_id: str,
    result: EvaluationResult,
    current_user: dict = Depends(get_current_user),
):
    """
    Add or update an evaluation result in a session.

    Returns {"ok": true} — the frontend does not consume the full session
    response so we skip the expensive get_session() reload to avoid
    returning 9+MB of session data (all documents, extractions, and bbox
    references) on every eval persist call.

    This mirrors the same optimisation already applied to the extractions
    endpoint above.
    """
    try:
        user_id = current_user["id"]
        ok = session_service.add_evaluation_result_fast(user_id, session_id, result)

        if not ok:
            raise HTTPException(
                status_code=404,
                detail=f"Session {session_id} not found or no extraction exists for entity {result.entity_name}",
            )

        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail=f"Error saving evaluation: {str(e)}"
        )


# ==========================================
# Session Sharing Endpoints
# ==========================================


@router.get("/shared/list", response_model=SessionListResponse)
async def list_shared_sessions(
    current_user: dict = Depends(get_current_user),
):
    """
    List sessions shared with groups the authenticated user belongs to.
    Returns sessions from other users that have been shared to the requesting user's groups.
    """
    try:
        user_id = current_user["id"]
        sessions = session_service.list_shared_sessions(user_id)
        return SessionListResponse(sessions=sessions, total=len(sessions))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error listing shared sessions: {str(e)}"
        )


@router.get("/shared/{session_id}", response_model=Session)
async def get_shared_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Get a shared session for viewing. Verifies the requesting user has access
    via group membership.
    """
    user_id = current_user["id"]
    session = session_service.get_session_for_shared_view(user_id, session_id)

    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Shared session not found or you don't have access",
        )

    return session


@router.post("/{session_id}/share")
async def share_session(
    session_id: str,
    request: ShareSessionRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Share a session with a group. Only the session owner can share.
    A session can only be shared with one group at a time.
    """
    try:
        user_id = current_user["id"]
        result = session_service.share_session(user_id, session_id, request.group_id)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to share session: {e}",
        )

    if result is None:
        raise HTTPException(
            status_code=403,
            detail="Cannot share session. You may not own this session or not be a member of the target group.",
        )

    return {"ok": True, "message": f"Session shared successfully"}


@router.delete("/{session_id}/share")
async def unshare_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Remove sharing from a session. Only the session owner can unshare.
    """
    user_id = current_user["id"]
    result = session_service.unshare_session(user_id, session_id)

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found or you don't have permission to unshare",
        )

    return {"ok": True, "message": "Session sharing removed"}
