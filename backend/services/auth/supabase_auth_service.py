"""
Supabase Authentication Service

Verifies JWT tokens issued by Supabase for user authentication.
This service validates the token signature using Supabase's JWT secret
and extracts user information from the token payload.
"""

import os
import jwt
from typing import Dict, Optional
from datetime import datetime


class SupabaseAuthService:
    """Service to verify Supabase JWT tokens"""

    def __init__(self):
        self.jwt_secret = os.getenv("SUPABASE_JWT_SECRET")
        self.jwt_algorithm = "HS256"

        if not self.jwt_secret:
            print(
                "Warning: SUPABASE_JWT_SECRET not configured. "
                "Supabase authentication will not work."
            )

    @property
    def is_configured(self) -> bool:
        """Check if Supabase auth is properly configured"""
        return self.jwt_secret is not None

    def verify_token(self, token: str) -> Dict:
        """
        Verify Supabase JWT and return payload

        Args:
            token: JWT access token from Supabase

        Returns:
            Decoded token payload

        Raises:
            ValueError: If token is invalid or expired
        """
        if not self.jwt_secret:
            raise ValueError("Supabase JWT secret not configured")

        try:
            # Supabase tokens use 'authenticated' as the audience
            payload = jwt.decode(
                token,
                self.jwt_secret,
                algorithms=[self.jwt_algorithm],
                audience="authenticated",
            )
            return payload
        except jwt.ExpiredSignatureError:
            raise ValueError("Token has expired")
        except jwt.InvalidAudienceError:
            raise ValueError("Invalid token audience")
        except jwt.InvalidTokenError as e:
            raise ValueError(f"Invalid token: {e}")

    def get_user_id(self, token: str) -> str:
        """
        Extract user ID from token

        Args:
            token: JWT access token

        Returns:
            Supabase user UUID
        """
        payload = self.verify_token(token)
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("Token missing user ID (sub claim)")
        return user_id

    def get_user_email(self, token: str) -> Optional[str]:
        """
        Extract email from token

        Args:
            token: JWT access token

        Returns:
            User email or None if not present
        """
        payload = self.verify_token(token)
        return payload.get("email")

    def get_user_info(self, token: str) -> Dict:
        """
        Extract full user info from token

        Args:
            token: JWT access token

        Returns:
            Dictionary with user info including:
            - id: Supabase user UUID
            - email: User email
            - role: User role (e.g., 'authenticated')
            - aud: Audience claim
            - exp: Expiration timestamp
        """
        payload = self.verify_token(token)

        return {
            "id": payload.get("sub"),
            "email": payload.get("email"),
            "role": payload.get("role"),
            "aud": payload.get("aud"),
            "exp": payload.get("exp"),
            "iat": payload.get("iat"),
            # User metadata from Supabase (includes GitHub profile info)
            "user_metadata": payload.get("user_metadata", {}),
            "app_metadata": payload.get("app_metadata", {}),
        }

    def is_token_expired(self, token: str) -> bool:
        """
        Check if token is expired without full verification

        Args:
            token: JWT access token

        Returns:
            True if token is expired, False otherwise
        """
        try:
            # Decode without verification to check expiration
            payload = jwt.decode(
                token, options={"verify_signature": False, "verify_exp": False}
            )
            exp = payload.get("exp")
            if not exp:
                return True
            return datetime.utcnow().timestamp() > exp
        except jwt.InvalidTokenError:
            return True
