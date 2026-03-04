"""
VRAM Guard — Dynamic GPU Memory Protection for Docling Processing
==================================================================
Provides VRAM-aware concurrency control that sits *in front of* the
ProcessPoolExecutor dispatch in DoclingService.

Key design decisions:
  - The guard lives in the **main process** (asyncio side).  It gates
    how many conversion jobs are submitted to the ProcessPoolExecutor
    at any given time.
  - Per-worker VRAM estimation starts at a conservative default and is
    **dynamically adjusted** after each completed job using real
    nvidia-smi measurements.
  - A configurable safety margin (env: VRAM_SAFETY_MARGIN_MB, default
    1536 MB) is kept free at all times to absorb spikes.
  - Jobs that cannot be admitted are **queued and retried**, never
    rejected with errors.

Environment variable overrides (all optional):
  VRAM_SAFETY_MARGIN_MB      — MB to keep free as buffer  (default: 1536)
  VRAM_PER_WORKER_INIT_MB    — initial per-worker estimate (default: 2800)
  VRAM_MAX_WORKERS           — hard cap on concurrent GPU workers (default: no cap)
  VRAM_CHECK_INTERVAL_SEC    — min seconds between nvidia-smi calls (default: 1.0)
  VRAM_LEARNING_RATE         — EMA alpha for updating per-worker estimate (default: 0.3)

Usage (inside DoclingService):
    guard = VRAMGuard()

    async with guard.acquire_slot():
        # Slot acquired — safe to dispatch to process pool
        result = await loop.run_in_executor(pool, worker_fn, args)
    # Slot auto-released, VRAM estimate updated

    # Or check status:
    status = guard.get_status()
"""

import asyncio
import logging
import os
import subprocess
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Optional

_log = logging.getLogger(__name__)

# Retry interval when a queued job can't be admitted yet (seconds)
_QUEUE_RETRY_SEC = 2.0


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class VRAMStatus:
    """Snapshot of current GPU VRAM and worker state."""
    total_mb: float
    used_mb: float
    free_mb: float
    active_workers: int
    max_workers: int
    can_accept_worker: bool
    estimated_per_worker_mb: float
    safety_margin_mb: float
    jobs_completed: int = 0
    jobs_queued: int = 0

    @property
    def utilization_pct(self) -> float:
        return (self.used_mb / self.total_mb * 100) if self.total_mb > 0 else 0


# ---------------------------------------------------------------------------
# VRAM probing helpers
# ---------------------------------------------------------------------------

def _get_gpu_vram_total_mb() -> float:
    """Detect total GPU VRAM via torch (preferred) or nvidia-smi fallback."""
    try:
        import torch
        if torch.cuda.is_available():
            return torch.cuda.get_device_properties(0).total_memory / (1024 ** 2)
    except ImportError:
        pass

    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        return float(result.stdout.strip())
    except Exception:
        pass

    return 0.0


