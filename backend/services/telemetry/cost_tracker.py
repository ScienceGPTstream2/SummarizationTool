import asyncio
import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, List


@dataclass
class CallMetric:
    provider: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    duration: float
    cost: float
    timestamp: str
    document_name: Optional[str] = None
    page_count: int = 0
    figure_count: int = 0
    table_count: int = 0
    batch_number: Optional[int] = None


@dataclass
class BatchMetric:
    batch_number: int
    batch_latency: float
    document_count: int


@dataclass
class SessionMetrics:
    session_id: str
    total_cost: float = 0.0
    total_latency: float = 0.0
    total_calls: int = 0
    calls: List[CallMetric] = field(default_factory=list)
    batches: Dict[int, BatchMetric] = field(default_factory=dict)


class CostTracker:
    def __init__(self) -> None:
        self._pricing = self._load_pricing()
        self._sessions: Dict[str, SessionMetrics] = {}
        self._db_service = None  # Lazy-loaded to avoid circular imports

    def _get_db_service(self):
        """Lazy-load the database service to avoid circular imports"""
        if self._db_service is None:
            try:
                from services.database import get_db_service

                self._db_service = get_db_service()
            except Exception as e:
                print(f"[COST_TRACKER] Failed to load DB service: {e}")
        return self._db_service

    def _load_pricing(self) -> Dict[str, Dict[str, float]]:
        # Load baked-in defaults from config/pricing.json
        pricing_path = Path(__file__).resolve().parents[2] / "config" / "pricing.json"
        models: Dict[str, Dict[str, float]] = {}
        if pricing_path.exists():
            with open(pricing_path, "r", encoding="utf-8") as f:
                models = json.load(f).get("models", {})

        # Merge overrides from env var (JSON string).
        # This allows adding/updating model pricing without rebuilding the
        # Docker image — set PRICING_JSON_OVERRIDE as a Key Vault secret or
        # container app env var containing a JSON object like:
        #   {"azure:gpt-5.4-nano": {"input_per_million": 0.05, ...}}
        override_raw = os.environ.get("PRICING_JSON_OVERRIDE")
        if override_raw:
            try:
                overrides = json.loads(override_raw)
                if isinstance(overrides, dict):
                    models.update(overrides)
                    print(
                        f"[COST_TRACKER] Applied pricing overrides for: "
                        f"{list(overrides.keys())}"
                    )
            except (json.JSONDecodeError, TypeError) as e:
                print(f"[COST_TRACKER] Failed to parse PRICING_JSON_OVERRIDE: {e}")

        return models

    def _compute_cost(
        self,
        provider: str,
        model: str,
        prompt_tokens: Optional[int],
        completion_tokens: Optional[int],
        page_count: Optional[int] = None,
        duration: Optional[float] = None,
    ) -> float:
        prompt_tokens = int(prompt_tokens or 0)
        completion_tokens = int(completion_tokens or 0)
        page_count_value = int(page_count or 0)

        normalized_key = self._normalize_model_key(model, provider)
        pricing = self._pricing.get(normalized_key, self._pricing.get(model, {}))
        if not pricing:
            print(
                "[COST_TRACKER] No pricing found for model",
                {"provider": provider, "model": model, "normalized": normalized_key},
            )
        if prompt_tokens == 0 and completion_tokens == 0:
            print(
                "[COST_TRACKER] Token usage missing or zero",
                {
                    "provider": provider,
                    "model": model,
                    "normalized": normalized_key,
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                },
            )
        prompt_rate = pricing.get("input_per_million") or pricing.get(
            "prompt_cost_per_1k_tokens", 0.0
        )
        completion_rate = pricing.get("output_per_million") or pricing.get(
            "completion_cost_per_1k_tokens", 0.0
        )
        if "input_per_million" in pricing or "output_per_million" in pricing:
            base_cost = (prompt_tokens / 1_000_000.0) * float(prompt_rate or 0.0)
            base_cost += (completion_tokens / 1_000_000.0) * float(
                completion_rate or 0.0
            )
        else:
            base_cost = (prompt_tokens / 1000.0) * float(prompt_rate or 0.0)
            base_cost += (completion_tokens / 1000.0) * float(completion_rate or 0.0)

        per_page_rate = pricing.get("cost_per_page", 0.0)
        page_cost = page_count_value * float(per_page_rate or 0.0)
        cost_per_minute = pricing.get("cost_per_minute", 0.0)
        duration_minutes = max(float(duration or 0.0), 0.0) / 60.0
        compute_cost = duration_minutes * float(cost_per_minute or 0.0)
        return base_cost + page_cost + compute_cost

    def estimate_call_cost(
        self,
        provider: str,
        model: str,
        prompt_tokens: Optional[int],
        completion_tokens: Optional[int],
        page_count: Optional[int] = None,
        duration: Optional[float] = None,
    ) -> float:
        return self._compute_cost(
            provider=provider,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            page_count=page_count,
            duration=duration,
        )

    def _normalize_model_key(self, model: str, provider: Optional[str]) -> str:
        if not model:
            return ""
        model_lower = model.lower()
        if provider == "azure":
            if model_lower in {"azure_doc_intelligence", "docling"}:
                return model_lower
            if model_lower.startswith("azure:"):
                return model_lower
            # Strip "azure-" prefix that appears when model_id comes from /api/models
            # endpoint (which returns id = f"azure-{deployment}").  Without this,
            # "azure-gpt-5.1" would normalize to "azure:azure-gpt-5.1" (not found)
            # instead of "azure:gpt-5.1" (found in pricing.json).
            if model_lower.startswith("azure-"):
                model_lower = model_lower[len("azure-") :]
            return f"azure:{model_lower}"
        if provider == "gcp":
            if model_lower.startswith("vertex:"):
                return model_lower
            if model_lower.startswith("publishers/google/models/"):
                model_lower = model_lower.replace("publishers/google/models/", "")
            if model_lower.startswith("claude-"):
                model_lower = model_lower.split("@")[0]
                model_lower = model_lower.replace(
                    "claude-sonnet-4-5", "claude-sonnet-4.5"
                )
                model_lower = model_lower.replace("claude-opus-4-1", "claude-opus-4.1")
                model_lower = model_lower.replace(
                    "claude-sonnet-4-6", "claude-sonnet-4.6"
                )
            if model_lower.startswith("meta/llama-"):
                model_lower = model_lower.replace("meta/llama-", "llama-")
            if "llama-4-maverick" in model_lower:
                model_lower = "llama-4-maverick-17b"
            if "llama-4-scout" in model_lower:
                model_lower = "llama-4-scout-17b-16e"
            if "llama-3.3-70b" in model_lower:
                model_lower = "llama-3.3-70b"
            if "llama-3.1-405b" in model_lower:
                model_lower = "llama-3.1-405b"
            return f"vertex:{model_lower}"
        return model

    def record_call(
        self,
        session_id: Optional[str],
        provider: str,
        model: str,
        prompt_tokens: Optional[int],
        completion_tokens: Optional[int],
        duration: Optional[float],
        page_count: Optional[int] = None,
        document_name: Optional[str] = None,
        figure_count: int = 0,
        table_count: int = 0,
        batch_number: Optional[int] = None,
    ) -> None:
        if not session_id:
            return
        duration = float(duration or 0.0)
        prompt_tokens_int = int(prompt_tokens or 0)
        completion_tokens_int = int(completion_tokens or 0)
        cost = self._compute_cost(
            provider=provider,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            page_count=page_count,
            duration=duration,
        )

        metrics = self._sessions.get(session_id)
        if not metrics:
            metrics = SessionMetrics(session_id=session_id)
            self._sessions[session_id] = metrics

        metrics.total_cost += cost
        metrics.total_latency += duration
        metrics.total_calls += 1
        metrics.calls.append(
            CallMetric(
                provider=provider,
                model=model,
                prompt_tokens=prompt_tokens_int,
                completion_tokens=completion_tokens_int,
                duration=duration,
                cost=cost,
                timestamp=datetime.utcnow().isoformat(),
                document_name=document_name,
                page_count=int(page_count or 0),
                figure_count=int(figure_count or 0),
                table_count=int(table_count or 0),
                batch_number=batch_number,
            )
        )

        # Update session metrics in database — fire and forget so it never blocks
        # the asyncio event loop. Previously this was a synchronous HTTP call
        # inside an async coroutine, stalling all other concurrent tasks.
        try:
            db = self._get_db_service()
            if db:
                try:
                    loop = asyncio.get_running_loop()
                    loop.run_in_executor(
                        None,
                        lambda: db.increment_session_metrics(
                            session_id=session_id,
                            cost=cost,
                            latency=duration,
                        ),
                    )
                except RuntimeError:
                    # No running event loop (e.g., tests or sync context)
                    db.increment_session_metrics(
                        session_id=session_id,
                        cost=cost,
                        latency=duration,
                    )
        except Exception as e:
            print(f"[COST_TRACKER] Failed to update session metrics in DB: {e}")

    def record_batch(
        self,
        session_id: Optional[str],
        batch_number: int,
        batch_latency: float,
        document_count: int,
    ) -> None:
        if not session_id:
            return
        metrics = self._sessions.get(session_id)
        if not metrics:
            metrics = SessionMetrics(session_id=session_id)
            self._sessions[session_id] = metrics
        metrics.batches[batch_number] = BatchMetric(
            batch_number=batch_number,
            batch_latency=batch_latency,
            document_count=document_count,
        )

    def get_session_metrics(
        self, session_id: Optional[str]
    ) -> Optional[SessionMetrics]:
        if not session_id:
            return None
        return self._sessions.get(session_id)

    def load_session_metrics_from_db(
        self, session_id: Optional[str]
    ) -> Optional[SessionMetrics]:
        """Load session metrics from the database (for session restore)"""
        if not session_id:
            return None

        try:
            db = self._get_db_service()
            if not db:
                return None

            db_metrics = db.get_session_metrics(session_id)
            if not db_metrics:
                return None

            # Build SessionMetrics from database (aggregates only, no individual calls)
            metrics = SessionMetrics(session_id=session_id)
            metrics.total_cost = float(db_metrics.get("total_cost") or 0)
            metrics.total_latency = float(db_metrics.get("total_latency") or 0)
            metrics.total_calls = int(db_metrics.get("total_calls") or 0)
            # Note: individual calls are not stored, so calls list will be empty

            # Cache in memory
            self._sessions[session_id] = metrics
            return metrics
        except Exception as e:
            print(f"[COST_TRACKER] Failed to load metrics from DB: {e}")
            return None

    def clear_session(self, session_id: Optional[str]) -> None:
        if not session_id:
            return
        self._sessions.pop(session_id, None)

        # Reset metrics in database
        try:
            db = self._get_db_service()
            if db:
                db.reset_session_metrics(session_id)
        except Exception as e:
            print(f"[COST_TRACKER] Failed to reset session metrics in DB: {e}")


def infer_provider_from_model_id(model_id: str) -> str:
    """Infer the pricing provider from a stored model ID string.

    Used for deterministic cost recompute when the provider was not persisted.
    Matches the _EXTRACTION_PROVIDER_MAP logic in extractions/router.py.
    """
    m = (model_id or "").lower()
    if any(m.startswith(p) for p in ("gpt-", "o1", "o3", "o4")):
        return "azure"
    if m.startswith("claude-"):
        return "gcp"
    if any(m.startswith(p) for p in ("gemini-", "llama")):
        return "gcp"
    if "macbook" in m:
        return "macbook"
    if m.startswith("vllm-") or "vllm" in m:
        return "vllm"
    return "azure"  # safe default — azure is most common deployment


cost_tracker = CostTracker()
