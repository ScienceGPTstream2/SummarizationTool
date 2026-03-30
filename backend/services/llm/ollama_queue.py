"""
ollama_queue.py
===============
Singleton FIFO queue for serializing all requests to Azure-hosted Ollama LLM instances.

Problem: When multiple extraction requests (e.g. 16 entities × 3 models = 48 calls)
hit the Ollama server simultaneously, it tries to load all requested models
into GPU VRAM at once, overwhelming the hardware and causing timeouts/failures.

Solution: A single-worker asyncio queue that processes ONE request at a time.
All callers await their Future, which resolves when their request completes.
This guarantees the Ollama instance only handles one LLM inference at a time.

Usage:
    from services.llm.ollama_queue import get_ollama_queue

    queue = get_ollama_queue()
    result = await queue.enqueue(my_async_callable, arg1, arg2, kwarg1=val1)
"""

import asyncio
import time
from typing import Any, Callable, Coroutine, Optional


class OllamaRequestQueue:
    """FIFO queue with a single worker for serializing Ollama LLM requests."""

    def __init__(self):
        self._queue: asyncio.Queue = asyncio.Queue()
        self._worker_task: Optional[asyncio.Task] = None
        self._started = False
        self._total_processed = 0
        self._total_enqueued = 0
        print(
            "[OllamaQueue] Initialized — all Ollama LLM requests will be serialized (FIFO, 1 worker)"
        )

    def _ensure_worker(self) -> None:
        """Start the background worker if not already running."""
        if self._started:
            return
        self._started = True
        loop = asyncio.get_running_loop()
        self._worker_task = loop.create_task(self._worker())

    async def _worker(self) -> None:
        """Background worker that processes one request at a time."""
        print("[OllamaQueue] Worker started — processing requests one at a time")
        while True:
            try:
                # Wait for the next item in the queue
                future, coro_fn, args, kwargs = await self._queue.get()

                queue_depth = self._queue.qsize()
                self._total_processed += 1
                request_num = self._total_processed

                print(
                    f"[OllamaQueue] Processing request #{request_num} "
                    f"(queue depth: {queue_depth} remaining)"
                )

                start = time.time()
                try:
                    # Execute the actual Ollama API call
                    result = await coro_fn(*args, **kwargs)
                    elapsed = time.time() - start
                    print(
                        f"[OllamaQueue] Request #{request_num} completed in {elapsed:.2f}s "
                        f"(queue depth: {self._queue.qsize()} remaining)"
                    )
                    future.set_result(result)
                except Exception as exc:
                    elapsed = time.time() - start
                    print(
                        f"[OllamaQueue] Request #{request_num} failed after {elapsed:.2f}s: {exc}"
                    )
                    future.set_exception(exc)
                finally:
                    self._queue.task_done()

            except asyncio.CancelledError:
                print("[OllamaQueue] Worker cancelled")
                break
            except Exception as exc:
                print(f"[OllamaQueue] Worker error (continuing): {exc}")

    async def enqueue(
        self,
        coro_fn: Callable[..., Coroutine[Any, Any, Any]],
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        """
        Enqueue an async callable to be processed by the single worker.

        Args:
            coro_fn: An async function to call (NOT an already-created coroutine).
            *args: Positional arguments for the function.
            **kwargs: Keyword arguments for the function.

        Returns:
            The result of coro_fn(*args, **kwargs)
        """
        # Restart worker if it exited unexpectedly (e.g. unhandled exception)
        if self._started and self._worker_task is not None and self._worker_task.done():
            print("[OllamaQueue] Worker task ended unexpectedly — restarting")
            self._started = False

        self._ensure_worker()

        loop = asyncio.get_running_loop()
        future = loop.create_future()

        self._total_enqueued += 1
        queue_depth = self._queue.qsize()
        print(
            f"[OllamaQueue] Enqueued request #{self._total_enqueued} "
            f"(queue depth before: {queue_depth})"
        )

        await self._queue.put((future, coro_fn, args, kwargs))
        return await future

    @property
    def pending_count(self) -> int:
        """Number of requests waiting in the queue (not including the one being processed)."""
        return self._queue.qsize()

    @property
    def stats(self) -> dict:
        """Queue statistics for monitoring."""
        return {
            "total_enqueued": self._total_enqueued,
            "total_processed": self._total_processed,
            "pending": self._queue.qsize(),
            "worker_running": self._started,
        }


# ── Singleton accessor ───────────────────────────────────────────────────────
_global_ollama_queue: Optional[OllamaRequestQueue] = None


def get_ollama_queue() -> OllamaRequestQueue:
    """Get (or create) the global Ollama request queue singleton."""
    global _global_ollama_queue
    if _global_ollama_queue is None:
        _global_ollama_queue = OllamaRequestQueue()
    return _global_ollama_queue
