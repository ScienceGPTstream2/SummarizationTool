"""
Better Auth User/Auth Models

These tables are managed by Better Auth but defined here so Alembic
can create them and SQLAlchemy can query them from FastAPI.

Schema follows Better Auth's PostgreSQL adapter expectations:
https://www.better-auth.com/docs/concepts/database#core-schema
"""

from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Boolean, DateTime, Integer,
)
from models.base import Base


class User(Base):
    """
    Better Auth 'user' table.
    
    Better Auth creates/manages this table. We define it so:
    1. Alembic can create it during initial migration
    2. FastAPI can query it via SQLAlchemy for user lookups
    """
    __tablename__ = "user"

    id = Column(String(36), primary_key=True)  # Better Auth uses cuid/nanoid strings
    name = Column(Text, nullable=False)
    email = Column(Text, nullable=False, unique=True)
    email_verified = Column(Boolean, default=False, name="emailVerified")
    image = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, name="createdAt")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, name="updatedAt")

    # Custom fields (Better Auth supports adding extra columns)
    role = Column(Text, default="user")  # 'user', 'admin'
    is_admin = Column(Boolean, default=False)


class AuthSession(Base):
    """
    Better Auth 'session' table.
    
    Stores active user sessions. Better Auth manages these,
    but FastAPI reads them to validate requests.
    """
    __tablename__ = "session"

    id = Column(String(36), primary_key=True)
    expires_at = Column(DateTime, nullable=False, name="expiresAt")
    token = Column(Text, nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow, name="createdAt")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, name="updatedAt")
    ip_address = Column(Text, nullable=True, name="ipAddress")
    user_agent = Column(Text, nullable=True, name="userAgent")
    user_id = Column(String(36), nullable=False, name="userId")


class Account(Base):
    """
    Better Auth 'account' table.
    
    Links OAuth providers (Microsoft Entra, GitHub, etc.) to users.
    """
    __tablename__ = "account"

    id = Column(String(36), primary_key=True)
    account_id = Column(Text, nullable=False, name="accountId")
    provider_id = Column(Text, nullable=False, name="providerId")
    user_id = Column(String(36), nullable=False, name="userId")
    access_token = Column(Text, nullable=True, name="accessToken")
    refresh_token = Column(Text, nullable=True, name="refreshToken")
    id_token = Column(Text, nullable=True, name="idToken")
    access_token_expires_at = Column(DateTime, nullable=True, name="accessTokenExpiresAt")
    refresh_token_expires_at = Column(DateTime, nullable=True, name="refreshTokenExpiresAt")
    scope = Column(Text, nullable=True)
    password = Column(Text, nullable=True)  # For email/password auth
    created_at = Column(DateTime, default=datetime.utcnow, name="createdAt")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, name="updatedAt")


class Verification(Base):
    """
    Better Auth 'verification' table.
    
    Used for email verification, password reset tokens, etc.
    """
    __tablename__ = "verification"

    id = Column(String(36), primary_key=True)
    identifier = Column(Text, nullable=False)
    value = Column(Text, nullable=False)
    expires_at = Column(DateTime, nullable=False, name="expiresAt")
    created_at = Column(DateTime, default=datetime.utcnow, name="createdAt")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, name="updatedAt")
