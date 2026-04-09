"""
Extraction Result Model

Stores entity extraction results from LLM processing.
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column, Text, Float, Integer, DateTime, ForeignKey, Index, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from models.base import Base


class ExtractionResult(Base):
    """
    An extraction result for a specific entity from a specific model.
    
    Replaces the Supabase 'extraction_results' table.
    """
    __tablename__ = "extraction_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("app_sessions.id", ondelete="CASCADE"), nullable=False)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    
    entity_name = Column(Text, nullable=False)
    model_id = Column(Text, nullable=False)
    
    extracted_text = Column(Text, nullable=True)
    bbox_references = Column(JSONB, nullable=True)  # Bounding box references
    
    status = Column(Text, default="pending")  # pending, completed, error
    error_message = Column(Text, nullable=True)
    extracted_at = Column(DateTime, nullable=True)
    
    # Token usage and cost
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    cost = Column(Float, nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        # Upsert conflict target
        UniqueConstraint("document_id", "entity_name", "model_id", name="uq_extraction_doc_entity_model"),
        Index("idx_extraction_results_session_id", "session_id"),
        Index("idx_extraction_results_document_id", "document_id"),
        Index("idx_extraction_results_entity_model", "entity_name", "model_id"),
    )
