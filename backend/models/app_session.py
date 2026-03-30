"""
Application Session Model

This is the app's "extraction workflow session" — NOT Better Auth's auth session.
Named AppSession to avoid collision with Better Auth's Session table.
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Float, Integer, DateTime, ForeignKey, Index,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from models.base import Base


class AppSession(Base):
    """
    An extraction workflow session. Users create sessions to track
    document uploads, entity extractions, and evaluations.
    
    Replaces the Supabase 'sessions' table.
    """
    __tablename__ = "app_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String(36), ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, default="Untitled Session")
    status = Column(Text, default="in_progress")  # in_progress, completed
    last_step = Column(Text, default="upload")     # upload, processing, study_selection, extraction, evaluation

    # Configuration stored as JSON
    configuration = Column(JSONB, default=dict)
    evaluation_config = Column(JSONB, default=dict)
    files_config = Column(JSONB, default=dict)

    # Session metrics (atomic increments via SQL)
    total_cost = Column(Float, default=0.0)
    total_latency = Column(Float, default=0.0)
    total_calls = Column(Integer, default=0)

    # Session sharing
    shared_with_group_id = Column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="SET NULL"), nullable=True)
    shared_by = Column(String(36), ForeignKey("user.id"), nullable=True)
    shared_at = Column(DateTime, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_app_sessions_user_id", "user_id"),
        Index("idx_app_sessions_updated_at", "updated_at"),
        Index("idx_app_sessions_shared_group", "shared_with_group_id",
              postgresql_where="shared_with_group_id IS NOT NULL"),
    )
