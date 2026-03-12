"""
Evaluation Service - Main Orchestrator

This service coordinates entity extraction evaluation using G-Eval metrics.
Supports both Azure OpenAI and Vertex AI for LLM-as-a-judge evaluation.
"""

import asyncio
import json
import re
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional

from deepeval.test_case import LLMTestCase

from .adapters import (
    AzureOpenAIDeepEvalModel,
    VertexAIDeepEvalModel,
    AnthropicVertexDeepEvalModel,
)
from .metrics import (
    CorrectnessMetricFactory,
    CompletenessMetricFactory,
    RelevanceMetricFactory,
    SafetyMetricFactory,
    CustomMetricFactory,
)
from .storage import EvaluationResultStorage

# ---------------------------------------------------------------------------
# Global session cancellation registry
# ---------------------------------------------------------------------------
# When the user clicks "Stop Evaluation", the frontend POSTs the session_id
# here. bounded_evaluate checks this set before each entity — skipping any
# queued work so the backend stops processing as quickly as possible.
CANCELLED_SESSIONS: set[str] = set()


def cancel_session(session_id: str) -> None:
    """Register a session as cancelled. Thread-safe for asyncio."""
    CANCELLED_SESSIONS.add(session_id)


def clear_cancelled_session(session_id: str) -> None:
    """Remove a session from the cancelled set after the batch finishes."""
    CANCELLED_SESSIONS.discard(session_id)