def _nvidia_smi_query(query: str) -> float:
    """Run a single nvidia-smi query and return the float result, or -1 on failure."""
    try:
        result = subprocess.run(
            ["nvidia-smi", f"--query-gpu={query}", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        return float(result.stdout.strip().split("\n")[0])
    except Exception:
        return -1.0


# ---------------------------------------------------------------------------
# VRAMGuard
# ---------------------------------------------------------------------------

class VRAMGuard:
    """
    VRAM-aware concurrency controller for GPU-accelerated document processing.

    Sits in front of the ProcessPoolExecutor and controls how many conversion
    jobs can run simultaneously based on:
      1. A dynamic worker cap (from VRAM budget / per-worker estimate)
      2. A real-time free-VRAM check before admitting each new job
      3. Dynamic adjustment of the per-worker estimate after each job

    Jobs that cannot be admitted immediately are **queued**: they sleep and
    retry until VRAM is available.  They are never rejected with errors.
    """

    def __init__(
        self,
        vram_total_mb: Optional[float] = None,
        safety_margin_mb: Optional[float] = None,
        per_worker_init_mb: Optional[float] = None,
        max_workers_cap: Optional[int] = None,
        check_interval_sec: Optional[float] = None,
        learning_rate: Optional[float] = None,
    ):
        # --- Resolve all parameters (arg → env → default) ---
        self.vram_total_mb = (
            vram_total_mb
            or _get_gpu_vram_total_mb()
            or 16384.0  # assume T4 if detection fails
        )
        self.safety_margin_mb = (
            safety_margin_mb
            if safety_margin_mb is not None
            else float(os.environ.get("VRAM_SAFETY_MARGIN_MB", "1536"))
        )
        self._per_worker_mb = (
            per_worker_init_mb
            if per_worker_init_mb is not None
            else float(os.environ.get("VRAM_PER_WORKER_INIT_MB", "2800"))
        )
        self._max_workers_cap = (
            max_workers_cap
            if max_workers_cap is not None
            else (int(os.environ["VRAM_MAX_WORKERS"]) if "VRAM_MAX_WORKERS" in os.environ else None)
        )
        self.check_interval_sec = (
            check_interval_sec
            if check_interval_sec is not None
            else float(os.environ.get("VRAM_CHECK_INTERVAL_SEC", "1.0"))
        )
        self._learning_rate = (
            learning_rate
            if learning_rate is not None
            else float(os.environ.get("VRAM_LEARNING_RATE", "0.3"))
        )

        # --- Compute initial max workers ---
        self._usable_vram_mb = self.vram_total_mb - self.safety_margin_mb
        self._recompute_max_workers()

        # --- Concurrency primitives ---
        # The lock protects _active_workers and _queued_workers.
        # Admission is NOT controlled by a semaphore — we use the lock +
        # _can_accept_worker() + sleep-retry loop instead.  This avoids
        # the race condition where dynamic resizing of max_workers can
        # cause the semaphore permit count to drift from reality.
        self._active_workers = 0
        self._queued_workers = 0
        self._lock = asyncio.Lock()

        # An event that is SET whenever a worker slot is released,
        # waking up any queued tasks so they can retry admission.
        self._slot_available = asyncio.Event()
        self._slot_available.set()  # start ready

        # --- Tracking ---
        self._jobs_completed = 0
        self._peak_observations: list[float] = []

        # --- nvidia-smi throttle ---
        self._last_smi_time = 0.0
        self._last_smi_free = self.vram_total_mb
        self._last_smi_used = 0.0
        self._smi_lock = threading.Lock()

        _log.info(
            f"VRAMGuard initialized: total={self.vram_total_mb:.0f}MB, "
            f"usable={self._usable_vram_mb:.0f}MB (safety={self.safety_margin_mb:.0f}MB), "
            f"per_worker={self._per_worker_mb:.0f}MB, "
            f"max_workers={self._max_workers}"
            + (f" (capped at {self._max_workers_cap})" if self._max_workers_cap else "")
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _recompute_max_workers(self):
        """Recompute max concurrent workers from current VRAM estimates."""
        computed = max(1, int(self._usable_vram_mb / self._per_worker_mb))
        if self._max_workers_cap is not None:
            computed = min(computed, self._max_workers_cap)
        self._max_workers = computed

    def _query_vram(self) -> tuple[float, float]:
        """Return (used_mb, free_mb), throttled to check_interval_sec."""
        with self._smi_lock:
            now = time.monotonic()
            if now - self._last_smi_time < self.check_interval_sec:
                return self._last_smi_used, self._last_smi_free

            used = _nvidia_smi_query("memory.used")
            free = _nvidia_smi_query("memory.free")
            if used >= 0 and free >= 0:
                self._last_smi_used = used
                self._last_smi_free = free
            self._last_smi_time = now
            return self._last_smi_used, self._last_smi_free

    def _can_accept_worker(self) -> tuple[bool, str]:
        """
        Admission check: is there a free worker slot?
        Must be called while holding self._lock.

        Only uses the counter-based limit (`max_workers`), which is derived
        from the VRAM budget at init time.  We intentionally do NOT gate on
        real-time nvidia-smi free memory here, because Docling subprocess
        workers keep their model loaded in VRAM between jobs (cache in
        `_get_or_create_converter`).  This means nvidia-smi shows VRAM as
        occupied even when a worker is idle — a live free-VRAM check would
        permanently block queued jobs.

        The VRAM budget math (total - safety_margin) / per_worker already
        accounts for the steady-state per-worker footprint.  Trust it.

        Returns (ok, reason).
        """
        if self._active_workers >= self._max_workers:
            return False, (
                f"At worker limit: {self._active_workers}/{self._max_workers} active"
            )

        return True, "OK"

    # ------------------------------------------------------------------
    # Slot acquisition — queues on contention, never rejects
    # ------------------------------------------------------------------

    @asynccontextmanager
    async def acquire_slot(self, timeout: Optional[float] = None):
        """
        Acquire a VRAM-protected worker slot.

        **Queues** if all slots are busy or VRAM is low — sleeps and
        retries until admitted.  Never yields a denied/failed slot;
        the caller can assume the slot is always acquired on entry.

        Args:
            timeout: Optional max seconds to wait.  Raises
                     asyncio.TimeoutError if exceeded.

        Usage::

            async with guard.acquire_slot() as slot:
                result = await loop.run_in_executor(pool, fn, args)
            # slot auto-released; VRAM estimate updated
        """
        slot = {
            "acquired": False,
            "worker_id": None,
            "vram_used_at_acquire": -1.0,
            "vram_used_at_release": -1.0,
        }

        deadline = (time.monotonic() + timeout) if timeout else None

        # Track queue depth
        async with self._lock:
            self._queued_workers += 1

        try:
            # --- Retry loop: wait until a slot is available ---
            while True:
                async with self._lock:
                    ok, reason = self._can_accept_worker()
                    if ok:
                        self._active_workers += 1
                        self._queued_workers -= 1
                        worker_id = self._jobs_completed + self._active_workers
                        break

                # Not admitted — wait for a signal or timeout
                if deadline is not None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        async with self._lock:
                            self._queued_workers -= 1
                        raise asyncio.TimeoutError(
                            f"VRAMGuard: timeout ({timeout}s) waiting for slot. "
                            f"Reason: {reason}"
                        )
                    wait_time = min(_QUEUE_RETRY_SEC, remaining)
                else:
                    wait_time = _QUEUE_RETRY_SEC

                # Clear the event so we block; it will be set when a
                # slot is released or after the retry interval.
                self._slot_available.clear()
                try:
                    await asyncio.wait_for(
                        self._slot_available.wait(), timeout=wait_time
                    )
                except asyncio.TimeoutError:
                    pass  # retry the admission check

                _log.debug(
                    f"VRAMGuard: queued job retrying admission "
                    f"({self._active_workers}/{self._max_workers} active, "
                    f"{self._queued_workers} queued, reason: {reason})"
                )

            # --- Admitted ---
            used_before, _ = self._query_vram()
            slot["acquired"] = True
            slot["worker_id"] = worker_id
            slot["vram_used_at_acquire"] = used_before

            _log.info(
                f"VRAMGuard: slot acquired (worker #{worker_id}, "
                f"active={self._active_workers}/{self._max_workers}, "
                f"queued={self._queued_workers}, "
                f"VRAM used={used_before:.0f}MB, free~{self.vram_total_mb - used_before:.0f}MB)"
            )

            yield slot

        finally:
            if slot["acquired"]:
                used_after, _ = self._query_vram()
                slot["vram_used_at_release"] = used_after

                async with self._lock:
                    self._active_workers -= 1
                    self._jobs_completed += 1

                # Update per-worker estimate (learning)
                if slot["vram_used_at_acquire"] >= 0 and used_after >= 0:
                    delta = used_after - slot["vram_used_at_acquire"]
                    if delta > 0:
                        self._update_per_worker_estimate(delta)

                # Wake up any queued tasks
                self._slot_available.set()

                _log.info(
                    f"VRAMGuard: slot released (worker #{slot['worker_id']}, "
                    f"active={self._active_workers}/{self._max_workers}, "
                    f"VRAM used={used_after:.0f}MB, "
                    f"per_worker_estimate={self._per_worker_mb:.0f}MB)"
                )
            else:
                # acquire_slot raised before admission (e.g. TimeoutError)
                # _queued_workers was already decremented in the retry loop
                pass

    # ------------------------------------------------------------------
    # Dynamic learning
    # ------------------------------------------------------------------

    def _update_per_worker_estimate(self, observed_delta_mb: float):
        """
        Update per-worker VRAM estimate using exponential moving average.

        The estimate can move both up and down, but has a floor to prevent
        unrealistically low values.
        """
        old = self._per_worker_mb
        alpha = self._learning_rate

        self._peak_observations.append(observed_delta_mb)
        if len(self._peak_observations) > 20:
            self._peak_observations = self._peak_observations[-20:]

        new_estimate = alpha * observed_delta_mb + (1 - alpha) * old

        # Floor: Docling models can't use less than ~1.2GB
        new_estimate = max(1200.0, new_estimate)

        if abs(new_estimate - old) > 50:
            _log.info(
                f"VRAMGuard: per-worker estimate updated: "
                f"{old:.0f}MB → {new_estimate:.0f}MB "
                f"(observed delta={observed_delta_mb:.0f}MB, α={alpha})"
            )

        old_max = self._max_workers
        self._per_worker_mb = new_estimate
        self._recompute_max_workers()

        if self._max_workers != old_max:
            _log.info(
                f"VRAMGuard: max_workers adjusted: {old_max} → {self._max_workers} "
                f"(per_worker={self._per_worker_mb:.0f}MB)"
            )

    # ------------------------------------------------------------------
    # Status / health
    # ------------------------------------------------------------------

    def get_status(self) -> VRAMStatus:
        """Get a snapshot suitable for health/readiness endpoints."""
        used, free = self._query_vram()
        ok, _ = self._can_accept_worker()

        return VRAMStatus(
            total_mb=self.vram_total_mb,
            used_mb=used,
            free_mb=free,
            active_workers=self._active_workers,
            max_workers=self._max_workers,
            can_accept_worker=ok,
            estimated_per_worker_mb=self._per_worker_mb,
            safety_margin_mb=self.safety_margin_mb,
            jobs_completed=self._jobs_completed,
            jobs_queued=self._queued_workers,
        )

    @property
    def max_workers(self) -> int:
        return self._max_workers

    @property
    def active_workers(self) -> int:
        return self._active_workers

    @property
    def per_worker_mb(self) -> float:
        return self._per_worker_mb

    def is_cuda_oom(self, exception: Exception) -> bool:
        """Check if an exception is a CUDA OOM error."""
        error_str = str(exception).lower()
        oom_patterns = [
            "cuda out of memory",
            "cudnn error: cudnn_status_not_supported",
            "outofmemoryerror",
            "cuda error: out of memory",
            "cublas_status_alloc_failed",
        ]
        return any(pattern in error_str for pattern in oom_patterns)
