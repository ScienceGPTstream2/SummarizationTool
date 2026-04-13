"""
Document Model

Stores document metadata for files uploaded to sessions.
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column,
    String,
    Text,
    Float,
    Integer,
    DateTime,
    ForeignKey,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID
from models.base import Base


class Document(Base):
    """
    A document within an extraction session.

    Replaces the Supabase 'documents' table.
    """

    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("app_sessions.id", ondelete="CASCADE"),
        nullable=True,
    )
    user_id = Column(
        String(36), ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )

    file_hash = Column(Text, nullable=False)
    filename = Column(Text, nullable=False)
    file_path = Column(Text, nullable=True)
    study_type = Column(Text, nullable=True)

    # Processing info
    processor_used = Column(Text, nullable=True)  # azure_doc_intelligence, docling
    processing_status = Column(
        Text, default="pending"
    )  # pending, processing, completed, error
    processing_error = Column(Text, nullable=True)
    extracted_text_path = Column(Text, nullable=True)
    processed_at = Column(DateTime, nullable=True)

    # Cost and metrics
    parse_cost = Column(Float, nullable=True)
    page_count = Column(Integer, nullable=True)
    parse_duration_seconds = Column(Float, nullable=True)
    figure_count = Column(Integer, nullable=True)
    table_count = Column(Integer, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_documents_session_id", "session_id"),
        Index("idx_documents_user_id", "user_id"),
        Index("idx_documents_file_hash", "file_hash"),
    )
