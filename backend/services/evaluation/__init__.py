"""
Evaluation Service Module

Provides G-Eval metrics-based evaluation for entity extractions using LLM-as-a-judge.
Supports Azure OpenAI and Vertex AI as evaluation models.

Module Structure:
- adapters/: LLM provider adapters (Azure OpenAI, Vertex AI)
- metrics/: Metric factories (Correctness, Completeness, Relevance, Safety, Custom)
- storage/: Result storage and retrieval
- evaluation_service.py: Main orchestrator service
"""

from .evaluation_service import EvaluationService

__all__ = ["EvaluationService"]
