"""
Shared retry logic and circuit breaker for LLM provider clients.

Usage:
    cb = CircuitBreaker(name="azure")
    result = await call_with_retry(my_request_fn, DEFAULT_RETRY_CONFIG, cb)
"""

import asyncio
import random
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional


# ---------------------------------------------------------------------------
# Retry configuration
# ---------------------------------------------------------------------------


@dataclass
class RetryConfig:
    max_retries: int = 3
    base_delay: float = 1.0
    max_delay: float = 30.0
    retryable_status_codes: List[int] = field(
        default_factory=lambda: [429, 500, 503, 504]
    )
    jitter: bool = True


DEFAULT_RETRY_CONFIG = RetryConfig()


# ---------------------------------------------------------------------------
# Circuit breaker
# ---------------------------------------------------------------------------


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitOpenError(Exception):
    """Raised when a call is attempted while the circuit is OPEN."""

    def __init__(self, provider: str):
        self.provider = provider
        super().__init__(f"Circuit breaker OPEN for provider '{provider}' — skipping call")


class CircuitBreaker:
    """
    Per-provider in-process circuit breaker.

    States:
        CLOSED   — normal operation; all calls pass through.
        OPEN     — tripped; calls are rejected immediately without hitting the network.
        HALF_OPEN — recovery probe; one call is allowed through.  If it succeeds,
                    the breaker closes; if it fails, it opens again.

    Trip condition: ``failure_threshold`` consecutive failures.
    Reset:          After ``reset_timeout`` seconds in OPEN state the breaker
                    transitions to HALF_OPEN.
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        reset_timeout: float = 30.0,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.reset_timeout = reset_timeout

        self._state = CircuitState.CLOSED
        self._consecutive_failures = 0
        self._opened_at: Optional[float] = None
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def state(self) -> CircuitState:
        return self._state

    def check(self) -> None:
        """
        Check whether a call can proceed.  Call this *before* making a
        network request.  Raises ``CircuitOpenError`` if the breaker is OPEN.
        Transitions OPEN → HALF_OPEN automatically once the reset timeout
        has elapsed (no lock needed — this is a read path).
        """
        if self._state == CircuitState.CLOSED:
            return

        if self._state == CircuitState.OPEN:
            elapsed = time.monotonic() - (self._opened_at or 0)
            if elapsed >= self.reset_timeout:
                # Transition to HALF_OPEN without acquiring lock; worst case
                # two concurrent callers both see HALF_OPEN — that's fine.
                self._state = CircuitState.HALF_OPEN
                print(
                    f"[CircuitBreaker] {self.name}: OPEN → HALF_OPEN "
                    f"(after {elapsed:.1f}s)"
                )
            else:
                raise CircuitOpenError(self.name)

        # HALF_OPEN: allow the probe through (no raise)

    async def record_success(self) -> None:
        async with self._lock:
            self._consecutive_failures = 0
            if self._state != CircuitState.CLOSED:
                print(f"[CircuitBreaker] {self.name}: {self._state.value} → CLOSED")
                self._state = CircuitState.CLOSED
                self._opened_at = None

    async def record_failure(self) -> None:
        async with self._lock:
            self._consecutive_failures += 1
            if self._state == CircuitState.HALF_OPEN:
                # Failed probe — reopen immediately
                print(
                    f"[CircuitBreaker] {self.name}: HALF_OPEN → OPEN "
                    f"(probe failed)"
                )
                self._state = CircuitState.OPEN
                self._opened_at = time.monotonic()
            elif self._state == CircuitState.CLOSED:
                if self._consecutive_failures >= self.failure_threshold:
                    print(
                        f"[CircuitBreaker] {self.name}: CLOSED → OPEN "
                        f"({self._consecutive_failures} consecutive failures)"
                    )
                    self._state = CircuitState.OPEN
                    self._opened_at = time.monotonic()

    # ------------------------------------------------------------------
    # Debug / test helpers
    # ------------------------------------------------------------------

    def force_state(
        self,
        state: CircuitState,
        reset_after_seconds: Optional[float] = None,
    ) -> CircuitState:
        """
        Forcibly set the breaker state.  Used by the debug endpoint and
        integration tests only.  Returns the previous state.
        """
        previous = self._state
        self._state = state
        if state == CircuitState.OPEN:
            override_timeout = reset_after_seconds
            if override_timeout is not None:
                # Temporarily patch the reset_timeout for this open period
                self._reset_timeout_override = override_timeout
                self._opened_at = time.monotonic()
            else:
                self._reset_timeout_override = None
                self._opened_at = time.monotonic()
        elif state == CircuitState.CLOSED:
            self._consecutive_failures = 0
            self._opened_at = None
        return previous

    @property
    def reset_timeout(self) -> float:  # type: ignore[override]
        return getattr(self, "_reset_timeout_override", None) or self._reset_timeout

    @reset_timeout.setter
    def reset_timeout(self, value: float) -> None:
        self._reset_timeout = value

    def as_dict(self) -> Dict[str, Any]:
        return {
            "state": self._state.value,
            "consecutive_failures": self._consecutive_failures,
            "reset_timeout": self._reset_timeout,
        }


# ---------------------------------------------------------------------------
# Unified retry loop
# ---------------------------------------------------------------------------

import requests as _requests  # noqa: E402 — imported here to keep top clean


async def call_with_retry(
    request_fn: Callable,
    config: RetryConfig,
    cb: CircuitBreaker,
) -> Dict[str, Any]:
    """
    Execute ``request_fn`` with exponential-backoff retries and circuit
    breaker integration.

    ``request_fn`` must be an async callable with the signature::

        async def request_fn(*, attempt: int) -> Dict[str, Any]

    The returned dict must include ``"success": bool``.  For retryable HTTP
    failures the dict should include ``"status_code": int`` so the retry
    loop can check it against ``config.retryable_status_codes``.

    The circuit breaker is checked **before** the first attempt.  If it is
    OPEN, ``CircuitOpenError`` propagates to the caller (which should catch
    it and return a failure dict).
    """
    cb.check()  # raises CircuitOpenError if OPEN

    last_result: Dict[str, Any] = {"success": False, "error": "Max retries exceeded"}

    for attempt in range(config.max_retries):
        if attempt > 0:
            delay = min(config.base_delay * (2 ** (attempt - 1)), config.max_delay)
            if config.jitter:
                delay += random.uniform(0, 1)
            print(
                f"[Retry] attempt {attempt + 1}/{config.max_retries} "
                f"after {delay:.2f}s …"
            )
            await asyncio.sleep(delay)

        try:
            result = await request_fn(attempt=attempt)
        except _requests.exceptions.Timeout as exc:
            await cb.record_failure()
            last_result = {"success": False, "error": f"Request timeout: {exc}"}
            if attempt < config.max_retries - 1:
                continue
            return last_result
        except _requests.exceptions.RequestException as exc:
            await cb.record_failure()
            last_result = {"success": False, "error": f"Request error: {exc}"}
            if attempt < config.max_retries - 1:
                continue
            return last_result

        if result.get("success"):
            await cb.record_success()
            return result

        status_code = result.get("status_code")
        retryable = (
            status_code in config.retryable_status_codes
            or result.get("retryable", False)
        )

        if retryable:
            await cb.record_failure()
            last_result = result
            if attempt < config.max_retries - 1:
                continue
            return last_result

        # Non-retryable failure — return immediately
        return result

    return last_result
