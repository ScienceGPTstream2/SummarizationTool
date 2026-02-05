"""Authentication API endpoints"""

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from pathlib import Path

from core.dependencies import get_current_user
from services.database.supabase_db_service import get_db_service

router = APIRouter(prefix="/auth", tags=["auth"])


# Health check endpoint (moved from main.py)
@router.get("/health", dependencies=[Depends(get_current_user)])
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "message": "Authentication service is running"}


@router.post("/history", dependencies=[Depends(get_current_user)])
async def record_login_history(
    request: Request, current_user: dict = Depends(get_current_user)
):
    """
    Record a login event for the current user.
    Extracts IP and User-Agent from the request.
    """
    try:
        user_id = current_user.get("id")
        if not user_id:
            raise HTTPException(status_code=400, detail="User ID not found in token")

        # Extract client info
        ip_address = request.client.host
        user_agent = request.headers.get("user-agent")

        # Check for X-Forwarded-For header (if behind proxy/load balancer)
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ip_address = forwarded.split(",")[0]

        # Record event
        db_service = get_db_service()
        db_service.record_login(
            user_id=user_id, ip_address=ip_address, user_agent=user_agent
        )

        return {"status": "recorded", "user_id": user_id}

    except Exception as e:
        print(f"Error recording login history: {e}")
        # Don't fail the request if logging fails, just log the error
        return {"status": "error", "message": str(e)}
