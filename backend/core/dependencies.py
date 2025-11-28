"""Common dependencies for API endpoints"""

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pathlib import Path
from services.auth.auth_service import AuthService

security = HTTPBearer()

# Initialize auth service
auth_service = AuthService(Path(__file__).resolve().parent / "users.toml")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Validate JWT token and return current user"""
    token = credentials.credentials
    try:
        # print(f"[AUTH] Verifying token: {token[:10]}...")
        payload = auth_service.verify_token(token)
        # print(f"[AUTH] Token verified for user: {payload.get('sub')}")
        return payload["sub"]
    except Exception as e:
        print(f"[AUTH] Token verification failed: {str(e)}")
        raise HTTPException(
            status_code=401, detail=f"Invalid or expired token: {str(e)}"
        )
