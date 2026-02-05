"""Stress test script for Macbook LLM endpoint.

Example:
  python backend/scripts/macbook_stress_test.py \
    --url http://macbook1.sciencegpt.ca/api/generate \
    --model ministral-3:14b-instruct-2512-q4_K_M \
    --prompt "Explain the precautionary principle in one paragraph." \
    --concurrency 5 \
    --requests 50
"""

from __future__ import annotations

import argparse
import statistics
import threading
import time
from collections import Counter
from typing import List, Optional

import requests


def _percentile(sorted_values: List[float], pct: float) -> Optional[float]:
    if not sorted_values:
        return None
    if pct <= 0:
        return sorted_values[0]
    if pct >= 100:
        return sorted_values[-1]
    index = int(round((pct / 100) * (len(sorted_values) - 1)))
    return sorted_values[index]


def build_payload(model: str, prompt: str, max_tokens: int, temperature: float) -> dict:
    return {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }


def worker(
    worker_id: int,
    url: str,
    payload: dict,
    timeout: int,
    end_time: Optional[float],
    total_requests: Optional[int],
    counter: dict,
    lock: threading.Lock,
    latencies: List[float],
    statuses: Counter,
    errors: List[str],
) -> None:
    session = requests.Session()
    while True:
        with lock:
            if total_requests is not None and counter["sent"] >= total_requests:
                break
            if end_time is not None and time.time() >= end_time:
                break
            counter["sent"] += 1
            request_id = counter["sent"]

        start = time.perf_counter()
        try:
            response = session.post(url, json=payload, timeout=timeout)
            latency = time.perf_counter() - start
            with lock:
                latencies.append(latency)
                statuses[response.status_code] += 1
                if not response.ok:
                    errors.append(
                        f"#{request_id} status={response.status_code} body={response.text[:200]!r}"
                    )
        except Exception as exc:  # noqa: BLE001
            latency = time.perf_counter() - start
            with lock:
                latencies.append(latency)
                statuses["exception"] += 1
                errors.append(f"#{request_id} exception={exc}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stress test Macbook LLM endpoint")
    parser.add_argument(
        "--url",
        default="http://macbook1.sciencegpt.ca/api/generate",
        help="Target URL (default: macbook1.sciencegpt.ca/api/generate)",
    )
    parser.add_argument(
        "--model",
        default="ministral-3:14b-instruct-2512-q4_K_M",
        help="Model name to request",
    )
    parser.add_argument(
        "--prompt",
        default="Explain the precautionary principle in one paragraph.",
        help="Prompt to send",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=256,
        help="Max tokens for response",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=0.2,
        help="Sampling temperature",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=5,
        help="Number of concurrent workers",
    )
    parser.add_argument(
        "--requests",
        type=int,
        default=50,
        help="Total number of requests to send (ignored if --duration is set)",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=0,
        help="Duration to run in seconds (overrides --requests if > 0)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=180,
        help="Timeout per request in seconds",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    end_time = time.time() + args.duration if args.duration > 0 else None
    total_requests = None if args.duration > 0 else max(args.requests, 1)

    payload = build_payload(args.model, args.prompt, args.max_tokens, args.temperature)
    counter = {"sent": 0}
    lock = threading.Lock()
    latencies: List[float] = []
    statuses: Counter = Counter()
    errors: List[str] = []

    start_time = time.perf_counter()
    threads = []
    for worker_id in range(args.concurrency):
        thread = threading.Thread(
            target=worker,
            args=(
                worker_id,
                args.url,
                payload,
                args.timeout,
                end_time,
                total_requests,
                counter,
                lock,
                latencies,
                statuses,
                errors,
            ),
            daemon=True,
        )
        thread.start()
        threads.append(thread)

    for thread in threads:
        thread.join()

    elapsed = time.perf_counter() - start_time
    latencies_sorted = sorted(latencies)

    print("\n=== Stress Test Summary ===")
    print(f"Target URL: {args.url}")
    print(f"Model: {args.model}")
    print(f"Prompt length: {len(args.prompt)} chars")
    print(f"Workers: {args.concurrency}")
    print(f"Elapsed: {elapsed:.2f}s")
    print(f"Total requests sent: {counter['sent']}")
    if elapsed > 0:
        print(f"Throughput: {counter['sent'] / elapsed:.2f} req/s")

    if latencies_sorted:
        avg = statistics.mean(latencies_sorted)
        p50 = _percentile(latencies_sorted, 50)
        p95 = _percentile(latencies_sorted, 95)
        p99 = _percentile(latencies_sorted, 99)
        print("Latency (s):")
        print(f"  avg={avg:.2f} p50={p50:.2f} p95={p95:.2f} p99={p99:.2f}")

    if statuses:
        print("Status counts:")
        for status, count in statuses.most_common():
            print(f"  {status}: {count}")

    if errors:
        print("\nSample errors (up to 5):")
        for error in errors[:5]:
            print(f"  {error}")

    print("\nSuggested next tests:")
    print("- Increase prompt length to simulate long-context load.")
    print("- Ramp concurrency (1, 5, 10, 20) to find saturation point.")
    print("- Run with --duration 300 to see stability over 5 minutes.")
    print("- Try higher max tokens (e.g., --max-tokens 512/1024).")


if __name__ == "__main__":
    main()