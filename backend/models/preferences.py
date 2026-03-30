"""
User Preferences and Login History Models
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Float, DateTime, ForeignKey, Index, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from models.base import Base


class UserPreferences(Base):
    """
    User preferences for default models, temperature, etc.
    
    Replaces the Supabase 'user_preferences' table.
    """
    __tablename__ = "user_preferences"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(36), ForeignKey("user.id", ondelete="CASCADE"), nullable=False, unique=True)
    
    default_models = Column(JSONB, default=list)
    default_temperature = Column(Float, default=0.0)
    settings = Column(JSONB, default=dict)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_user_preferences_user_id", "user_id"),
    )


class LoginHistory(Base):
    """
    Login history for audit trail.
    
    Replaces the Supabase 'login_history' table.
    """
    __tablename__ = "login_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(36), ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    
    ip_address = Column(Text, nullable=True)
    user_agent = Column(Text, nullable=True)
    login_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_login_history_user_id", "user_id"),
        Index("idx_login_history_login_at", "login_at"),
    )


class UserPromptTemplate(Base):
    """
    Legacy user-scoped prompt templates (simple key-value).
    
    Replaces the Supabase 'user_prompt_templates' table.
    """
    __tablename__ = "user_prompt_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(36), ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    entity_name = Column(Text, nullable=False)
    prompt_content = Column(Text, nullable=False)
    study_type = Column(Text, nullable=True)
    system_prompt = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "name", "entity_name", name="uq_user_prompt_template"),
        Index("idx_user_prompt_templates_user_id", "user_id"),
    )
