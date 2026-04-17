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
    model_temperatures: Optional[Dict[str, float]] = Field(
        default_factory=dict
    )  # Per-model temperature overrides (model_id -> temperature)
    files_config: Optional[Dict[str, Any]] = Field(
        default_factory=dict
    )  # Per-file configurations
    evaluation_config: Optional[Dict[str, Any]] = Field(
        default_factory=dict
    )  # Evaluation settings (metrics, models, prompts)


class SessionDocument(BaseModel):
    """Document reference within a session"""

    file_hash: str
    filename: str
    id: Optional[str] = None
    processor_used: Optional[str] = None
    parse_cost: Optional[float] = None
    page_count: Optional[int] = None
    parse_duration_seconds: Optional[float] = None
    figure_count: Optional[int] = None
    table_count: Optional[int] = None


class ExtractionResult(BaseModel):
    """Extraction result for a single entity"""

    entity_name: str
    model_id: str
    document_id: Optional[str] = None
    extracted_text: Optional[str] = None
    references: Optional[List[Dict[str, Any]]] = None
    status: Literal["pending", "completed", "error"] = "pending"
    error_message: Optional[str] = None
    extracted_at: Optional[datetime] = None
    file_hash: Optional[str] = None
    # Token usage and cost tracking
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    duration_ms: Optional[int] = None
    cost: Optional[float] = None


class SessionMetrics(BaseModel):
    """Aggregated session metrics (stored in sessions table)"""

    total_cost: float = 0.0
    total_latency: float = 0.0
    total_calls: int = 0


class EvaluationScore(BaseModel):
    """Evaluation score from a judge"""

    metric: str  # correctness, completeness, relevance, safety
    score: Optional[float] = None
    reasoning: Optional[str] = None
    judge_model: Optional[str] = None
    human_score: Optional[float] = None  # Per-judge human evaluation score
    evaluation_cost: Optional[float] = None  # Cost of this evaluation metric
    evaluation_time: Optional[float] = None  # Time taken for this evaluation metric


class EvaluationResult(BaseModel):
    """Evaluation result for an extraction"""

    document_id: Optional[str] = None  # Links to specific document for per-doc scores
    file_hash: Optional[str] = (
        None  # Alternative way to identify document (used by frontend)
    )
    entity_name: str
    model_id: str  # Source model that produced the extraction
    ground_truth: Optional[str] = None
    scores: List[EvaluationScore] = Field(default_factory=list)
    human_score: Optional[float] = None
    evaluated_at: Optional[datetime] = None
    evaluation_cost: Optional[float] = None  # Cost of the evaluation call
    evaluation_time: Optional[float] = None  # Time taken for the evaluation


class Session(BaseModel):
    """Full session model with configuration, results, and evaluations"""

    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str = "Untitled Session"
    status: Literal["in_progress", "completed"] = "in_progress"
    last_step: Optional[str] = "upload"
    evaluation_config: Optional[Dict[str, Any]] = Field(default_factory=dict)
    files_config: Optional[Dict[str, Any]] = Field(default_factory=dict)
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

    # Session metrics (LLM call tracking)
    session_metrics: Optional[SessionMetrics] = None


# Request/Response schemas for API


class CreateSessionRequest(BaseModel):
    """Request to create a new session"""

    user_id: str
    name: Optional[str] = "Untitled Session"
    last_step: Optional[str] = "upload"
    configuration: Optional[SessionConfiguration] = None
    evaluation_config: Optional[Dict[str, Any]] = None
    files_config: Optional[Dict[str, Any]] = None
    documents: Optional[List[SessionDocument]] = None


class UpdateSessionRequest(BaseModel):
    """Request to update an existing session"""

    user_id: str
    name: Optional[str] = None
    status: Optional[Literal["in_progress", "completed"]] = None
    last_step: Optional[str] = None
    configuration: Optional[SessionConfiguration] = None
    evaluation_config: Optional[Dict[str, Any]] = None
    files_config: Optional[Dict[str, Any]] = None
    documents: Optional[List[SessionDocument]] = None
    extraction_results: Optional[List[ExtractionResult]] = None
    evaluation_results: Optional[List[EvaluationResult]] = None


class SessionSummary(BaseModel):
    """Lightweight session summary for list views"""

    session_id: str
    name: str
    status: Literal["in_progress", "completed"]
    created_at: datetime
    updated_at: datetime
    last_step: Optional[str] = None
    study_type: Optional[str] = None
    document_count: int
    document_names: List[str] = Field(default_factory=list)
    extraction_count: int
    evaluation_count: int
    # Sharing metadata (populated for shared session listings)
    shared_by_name: Optional[str] = None
    shared_group_name: Optional[str] = None
    shared_at: Optional[datetime] = None
    owner_user_id: Optional[str] = None


class SessionListResponse(BaseModel):
    """Response for listing sessions"""

    sessions: List[SessionSummary]
    total: int
