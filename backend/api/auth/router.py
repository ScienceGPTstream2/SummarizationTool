"""Authentication API endpoints"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from pathlib import Path

from core.dependencies import get_current_user
from services.auth.auth_service import AuthService

router = APIRouter(prefix="/api", tags=["auth"])

class AuthRequest(BaseModel):
    email: str
    password: str

auth_service = AuthService(Path(__file__).resolve().parents[2] / "core" / "users.toml")

@router.post("/register")
async def register(request: AuthRequest):
    try:
        auth_service.register_user(request.email, request.password)
        return {"message": "Registered successfully"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/login")
async def login(request: AuthRequest):
    try:
        token = auth_service.authenticate_user(request.email, request.password)
        return {"token": token}
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

# Health check endpoint (moved from main.py)
@router.get("/", dependencies=[Depends(get_current_user)])
async def root():
    """Health check endpoint"""
    return {"message": "Document Summarization API is running"}