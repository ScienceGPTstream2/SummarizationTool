"""Schemas for evaluation endpoints"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class EvaluationRequest(BaseModel):
    """Request schema for evaluating a single entity extraction"""

    entity_name: str = Field(..., description="Name of the entity being extracted")
    extraction_prompt: str = Field(..., description="Prompt used for extraction")
    actual_output: str = Field(..., description="The actual extracted output")
    expected_output: Optional[str] = Field(
        None,
        description="Expected/ground truth output (required for correctness/completeness)",
    )
    retrieval_context: Optional[str] = Field(
        None, description="Source markdown/context used for extraction"
    )
    metrics: Optional[List[str]] = Field(
        default=["all"],
        description="List of metrics to use: 'correctness', 'completeness', 'relevance', 'safety', or 'all'",
    )
    provider: str = Field(
        default="azure_openai",
        description="LLM provider for evaluation: 'azure_openai' or 'vertex_ai'",
    )
    threshold: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Score threshold for passing"
    )
    strict_mode: bool = Field(
        default=False, description="If True, only perfect scores pass"
    )
    custom_evaluation_steps: Optional[Dict[str, List[str]]] = Field(
        None,
        description="Custom evaluation steps for each metric (e.g., {'correctness': ['step1', 'step2']})",
    )

    # Azure OpenAI specific fields
    azure_deployment: Optional[str] = Field(
        None, description="Azure OpenAI deployment name"
    )
    azure_endpoint: Optional[str] = Field(None, description="Azure OpenAI endpoint")
    azure_api_key: Optional[str] = Field(None, description="Azure OpenAI API key")
    azure_model_name: Optional[str] = Field(None, description="Azure OpenAI model name")

    # Vertex AI specific fields
    vertex_model_name: Optional[str] = Field(
        default="gemini-2.5-flash", description="Vertex AI model name"
    )
    vertex_project: Optional[str] = Field(None, description="GCP project ID")
    vertex_location: Optional[str] = Field(
        default="us-central1", description="GCP location"
    )

    # Anthropic specific fields (uses Vertex AI infrastructure)
    model_name: Optional[str] = Field(None, description="Model name for Anthropic providers")


class SingleExtractionEval(BaseModel):
    """Schema for a single extraction in batch evaluation"""

    entity_name: str
    extraction_prompt: str
    actual_output: str
    expected_output: Optional[str] = None
    retrieval_context: Optional[str] = None


class BatchEvaluationRequest(BaseModel):
    """Request schema for batch evaluation of multiple extractions"""

    extractions: List[SingleExtractionEval] = Field(
        ..., description="List of extractions to evaluate"
    )
    metrics: Optional[List[str]] = Field(
        default=["all"], description="List of metrics to use"
    )
    provider: str = Field(
        default="azure_openai", description="LLM provider for evaluation"
    )
    threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    strict_mode: bool = Field(default=False)

    # Azure OpenAI specific fields
    azure_deployment: Optional[str] = None
    azure_endpoint: Optional[str] = None
    azure_api_key: Optional[str] = None
    azure_model_name: Optional[str] = None

    # Vertex AI specific fields
    vertex_model_name: Optional[str] = "gemini-2.5-flash"
    vertex_project: Optional[str] = None
    vertex_location: Optional[str] = "us-central1"

    # Anthropic specific fields (uses Vertex AI infrastructure)
    model_name: Optional[str] = None


class CustomMetricRequest(BaseModel):
    """Request schema for creating and running a custom G-Eval metric"""

    metric_name: str = Field(..., description="Name of the custom metric")
    evaluation_steps: List[str] = Field(
        ..., description="List of evaluation steps for the metric"
    )
    entity_name: str = Field(..., description="Name of the entity being extracted")
    extraction_prompt: str = Field(..., description="Prompt used for extraction")
    actual_output: str = Field(..., description="The actual extracted output")
    expected_output: Optional[str] = None
    retrieval_context: Optional[str] = None
    provider: str = Field(default="azure_openai")
    threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    strict_mode: bool = Field(default=False)

    # Azure OpenAI specific fields
    azure_deployment: Optional[str] = None
    azure_endpoint: Optional[str] = None
    azure_api_key: Optional[str] = None
    azure_model_name: Optional[str] = None

    # Vertex AI specific fields
    vertex_model_name: Optional[str] = "gemini-2.5-flash"
    vertex_project: Optional[str] = None
    vertex_location: Optional[str] = "us-central1"


class MetricResult(BaseModel):
    """Schema for a single metric evaluation result"""

    metric_name: str
    score: float
    threshold: float
    success: bool
    reason: str


class EvaluationResponse(BaseModel):
    """Response schema for evaluation results"""

    evaluation_id: str
    entity_name: str
    provider: str
    model: str
    timestamp: str
    evaluation_time: float
    test_case: Dict[str, Any]
    metrics: List[MetricResult]
    aggregate_score: float
    all_passed: bool
    threshold: float
    strict_mode: bool
    status: str
    error: Optional[str] = None


class BatchEvaluationResponse(BaseModel):
    """Response schema for batch evaluation results"""

    batch_id: str
    timestamp: str
    batch_time: float
    total_evaluations: int
    successful_evaluations: int
    failed_evaluations: int
    avg_aggregate_score: float
    all_passed: bool
    threshold: float
    provider: str
    results: List[Dict[str, Any]]
