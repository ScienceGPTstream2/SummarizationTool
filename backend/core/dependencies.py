"""Common dependencies for API endpoints"""

import os
from typing import Dict
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from services.auth.supabase_auth_service import SupabaseAuthService

auth_service = SupabaseAuthService()

if not auth_service.is_configured:
    print("Supabase authentication is NOT configured. Backend endpoints will fail.")
else:
    print("Using Supabase authentication")

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> Dict:
    """Validate token and return current user info"""
    token = credentials.credentials

    if not auth_service.is_configured:
        raise HTTPException(
            status_code=500, detail="Supabase authentication service not configured"
        )

    try:
        user_info = auth_service.get_user_info(token)
        app_metadata = user_info.get("app_metadata", {})

        return {
            "id": user_info.get("id"),
            "email": user_info.get("email"),
            "role": user_info.get("role"),
            "metadata": user_info.get("user_metadata", {}),
            "app_metadata": app_metadata,
            "is_admin": app_metadata.get("is_admin", False),
        }
    except ValueError as e:
        print(f"[AUTH] Supabase token verification failed: {str(e)}")
        raise HTTPException(status_code=401, detail=str(e))
