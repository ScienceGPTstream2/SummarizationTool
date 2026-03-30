"""
bench_thread_pool.py
====================
Tests whether Python's default asyncio thread pool (used by asyncio.to_thread)
becomes a bottleneck when many concurrent LLM calls are in-flight simultaneously.

The app's extraction pipeline uses asyncio.to_thread(requests.post, ...) for every
LLM provider call. The default thread pool has min(32, cpu_count+4) threads.
With asyncio.Semaphore(50), up to 50 tasks can hold semaphore slots and all try
to submit to the thread pool at once — if the pool is smaller than that, tasks queue
and wait for a free thread, adding silent latency on top of the actual API latency.

What this script does:
  - Simulates N concurrent asyncio.to_thread(time.sleep, SIMULATED_CALL_DURATION) calls
  - If no thread pool saturation: actual wall time ≈ SIMULATED_CALL_DURATION
  - If saturated: actual wall time > SIMULATED_CALL_DURATION × (N / pool_size)
  - Sweeps N = 4, 8, 16, 24, 32, 48, 64
  - Reports default pool size, saturation point, and queuing overhead

Usage:
  python backend/scripts/bench_thread_pool.py
"""

import asyncio
import time
import json
import os
import sys
import concurrent.futures
from pathlib import Path

# ── Output ──────────────────────────────────────────────────────────────────
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "output" / "bench_diagnosis"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_FILE = OUTPUT_DIR / "thread_pool.json"

# ── Config ───────────────────────────────────────────────────────────────────
SIMULATED_CALL_DURATION = 2.0  # seconds — mimics a blocking 2s HTTP POST
CONCURRENCY_LEVELS = [4, 8, 16, 24, 32, 48, 64]
TOLERANCE_FACTOR = 1.25  # flag saturation if actual > expected * this


def _default_pool_size() -> int:
    """Estimate the default ThreadPoolExecutor size Python would use."""
    cpu = os.cpu_count() or 1
    return min(32, cpu + 4)


def _blocking_sleep(duration: float) -> float:
    """Blocking call that simulates a synchronous HTTP POST."""
    t0 = time.perf_counter()
    time.sleep(duration)
    return time.perf_counter() - t0


async def run_level(n: int, pool: concurrent.futures.ThreadPoolExecutor) -> dict:
    """Launch N concurrent asyncio.to_thread tasks and measure wall time."""
    loop = asyncio.get_running_loop()

    t_wall_start = time.perf_counter()
    call_times = await asyncio.gather(
        *[
            loop.run_in_executor(pool, _blocking_sleep, SIMULATED_CALL_DURATION)
            for _ in range(n)
        ]
    )
    wall_time = time.perf_counter() - t_wall_start

    expected = SIMULATED_CALL_DURATION
    overhead = wall_time - expected
    saturated = wall_time > expected * TOLERANCE_FACTOR

    return {
        "concurrency": n,
        "wall_time_s": round(wall_time, 3),
        "expected_s": expected,
        "overhead_s": round(overhead, 3),
        "overhead_pct": round((overhead / expected) * 100, 1),
        "saturated": saturated,
        "per_call_avg_s": round(sum(call_times) / len(call_times), 3),
    }


async def main():
    pool_size = _default_pool_size()
    print(f"\n{'='*60}")
    print(f"  Thread Pool Saturation Test")
    print(f"{'='*60}")
    print(f"  Simulated call duration : {SIMULATED_CALL_DURATION}s")
    print(f"  Default pool size       : {pool_size} threads  (min(32, cpu+4))")
    print(f"  Saturation threshold    : >{TOLERANCE_FACTOR}× expected wall time")
    print(f"{'='*60}\n")

    results = []
    saturation_point = None

    # Use the default pool (same as asyncio.to_thread uses)
    loop = asyncio.get_running_loop()
    default_executor = concurrent.futures.ThreadPoolExecutor()

    for n in CONCURRENCY_LEVELS:
        result = await run_level(n, default_executor)
        results.append(result)

        status = "⚠️  SATURATED" if result["saturated"] else "✅ OK"
        print(
            f"  N={n:3d} | wall={result['wall_time_s']:.2f}s "
            f"(expected {result['expected_s']:.1f}s) "
            f"overhead={result['overhead_pct']:+.0f}% {status}"
        )

        if result["saturated"] and saturation_point is None:
            saturation_point = n

    default_executor.shutdown(wait=False)

    summary = {
        "default_pool_size": pool_size,
        "simulated_call_duration_s": SIMULATED_CALL_DURATION,
        "saturation_point_n": saturation_point,
        "is_bottleneck": saturation_point is not None and saturation_point <= 32,
        "levels": results,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\n{'='*60}")
    if saturation_point:
        print(f"  ⚠️  Thread pool saturates at N={saturation_point}")
        if saturation_point <= 32:
            print(f"  → BOTTLENECK CONFIRMED: pool is smaller than app semaphore (50)")
            print(f"  → Fix: increase pool size or reduce semaphore")
        else:
            print(
                f"  → Saturation only at N>{saturation_point}, app semaphore=50 is borderline"
            )
    else:
        print(
            f"  ✅ No thread pool saturation detected at any tested concurrency level"
        )
        print(f"  → Thread pool is NOT the bottleneck")
    print(f"\n  Results saved to: {OUTPUT_FILE}")
    print(f"{'='*60}\n")

    return summary


if __name__ == "__main__":
    asyncio.run(main())
