"""Common dependencies for API endpoints

This module re-exports the Better Auth session validation from core.auth.
The old Supabase auth has been replaced.
"""

from core.auth import get_current_user, get_optional_user

__all__ = ["get_current_user", "get_optional_user"]
