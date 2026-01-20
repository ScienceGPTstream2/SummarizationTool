"""Authentication API endpoints"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from pathlib import Path

from core.dependencies import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


# Health check endpoint (moved from main.py)
@router.get("/health", dependencies=[Depends(get_current_user)])
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "message": "Authentication service is running"}
