"""Session API endpoints for managing user extraction sessions"""

from fastapi import APIRouter, HTTPException, Query
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


class ShareSessionRequest(BaseModel):
    """Request to share a session with a group"""

    user_id: str
    group_id: str


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


@router.patch("/{session_id}", response_model=dict)
async def update_session(session_id: str, request: UpdateSessionRequest):
    """
    Update a session's name, status, configuration, or results.

    Only provided fields will be updated.

    Returns {"ok": true} — callers (frontend auto-save for eval config,
    ground truths, batch configs) do not use the returned session data,
    so we skip serialising the full Session object which grows with every
    eval run and can become many MB for large sessions.
    """
    session = session_service.update_session(request.user_id, session_id, request)

    if session is None:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    return {"ok": True}


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
        raise HTTPException(
            status_code=404,
            detail=f"Session {session_id} not found or document mismatch",
        )

    return {"ok": True}


@router.post("/{session_id}/evaluations")
async def add_evaluation_result(
    session_id: str,
    result: EvaluationResult,
    user_id: str = Query(..., description="User ID"),
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
    user_id: str = Query(..., description="User ID requesting shared sessions"),
):
    """
    List sessions shared with groups the user belongs to.
    Returns sessions from other users that have been shared to the requesting user's groups.
    """
    try:
        sessions = session_service.list_shared_sessions(user_id)
        return SessionListResponse(sessions=sessions, total=len(sessions))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error listing shared sessions: {str(e)}"
        )


@router.get("/shared/{session_id}", response_model=Session)
async def get_shared_session(
    session_id: str,
    user_id: str = Query(..., description="Requesting user ID"),
):
    """
    Get a shared session for viewing. Verifies the requesting user has access
    via group membership.
    """
    session = session_service.get_session_for_shared_view(user_id, session_id)

    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Shared session not found or you don't have access",
        )

    return session


@router.post("/{session_id}/share")
async def share_session(session_id: str, request: ShareSessionRequest):
    """
    Share a session with a group. Only the session owner can share.
    A session can only be shared with one group at a time.
    """
    try:
        result = session_service.share_session(
            request.user_id, session_id, request.group_id
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to share session. The database may need a schema migration "
                f"to be applied (run supabase-docker/migrations/20260317160000_add_session_sharing.sql "
                f"and reload the PostgREST schema cache). Error: {e}"
            ),
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
    user_id: str = Query(..., description="User ID (session owner)"),
):
    """
    Remove sharing from a session. Only the session owner can unshare.
    """
    result = session_service.unshare_session(user_id, session_id)

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found or you don't have permission to unshare",
        )

    return {"ok": True, "message": "Session sharing removed"}
