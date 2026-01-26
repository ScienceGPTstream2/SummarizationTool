"""Schemas for user session management"""

from pydantic import BaseModel, Field
from typing import Optional, List, Literal, Dict, Any
from datetime import datetime
import uuid


class SessionEntity(BaseModel):
    """Entity configuration within a session"""

    name: str
    prompt: str
    system_prompt: Optional[str] = None


class SessionConfiguration(BaseModel):
    """Configuration snapshot for a session"""

    study_type: Optional[str] = None
    selected_models: List[str] = Field(default_factory=list)
    entities: List[SessionEntity] = Field(default_factory=list)
    summary_prompt: Optional[str] = None
    paragraph_system_prompt: Optional[str] = None
    temperature: float = 0.0


class SessionDocument(BaseModel):
    """Document reference within a session"""

    file_hash: str
    filename: str


class ExtractionResult(BaseModel):
    """Extraction result for a single entity"""

    entity_name: str
    model_id: str
    extracted_text: Optional[str] = None
    references: Optional[List[Dict[str, Any]]] = None
    status: Literal["pending", "completed", "error"] = "pending"
    error_message: Optional[str] = None
    extracted_at: Optional[datetime] = None


class EvaluationScore(BaseModel):
    """Evaluation score from a judge"""

    metric: str  # correctness, completeness, relevance, safety
    score: Optional[float] = None
    reasoning: Optional[str] = None
    judge_model: Optional[str] = None


class EvaluationResult(BaseModel):
    """Evaluation result for an extraction"""

    entity_name: str
    model_id: str  # Source model that produced the extraction
    ground_truth: Optional[str] = None
    scores: List[EvaluationScore] = Field(default_factory=list)
    human_score: Optional[float] = None
    evaluated_at: Optional[datetime] = None


class Session(BaseModel):
    """Full session model with configuration, results, and evaluations"""

    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str = "Untitled Session"
    status: Literal["draft", "in_progress", "completed"] = "draft"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # Configuration snapshot
    configuration: SessionConfiguration = Field(default_factory=SessionConfiguration)

    # Documents used
    documents: List[SessionDocument] = Field(default_factory=list)

    # Extraction results
    extraction_results: List[ExtractionResult] = Field(default_factory=list)

    # Evaluation results
    evaluation_results: List[EvaluationResult] = Field(default_factory=list)


# Request/Response schemas for API


class CreateSessionRequest(BaseModel):
    """Request to create a new session"""

    user_id: str
    name: Optional[str] = "Untitled Session"
    configuration: Optional[SessionConfiguration] = None
    documents: Optional[List[SessionDocument]] = None


class UpdateSessionRequest(BaseModel):
    """Request to update an existing session"""

    user_id: str
    name: Optional[str] = None
    status: Optional[Literal["draft", "in_progress", "completed"]] = None
    configuration: Optional[SessionConfiguration] = None
    documents: Optional[List[SessionDocument]] = None
    extraction_results: Optional[List[ExtractionResult]] = None
    evaluation_results: Optional[List[EvaluationResult]] = None


class SessionSummary(BaseModel):
    """Lightweight session summary for list views"""

    session_id: str
    name: str
    status: Literal["draft", "in_progress", "completed"]
    created_at: datetime
    updated_at: datetime
    document_count: int
    extraction_count: int
    evaluation_count: int


class SessionListResponse(BaseModel):
    """Response for listing sessions"""

    sessions: List[SessionSummary]
    total: int
