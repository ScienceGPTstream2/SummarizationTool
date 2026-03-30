"""
Better Auth Session Validation for FastAPI

Replaces the old Supabase JWT verification.
Validates sessions by looking up the session token directly in the
Better Auth 'session' table in Postgres via SQLAlchemy.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import Request, HTTPException, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from models import AuthSession, User, get_db_session

logger = logging.getLogger(__name__)


async def get_current_user(request: Request) -> dict:
    """
    FastAPI dependency that extracts and validates the Better Auth session.
    
    The frontend sends the session token as:
      - Cookie: better-auth.session_token=<token>   (set by Better Auth)
      - OR Header: Authorization: Bearer <token>
    
    We look up the token in the 'session' table. If valid and not expired,
    we return the user info.
    
    Returns:
        dict with keys: id, email, name, image
    
    Raises:
        HTTPException 401 if no valid session found.
    """
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="No auth token provided")

    # Query session + user in one go
    db: SASession = next(get_db_session())
    try:
        stmt = (
            select(AuthSession, User)
            .join(User, AuthSession.user_id == User.id)
            .where(AuthSession.token == token)
        )
        result = db.execute(stmt).first()
        
        if not result:
            raise HTTPException(status_code=401, detail="Invalid session token")
        
        auth_session, user = result
        
        # Check expiration
        now = datetime.now(timezone.utc)
        expires = auth_session.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        
        if now > expires:
            raise HTTPException(status_code=401, detail="Session expired")
        
        return {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "image": user.image,
            "is_admin": user.is_admin or False,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Auth error: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")
    finally:
        db.close()


def _extract_token(request: Request) -> Optional[str]:
    """Extract session token from cookie or Authorization header."""
    # 1. Try cookie (Better Auth default)
    token = request.cookies.get("better-auth.session_token")
    if token:
        return token
    
    # 2. Try Authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    
    return None


async def get_optional_user(request: Request) -> Optional[dict]:
    """
    Same as get_current_user but returns None instead of raising 401.
    Useful for endpoints that work for both authenticated and anonymous users.
    """
    try:
        return await get_current_user(request)
    except HTTPException:
        return None


# Re-export as FastAPI dependencies
CurrentUser = Depends(get_current_user)
OptionalUser = Depends(get_optional_user)
