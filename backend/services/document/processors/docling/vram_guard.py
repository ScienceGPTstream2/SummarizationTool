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
import json
import logging
import os
import subprocess
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

_log = logging.getLogger(__name__)

# Retry interval when a queued job can't be admitted yet (seconds)
_QUEUE_RETRY_SEC = 2.0

# Persistence defaults
_DEFAULT_STATE_PATH = Path(__file__).parent / ".vram_guard_state.json"
_STATE_VERSION = 1
_STATE_MAX_AGE_DAYS = 7

# Cold-start ramp-up defaults
_COLD_START_WORKERS_DEFAULT = 4
_COLD_START_MIN_JOBS_DEFAULT = 2


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
    is_cold_start: bool = False

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
        persistence_path: Optional[Path] = None,
        cold_start_workers: Optional[int] = None,
        cold_start_min_jobs: Optional[int] = None,
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

        # --- Persistence: load learned VRAM estimates from previous runs ---
        self._persistence_path = (
            Path(persistence_path) if persistence_path else _DEFAULT_STATE_PATH
        )
        loaded_state = self._load_persisted_state()
        if loaded_state:
            self._per_worker_mb = loaded_state["per_worker_mb"]
            _log.info(
                f"VRAMGuard: restored persisted per_worker estimate: "
                f"{self._per_worker_mb:.0f}MB "
                f"({len(loaded_state.get('observations', []))} past observations)"
            )

        # --- Cold-start ramp-up (active only when no persisted data) ---
        self._cold_start_max = (
            cold_start_workers
            if cold_start_workers is not None
            else int(os.environ.get("VRAM_COLD_START_WORKERS",
                                    str(_COLD_START_WORKERS_DEFAULT)))
        )
        self._cold_start_min_jobs = (
            cold_start_min_jobs
            if cold_start_min_jobs is not None
            else _COLD_START_MIN_JOBS_DEFAULT
        )
        self._is_cold_start = not loaded_state

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
        self._peak_observations: list[float] = (
            loaded_state.get("observations", []) if loaded_state else []
        )

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
            + (f" [COLD START: max {self._cold_start_max} workers until "
               f"{self._cold_start_min_jobs} jobs complete]"
               if self._is_cold_start
               else " [warm start from persisted state]")
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _recompute_max_workers(self):
        """Recompute max concurrent workers from current VRAM estimates."""
        computed = max(1, int(self._usable_vram_mb / self._per_worker_mb))
        if self._max_workers_cap is not None:
            computed = min(computed, self._max_workers_cap)
        if self._is_cold_start:
            computed = min(computed, self._cold_start_max)
        self._max_workers = computed

    def _load_persisted_state(self) -> Optional[dict]:
        """Load previously saved VRAM estimates from disk."""
        try:
            if not self._persistence_path.exists():
                return None
            with open(self._persistence_path, "r") as f:
                state = json.load(f)
            if state.get("version") != _STATE_VERSION:
                _log.info("VRAMGuard: ignoring persisted state (version mismatch)")
                return None
            updated_at = datetime.fromisoformat(state["updated_at"])
            age_days = (datetime.now() - updated_at).days
            if age_days > _STATE_MAX_AGE_DAYS:
                _log.info(f"VRAMGuard: ignoring persisted state ({age_days} days old)")
                return None
            if not state.get("per_worker_mb") or state["per_worker_mb"] <= 0:
                return None
            return state
        except Exception as exc:
            _log.debug(f"VRAMGuard: could not load persisted state: {exc}")
            return None

    def _save_state(self):
        """Persist current VRAM estimates to disk for future restarts."""
        try:
            state = {
                "version": _STATE_VERSION,
                "per_worker_mb": self._per_worker_mb,
                "observations": self._peak_observations[-20:],
                "jobs_completed": self._jobs_completed,
                "updated_at": datetime.now().isoformat(),
            }
            tmp_path = self._persistence_path.with_suffix(".tmp")
            with open(tmp_path, "w") as f:
                json.dump(state, f, indent=2)
            tmp_path.replace(self._persistence_path)
        except Exception as exc:
            _log.debug(f"VRAMGuard: could not save state: {exc}")

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
                async with self._lock:
                    self._active_workers -= 1
                    self._jobs_completed += 1

                # Wake up any queued tasks
                self._slot_available.set()

                _log.info(
                    f"VRAMGuard: slot released (worker #{slot['worker_id']}, "
                    f"active={self._active_workers}/{self._max_workers}, "
                    f"per_worker_estimate={self._per_worker_mb:.0f}MB)"
                )
            else:
                # acquire_slot raised before admission (e.g. TimeoutError)
                # _queued_workers was already decremented in the retry loop
                pass

    # ------------------------------------------------------------------
    # Dynamic learning — called by DoclingService after each job
    # ------------------------------------------------------------------

    def report_worker_result(self, peak_vram_mb: float):
        """
        Report a completed worker's actual peak VRAM usage (from
        torch.cuda.max_memory_allocated inside the subprocess).

        This is far more accurate than nvidia-smi deltas because it
        captures the true high-water mark during processing, not just
        the start/end snapshot.
        """
        if peak_vram_mb <= 0:
            return  # no valid measurement

        old = self._per_worker_mb
        alpha = self._learning_rate

        self._peak_observations.append(peak_vram_mb)
        if len(self._peak_observations) > 20:
            self._peak_observations = self._peak_observations[-20:]

        new_estimate = alpha * peak_vram_mb + (1 - alpha) * old

        # Floor: Docling models can't use less than ~1.2GB
        new_estimate = max(1200.0, new_estimate)

        if abs(new_estimate - old) > 50:
            _log.info(
                f"VRAMGuard: per-worker estimate updated: "
                f"{old:.0f}MB → {new_estimate:.0f}MB "
                f"(peak={peak_vram_mb:.0f}MB, α={alpha})"
            )

        old_max = self._max_workers
        self._per_worker_mb = new_estimate

        # Exit cold start once enough jobs have provided real measurements
        if self._is_cold_start and self._jobs_completed >= self._cold_start_min_jobs:
            self._is_cold_start = False
            _log.info(
                f"VRAMGuard: exiting cold start after {self._jobs_completed} jobs "
                f"(learned per_worker={self._per_worker_mb:.0f}MB)"
            )

        self._recompute_max_workers()

        if self._max_workers != old_max:
            _log.info(
                f"VRAMGuard: max_workers adjusted: {old_max} → {self._max_workers} "
                f"(per_worker={self._per_worker_mb:.0f}MB)"
            )

        # Persist learned state for future restarts
        self._save_state()

    def report_oom(self):
        """
        Called when a worker hits CUDA OOM.  Aggressively bumps the
        per-worker estimate so subsequent batches use fewer workers.

        Uses 1.5× the current estimate or the P95 of recent peaks,
        whichever is higher, to quickly prevent repeat OOMs.
        """
        old = self._per_worker_mb

        # Use 150% of current estimate as a conservative jump
        bumped = old * 1.5

        # If we have peak observations, use the max observed as a floor
        if self._peak_observations:
            observed_max = max(self._peak_observations)
            bumped = max(bumped, observed_max * 1.2)

        # Don't exceed usable VRAM (that would set max_workers to 0)
        bumped = min(bumped, self._usable_vram_mb)

        _log.warning(
            f"VRAMGuard: OOM detected! Bumping per-worker estimate: "
            f"{old:.0f}MB → {bumped:.0f}MB"
        )

        old_max = self._max_workers
        self._per_worker_mb = bumped
        self._recompute_max_workers()

        _log.warning(
            f"VRAMGuard: max_workers reduced after OOM: {old_max} → {self._max_workers}"
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
            is_cold_start=self._is_cold_start,
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
