"""
Eval Job Record Model

Persistent store for background evaluation job state.
Used to give any Gunicorn worker cross-worker visibility
into jobs started by other workers.
"""

from datetime import datetime
from sqlalchemy import Column, Text, Integer, DateTime, Index
from sqlalchemy.dialects.postgresql import JSONB
from models.base import Base


class EvalJobRecord(Base):
    """
    Persisted snapshot of an EvalJob's status and results.

    The in-memory _JOBS dict in job_queue.py is the authoritative
    source for actively-running jobs on this worker. This table is
    written to on job start/completion so other workers can answer
    status-poll requests without needing shared memory.
    """

    __tablename__ = "eval_jobs"

    job_id = Column(Text, primary_key=True)
    session_id = Column(Text, nullable=True)
    user_id = Column(Text, nullable=True)
    status = Column(Text, nullable=False, default="pending")
    progress = Column(Integer, nullable=False, default=0)
    total = Column(Integer, nullable=False, default=0)
    # Serialised as the same dicts returned by to_status_dict()
    results = Column(JSONB, nullable=True, default=list)
    errors = Column(JSONB, nullable=True, default=list)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_eval_jobs_status", "status"),
        Index("idx_eval_jobs_user_id", "user_id"),
    )
