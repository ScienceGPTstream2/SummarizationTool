"""
Evaluation Result Model

Stores LLM-as-judge evaluation scores for extraction results.
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column,
    Text,
    Float,
    DateTime,
    ForeignKey,
    Index,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from models.base import Base


class EvaluationResult(Base):
    """
    An evaluation score for an extraction result.

    Replaces the Supabase 'evaluation_results' table.
    """

    __tablename__ = "evaluation_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    extraction_result_id = Column(
        UUID(as_uuid=True),
        ForeignKey("extraction_results.id", ondelete="CASCADE"),
        nullable=False,
    )

    metric = Column(
        Text, nullable=False
    )  # correctness, completeness, relevance, safety
    score = Column(Float, nullable=True)
    reasoning = Column(Text, nullable=True)
    judge_model = Column(Text, nullable=True)  # Model used for evaluation

    human_score = Column(Float, nullable=True)
    ground_truth = Column(Text, nullable=True)

    evaluation_cost = Column(Float, nullable=True)
    evaluation_time = Column(Float, nullable=True)

    evaluated_at = Column(DateTime, default=datetime.utcnow)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "extraction_result_id",
            "metric",
            "judge_model",
            name="uq_eval_extraction_metric_judge",
        ),
        Index("idx_evaluation_results_extraction_id", "extraction_result_id"),
        Index("idx_evaluation_results_judge", "judge_model"),
    )
