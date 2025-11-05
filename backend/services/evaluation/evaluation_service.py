"""
Evaluation Service - Main Orchestrator

This service coordinates entity extraction evaluation using G-Eval metrics.
Supports both Azure OpenAI and Vertex AI for LLM-as-a-judge evaluation.
"""

import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional

from deepeval.test_case import LLMTestCase

from .adapters import AzureOpenAIDeepEvalModel, VertexAIDeepEvalModel
from .metrics import (
    CorrectnessMetricFactory,
    CompletenessMetricFactory,
    RelevanceMetricFactory,
    SafetyMetricFactory,
    CustomMetricFactory,
)
from .storage import EvaluationResultStorage


class EvaluationService:
    """
    Main evaluation service orchestrator

    Coordinates LLM provider adapters, metric factories, and result storage
    to provide a unified evaluation interface.
    """

    # Map metric names to factory classes
    METRIC_FACTORIES = {
        "correctness": CorrectnessMetricFactory,
        "completeness": CompletenessMetricFactory,
        "relevance": RelevanceMetricFactory,
        "safety": SafetyMetricFactory,
    }

    def __init__(self, output_dir: Optional[str] = None):
        """
        Initialize evaluation service

        Args:
            output_dir: Directory to store evaluation results
        """
        self.storage = EvaluationResultStorage(output_dir)

    def create_evaluation_model(
        self,
        provider: str = "azure_openai",
        deployment: Optional[str] = None,
        endpoint: Optional[str] = None,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        project: Optional[str] = None,
        location: Optional[str] = None,
    ):
        """
        Create a DeepEval-compatible LLM model for evaluation

        Args:
            provider: 'azure_openai' or 'vertex_ai'
            deployment: Azure deployment name
            endpoint: Azure endpoint
            api_key: Azure API key
            model_name: Model name
            project: GCP project for Vertex AI
            location: GCP location for Vertex AI

        Returns:
            DeepEvalBaseLLM instance
        """
        if provider == "azure_openai":
            return AzureOpenAIDeepEvalModel(
                deployment=deployment,
                endpoint=endpoint,
                api_key=api_key,
                model_name=model_name,
            )
        elif provider == "vertex_ai":
            return VertexAIDeepEvalModel(
                model_name=model_name or "gemini-2.5-flash",
                project=project,
                location=location,
            )
        else:
            raise ValueError(f"Unsupported provider: {provider}")

    def create_metric(
        self,
        metric_name: str,
        model,
        threshold: float = 0.5,
        strict_mode: bool = False,
        custom_steps: Optional[List[str]] = None,
    ):
        """
        Create a metric using the appropriate factory

        Args:
            metric_name: Name of metric ('correctness', 'completeness', etc.)
            model: DeepEval model for evaluation
            threshold: Score threshold for passing
            strict_mode: If True, only perfect scores pass
            custom_steps: Custom evaluation steps (optional)

        Returns:
            GEval metric instance
        """
        factory = self.METRIC_FACTORIES.get(metric_name)
        if not factory:
            raise ValueError(f"Unknown metric: {metric_name}")

        return factory.create(
            model=model,
            threshold=threshold,
            strict_mode=strict_mode,
            custom_steps=custom_steps,
        )

    def create_custom_metric(
        self,
        name: str,
        evaluation_steps: List[str],
        model,
        evaluation_params: Optional[List] = None,
        threshold: float = 0.5,
        strict_mode: bool = False,
    ):
        """
        Create a custom metric with user-defined criteria

        Args:
            name: Name of the metric
            evaluation_steps: List of evaluation steps
            model: DeepEval model for evaluation
            evaluation_params: Parameters to use
            threshold: Score threshold for passing
            strict_mode: If True, only perfect scores pass

        Returns:
            GEval metric instance
        """
        return CustomMetricFactory.create(
            name=name,
            evaluation_steps=evaluation_steps,
            model=model,
            evaluation_params=evaluation_params,
            threshold=threshold,
            strict_mode=strict_mode,
        )

    async def evaluate_extraction(
        self,
        entity_name: str,
        extraction_prompt: str,
        actual_output: str,
        expected_output: Optional[str] = None,
        retrieval_context: Optional[str] = None,
        metrics: Optional[List[str]] = None,
        provider: str = "azure_openai",
        threshold: float = 0.5,
        strict_mode: bool = False,
        custom_evaluation_steps: Optional[Dict[str, List[str]]] = None,
        **model_kwargs,
    ) -> Dict[str, Any]:
        """
        Evaluate an entity extraction using G-Eval metrics

        Args:
            entity_name: Name of the entity being extracted
            extraction_prompt: The prompt used for extraction
            actual_output: The actual extracted output
            expected_output: The expected/ground truth output (optional)
            retrieval_context: Source markdown/context used for extraction
            metrics: List of metric names ('correctness', 'completeness', 'relevance', 'safety', 'all')
            provider: LLM provider for evaluation ('azure_openai' or 'vertex_ai')
            threshold: Score threshold for passing
            strict_mode: If True, only perfect scores pass
            custom_evaluation_steps: Custom evaluation steps for each metric (optional)
            **model_kwargs: Additional model configuration

        Returns:
            Dict containing evaluation results
        """
        evaluation_id = str(uuid.uuid4())
        start_time = datetime.now()

        try:
            # Create evaluation model
            eval_model = self.create_evaluation_model(provider=provider, **model_kwargs)

            # Determine which metrics to use
            if metrics is None or "all" in metrics:
                metric_names = ["correctness", "completeness", "relevance", "safety"]
            else:
                metric_names = metrics

            # Create metric instances
            metric_objects = []
            for metric_name in metric_names:
                # Skip metrics that require expected_output if it's not provided
                if (
                    metric_name in ["correctness", "completeness"]
                    and not expected_output
                ):
                    continue

                if metric_name in self.METRIC_FACTORIES:
                    # Get custom steps for this metric if provided
                    custom_steps = None
                    if (
                        custom_evaluation_steps
                        and metric_name in custom_evaluation_steps
                    ):
                        custom_steps = custom_evaluation_steps[metric_name]

                    metric = self.create_metric(
                        metric_name=metric_name,
                        model=eval_model,
                        threshold=threshold,
                        strict_mode=strict_mode,
                        custom_steps=custom_steps,
                    )
                    metric_objects.append(metric)

            if not metric_objects:
                raise ValueError(
                    "No metrics could be created. Ensure expected_output is provided for correctness/completeness metrics."
                )

            # Create test case
            test_case = LLMTestCase(
                input=extraction_prompt,
                actual_output=actual_output,
                expected_output=expected_output,
                retrieval_context=[retrieval_context] if retrieval_context else None,
            )

            # Run evaluation for each metric
            results = []
            for metric in metric_objects:
                await metric.a_measure(test_case)

                results.append(
                    {
                        "metric_name": metric.name,
                        "score": metric.score,
                        "threshold": metric.threshold,
                        "success": metric.is_successful(),
                        "reason": metric.reason,
                    }
                )

            # Calculate aggregate score
            avg_score = sum(r["score"] for r in results) / len(results)
            all_passed = all(r["success"] for r in results)

            # Create evaluation report
            end_time = datetime.now()
            evaluation_time = (end_time - start_time).total_seconds()

            evaluation_result = {
                "evaluation_id": evaluation_id,
                "entity_name": entity_name,
                "provider": provider,
                "model": eval_model.get_model_name(),
                "timestamp": start_time.isoformat(),
                "evaluation_time": evaluation_time,
                "test_case": {
                    "input": extraction_prompt,
                    "actual_output": actual_output,
                    "expected_output": expected_output,
                    "has_retrieval_context": retrieval_context is not None,
                },
                "metrics": results,
                "aggregate_score": avg_score,
                "all_passed": all_passed,
                "threshold": threshold,
                "strict_mode": strict_mode,
                "status": "success",
            }

            # Save evaluation result
            await self.storage.save(evaluation_id, evaluation_result)

            return evaluation_result

        except Exception as e:
            error_result = {
                "evaluation_id": evaluation_id,
                "entity_name": entity_name,
                "provider": provider,
                "timestamp": start_time.isoformat(),
                "status": "error",
                "error": str(e),
            }

            # Try to save error result
            try:
                await self.storage.save(evaluation_id, error_result)
            except:
                pass

            return error_result

    async def evaluate_multiple_extractions(
        self,
        extractions: List[Dict[str, Any]],
        provider: str = "azure_openai",
        threshold: float = 0.5,
        metrics: Optional[List[str]] = None,
        **model_kwargs,
    ) -> Dict[str, Any]:
        """
        Evaluate multiple entity extractions in batch

        Args:
            extractions: List of extraction dicts
            provider: LLM provider for evaluation
            threshold: Score threshold for passing
            metrics: List of metric names to use
            **model_kwargs: Additional model configuration

        Returns:
            Dict containing batch evaluation results
        """
        batch_id = str(uuid.uuid4())
        start_time = datetime.now()

        results = []
        for extraction in extractions:
            result = await self.evaluate_extraction(
                entity_name=extraction.get("entity_name", "Unknown"),
                extraction_prompt=extraction.get("extraction_prompt", ""),
                actual_output=extraction.get("actual_output", ""),
                expected_output=extraction.get("expected_output"),
                retrieval_context=extraction.get("retrieval_context"),
                metrics=metrics,
                provider=provider,
                threshold=threshold,
                **model_kwargs,
            )
            results.append(result)

        end_time = datetime.now()
        batch_time = (end_time - start_time).total_seconds()

        # Calculate batch statistics
        successful_evals = [r for r in results if r.get("status") == "success"]
        if successful_evals:
            avg_aggregate_score = sum(
                r.get("aggregate_score", 0) for r in successful_evals
            ) / len(successful_evals)
            all_passed = all(r.get("all_passed", False) for r in successful_evals)
        else:
            avg_aggregate_score = 0.0
            all_passed = False

        batch_result = {
            "batch_id": batch_id,
            "timestamp": start_time.isoformat(),
            "batch_time": batch_time,
            "total_evaluations": len(extractions),
            "successful_evaluations": len(successful_evals),
            "failed_evaluations": len(results) - len(successful_evals),
            "avg_aggregate_score": avg_aggregate_score,
            "all_passed": all_passed,
            "threshold": threshold,
            "provider": provider,
            "results": results,
        }

        # Save batch result
        await self.storage.save(batch_id, batch_result)

        return batch_result

    async def get_evaluation_result(
        self, evaluation_id: str
    ) -> Optional[Dict[str, Any]]:
        """Retrieve evaluation result by ID"""
        return await self.storage.get(evaluation_id)

    async def list_evaluations(self) -> List[Dict[str, Any]]:
        """List all evaluation results"""
        return await self.storage.list_all()