def is_session_cancelled(session_id: Optional[str]) -> bool:
    """Return True if this session has been cancelled."""
    return session_id is not None and session_id in CANCELLED_SESSIONS


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
            provider: 'azure_openai', 'vertex_ai', or 'anthropic'
            deployment: Azure deployment name
            endpoint: Azure endpoint
            api_key: Azure API key
            model_name: Model name
            project: GCP project for Vertex AI / Anthropic
            location: GCP location for Vertex AI / Anthropic

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
        elif provider == "anthropic":
            return AnthropicVertexDeepEvalModel(
                model_name=model_name or "claude-sonnet-4-5@20250929",
                project=project,
                location=location or "global",
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

    async def _evaluate_combined(
        self,
        eval_model,
        metric_objects: List,
        test_case,
    ) -> List[Dict[str, Any]]:
        """Score all metrics in ONE LLM call instead of N separate calls.

        This is ~4× faster than calling a_measure() per metric because:
        - 1 HTTP round-trip instead of N (critical when each call is 3–15s)
        - The full extraction prompt (often a long document) is sent once, not N times

        Falls back to per-metric calls if the combined response can't be parsed.
        """
        # Metric descriptions block
        metric_blocks = []
        for metric in metric_objects:
            steps = "\n".join(
                f"  {i + 1}. {s}" for i, s in enumerate(metric.evaluation_steps or [])
            )
            metric_blocks.append(f'"{metric.name}":\n{steps}')

        # Context block
        context_parts = [
            f"[Extraction Task]\n{test_case.input}",
            f"[Actual Output]\n{test_case.actual_output}",
        ]
        if test_case.expected_output:
            context_parts.append(f"[Expected Output]\n{test_case.expected_output}")

        # Expected JSON shape so the model knows exactly what to produce
        json_shape = (
            "{\n"
            + ",\n".join(
                f'  "{m.name}": {{"score": <0.0-1.0>, "reason": "<one sentence>"}}'
                for m in metric_objects
            )
            + "\n}"
        )

        prompt = (
            "You are an expert evaluator. Score the AI extraction below on each "
            "criterion (0.0 = worst, 1.0 = best). Be concise.\n\n"
            + "\n\n".join(context_parts)
            + "\n\n---\nCriteria:\n\n"
            + "\n\n".join(metric_blocks)
            + f"\n\nReturn ONLY valid JSON with this exact structure:\n{json_shape}"
        )

        raw = await eval_model.a_generate(prompt)

        # Robust JSON parsing — handles code fences, leading prose, nested objects
        def _parse(text: str) -> dict:
            text = text.strip()
            # 1. Already valid
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                pass
            # 2. Strip markdown code fences
            no_fence = re.sub(r"```(?:json)?\s*", "", text).strip("`").strip()
            try:
                return json.loads(no_fence)
            except json.JSONDecodeError:
                pass
            # 3. Outermost {...} block (greedy then non-greedy)
            for pattern in (r"\{[\s\S]*\}", r"\{[\s\S]*?\}"):
                m = re.search(pattern, text)
                if m:
                    try:
                        return json.loads(m.group())
                    except json.JSONDecodeError:
                        continue
            raise ValueError(f"Cannot parse combined eval JSON: {text[:300]}")

        data = _parse(raw)

        results = []
        for metric in metric_objects:
            entry = data.get(metric.name)
            if entry is None:
                # Case-insensitive fallback
                for key, val in data.items():
                    if key.lower() == metric.name.lower():
                        entry = val
                        break
            if not entry:
                entry = {"score": 0.0, "reason": "missing from combined response"}

            score = max(0.0, min(1.0, float(entry.get("score", 0.0))))
            reason = str(entry.get("reason", ""))
            metric.score = score
            metric.reason = reason
            metric.success = score >= metric.threshold
            results.append(
                {
                    "metric_name": metric.name,
                    "score": score,
                    "threshold": metric.threshold,
                    "success": metric.success,
                    "reason": reason,
                }
            )
        return results

    async def evaluate_extraction(
        self,
        entity_name: str,
        extraction_prompt: str,
        actual_output: str,
        expected_output: Optional[str] = None,
        metrics: Optional[List[str]] = None,
        provider: str = "azure_openai",
        threshold: float = 0.5,
        strict_mode: bool = False,
        custom_evaluation_steps: Optional[Dict[str, List[str]]] = None,
        session_id: Optional[str] = None,
        **model_kwargs,
    ) -> Dict[str, Any]:
        """
        Evaluate an entity extraction using G-Eval metrics

        Args:
            entity_name: Name of the entity being extracted
            extraction_prompt: The prompt used for extraction
            actual_output: The actual extracted output
            expected_output: The expected/ground truth output (optional)
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
            )

            # Run all metrics in ONE combined LLM call (~4× faster than N separate calls).
            # Falls back to N parallel calls if the combined response can't be parsed.
            try:
                results = await self._evaluate_combined(
                    eval_model, metric_objects, test_case
                )
            except Exception as combined_exc:
                print(
                    f"[EvalService] Combined eval failed ({combined_exc}), "
                    "falling back to per-metric calls"
                )

                async def evaluate_single_metric(metric):
                    await metric.a_measure(test_case)
                    return {
                        "metric_name": metric.name,
                        "score": metric.score,
                        "threshold": metric.threshold,
                        "success": metric.is_successful(),
                        "reason": metric.reason,
                    }

                results = list(
                    await asyncio.gather(
                        *[evaluate_single_metric(m) for m in metric_objects]
                    )
                )

            call_history = getattr(eval_model, "call_history", []) or []
            if not call_history:
                print(
                    f"[COST_TRACKER] No call history recorded for provider={provider} model={eval_model.get_model_name()}"
                )
            try:
                from services.telemetry.cost_tracker import cost_tracker

                provider_key = "azure" if provider == "azure_openai" else "gcp"
                call_costs = []
                for call in call_history:
                    print(
                        "[COST_TRACKER] Eval call usage:",
                        {
                            "provider": provider_key,
                            "model": call.get("model") or eval_model.get_model_name(),
                            "prompt_tokens": call.get("prompt_tokens"),
                            "completion_tokens": call.get("completion_tokens"),
                            "duration": call.get("duration"),
                        },
                    )
                    call_cost = cost_tracker.estimate_call_cost(
                        provider=provider_key,
                        model=call.get("model") or eval_model.get_model_name(),
                        prompt_tokens=call.get("prompt_tokens"),
                        completion_tokens=call.get("completion_tokens"),
                    )
                    if call_cost == 0.0:
                        print(
                            "[COST_TRACKER] Estimated 0 cost for call; check pricing key/token usage",
                        )
                    call_costs.append(call_cost)
                    cost_tracker.record_call(
                        session_id=session_id,
                        provider=provider_key,
                        model=call.get("model") or eval_model.get_model_name(),
                        prompt_tokens=call.get("prompt_tokens"),
                        completion_tokens=call.get("completion_tokens"),
                        duration=call.get("duration"),
                    )
            except Exception as e:
                print(f"[COST_TRACKER] Failed to record evaluation metrics: {e}")
                call_costs = []

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
                # call_metrics and test_case intentionally omitted from response:
                # - call_metrics (full LLM prompt history) is consumed server-side for cost
                #   tracking above and adds hundreds of KB per response with no frontend use.
                # - test_case just echoes back what the caller already sent.
                "evaluation_cost": sum(call_costs) if call_costs else 0.0,
                "metrics": results,
                "aggregate_score": avg_score,
                "all_passed": all_passed,
                "threshold": threshold,
                "strict_mode": strict_mode,
                "status": "success",
            }

            # NOTE: storage.save() intentionally removed — results are persisted to
            # PostgreSQL by the job queue's add_evaluation_result_fast() call.
            # Writing UUID-named JSON files per eval had no reader and caused
            # unbounded growth in output/evaluations/ on every re-run.
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

            return error_result

    async def evaluate_multiple_extractions(
        self,
        extractions: List[Dict[str, Any]],
        provider: str = "azure_openai",
        threshold: float = 0.5,
        metrics: Optional[List[str]] = None,
        custom_evaluation_steps: Optional[Dict[str, List[str]]] = None,
        batch_size: int = 20,
        session_id: Optional[str] = None,
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

        # Clear any stale cancellation from a previous stopped run.
        # This must happen at the START so all judges in a new run begin fresh.
        # We do NOT clear it at the end — another judge may still be checking it.
        if session_id:
            clear_cancelled_session(session_id)

        if metrics is None:
            metrics = ["correctness", "completeness", "relevance", "safety"]

        async def evaluate_one(extraction):
            """Run evaluation for a single extraction."""
            return await self.evaluate_extraction(
                entity_name=extraction.get("entity_name", "Unknown"),
                extraction_prompt=extraction.get("extraction_prompt", ""),
                actual_output=extraction.get("actual_output", ""),
                expected_output=extraction.get("expected_output"),
                metrics=metrics,
                provider=provider,
                threshold=threshold,
                custom_evaluation_steps=custom_evaluation_steps,
                session_id=session_id,
                **model_kwargs,
            )

        results: list = []
        for i in range(0, len(extractions), batch_size):
            if is_session_cancelled(session_id):
                # Fill remaining with cancelled placeholders
                results.extend(
                    {
                        "entity_name": e.get("entity_name", "Unknown"),
                        "status": "cancelled",
                        "provider": provider,
                    }
                    for e in extractions[i:]
                )
                break

            mini_batch = extractions[i : i + batch_size]
            mini_results = await asyncio.gather(*[evaluate_one(e) for e in mini_batch])
            results.extend(mini_results)

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
