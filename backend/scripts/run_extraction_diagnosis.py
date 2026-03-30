"""
run_extraction_diagnosis.py
============================
Master runner for the extraction latency diagnosis suite.

Runs all three diagnostic scripts in order and writes a combined summary.
When done, prints a clear verdict on what is causing the slowdown.

Usage (from repo root):
  python backend/scripts/run_extraction_diagnosis.py

Optional flags:
  --skip-pipeline   Skip the end-to-end app pipeline test (fastest run)
  --skip-providers  Skip the direct provider concurrency test
  --skip-threads    Skip the thread pool test
  --doc-counts 1 4 8   Override doc counts for pipeline test
  --max-concurrent 16  Override max concurrency for provider test
"""

import asyncio
import sys
import json
import argparse
import time
from pathlib import Path
from datetime import datetime, timezone

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

OUTPUT_DIR = BACKEND_DIR / "output" / "bench_diagnosis"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SUMMARY_FILE = OUTPUT_DIR / "diagnosis_summary.json"


def print_header(title: str):
    bar = "=" * 65
    print(f"\n{bar}")
    print(f"  {title}")
    print(f"{bar}")


def print_section(title: str):
    print(f"\n── {title} {'─' * (60 - len(title))}")


async def run_thread_pool_bench() -> dict:
    import bench_thread_pool

    return await bench_thread_pool.main()


async def run_provider_bench(max_concurrent: int) -> dict:
    import bench_provider_concurrency

    return await bench_provider_concurrency.main(
        providers=["gemini", "azure", "anthropic"],
        max_concurrent=max_concurrent,
    )


async def run_pipeline_bench(doc_counts: list) -> dict:
    import bench_extraction_pipeline
    from bench_extraction_pipeline import PROVIDERS

    return await bench_extraction_pipeline.main(
        doc_counts=doc_counts,
        provider_keys=list(PROVIDERS.keys()),
    )


def interpret_results(
    thread_result: dict,
    provider_result: dict,
    pipeline_result: dict,
) -> dict:
    """Produce a human-readable verdict from bench results."""
    issues = []
    fixes = []
    verdict_lines = []

    # ── Thread pool ──────────────────────────────────────────────────────────
    if thread_result and thread_result.get("is_bottleneck"):
        sat_n = thread_result["saturation_point_n"]
        pool_size = thread_result["default_pool_size"]
        issues.append(
            f"Thread pool saturates at N={sat_n} (pool has {pool_size} threads)"
        )
        fixes.append("Increase default thread pool size to 64+ in backend/main.py")

    # ── Provider concurrency ──────────────────────────────────────────────────
    if provider_result:
        summary = provider_result.get("summary_by_model", {})
        rate_limited_models = []
        slow_models = []
        for model_key, s in summary.items():
            if s.get("first_issue_at") and s.get("issue_type") == "429_rate_limit":
                rate_limited_models.append((model_key, s["first_issue_at"]))
            elif s.get("first_issue_at") and s.get("issue_type") == "slowdown":
                slow_models.append((model_key, s["first_issue_at"]))

        if rate_limited_models:
            for m, n in rate_limited_models:
                issues.append(f"Rate limit (429) on {m} at N={n} concurrent calls")
            fixes.append(
                "Lower per-provider semaphore in extractions/router.py (e.g., Gemini=4, Azure=8)"
            )
            fixes.append(
                "Add staggered task launch (100ms between starts) to prevent thundering herd"
            )

        if slow_models:
            for m, n in slow_models:
                issues.append(
                    f"Significant slowdown on {m} at N={n} (no 429 but latency multiplied)"
                )
            fixes.append(
                "Reduce concurrent calls per provider; consider per-provider semaphore"
            )

    # ── Pipeline scaling ──────────────────────────────────────────────────────
    if pipeline_result:
        results = pipeline_result.get("results", [])
        scaling_issues = []
        for r in results:
            if r["n_docs"] >= 4 and r.get("wall_per_doc_s", 0) > 0:
                # Check if per-doc time is more than 3x the N=1 baseline
                baseline = next(
                    (
                        x["wall_per_doc_s"]
                        for x in results
                        if x["provider"] == r["provider"] and x["n_docs"] == 1
                    ),
                    None,
                )
                if baseline and r["wall_per_doc_s"] > baseline * 3:
                    scaling_issues.append(
                        f"{r['display']} N={r['n_docs']}: {r['wall_per_doc_s']:.1f}s/doc vs baseline {baseline:.1f}s/doc ({r['wall_per_doc_s']/baseline:.1f}×)"
                    )
        if scaling_issues:
            issues.extend(
                [f"Pipeline scaling degradation: {s}" for s in scaling_issues]
            )

    # ── Root cause verdict ────────────────────────────────────────────────────
    if not issues:
        verdict_lines.append(
            "✅ No bottleneck detected in tests. Issue may be intermittent or test coverage was insufficient."
        )
        verdict_lines.append(
            "Try running bench_extraction_pipeline.py with larger doc counts and monitoring in real-time."
        )
    else:
        verdict_lines.append("🔴 ROOT CAUSE(S) IDENTIFIED:")
        for i, issue in enumerate(issues, 1):
            verdict_lines.append(f"  {i}. {issue}")
        verdict_lines.append("")
        verdict_lines.append("📋 RECOMMENDED FIXES (in priority order):")
        for i, fix in enumerate(fixes, 1):
            verdict_lines.append(f"  {i}. {fix}")

    return {
        "issues_found": issues,
        "recommended_fixes": fixes,
        "verdict": "\n".join(verdict_lines),
    }


async def main(
    skip_threads: bool = False,
    skip_providers: bool = False,
    skip_pipeline: bool = False,
    doc_counts: list = None,
    max_concurrent: int = 24,
):
    if doc_counts is None:
        doc_counts = [1, 2, 4, 6, 8, 10]

    print_header("Extraction Latency Diagnosis Suite")
    print(f"  Started  : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Output   : {OUTPUT_DIR}")
    print(f"  Doc counts (pipeline test): {doc_counts}")
    print(f"  Max concurrent (provider test): {max_concurrent}")

    thread_result = None
    provider_result = None
    pipeline_result = None

    # ── 1. Thread pool test ───────────────────────────────────────────────────
    if not skip_threads:
        print_section("Step 1/3 — Thread Pool Saturation Test")
        try:
            thread_result = await run_thread_pool_bench()
        except Exception as e:
            print(f"  ❌ Thread pool test failed: {e}")

    # ── 2. Provider concurrency test ──────────────────────────────────────────
    if not skip_providers:
        print_section("Step 2/3 — Provider Direct Concurrency Test")
        print("  (Tests Gemini, Azure, Anthropic directly — bypassing the app)")
        try:
            provider_result = await run_provider_bench(max_concurrent)
        except Exception as e:
            print(f"  ❌ Provider concurrency test failed: {e}")
            import traceback

            traceback.print_exc()

    # ── 3. Pipeline end-to-end test ───────────────────────────────────────────
    if not skip_pipeline:
        print_section("Step 3/3 — End-to-End App Pipeline Test")
        print("  (Calls the running app's /api/extract endpoint with real documents)")
        try:
            pipeline_result = await run_pipeline_bench(doc_counts)
        except Exception as e:
            print(f"  ❌ Pipeline test failed: {e}")
            import traceback

            traceback.print_exc()

    # ── Interpretation ────────────────────────────────────────────────────────
    print_header("DIAGNOSIS VERDICT")
    verdict = interpret_results(thread_result, provider_result, pipeline_result)
    print(verdict["verdict"])

    # ── Save combined summary ─────────────────────────────────────────────────
    summary = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "thread_pool": thread_result,
        "provider_concurrency": provider_result,
        "pipeline": pipeline_result,
        "verdict": verdict,
    }
    with open(SUMMARY_FILE, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\n  Combined summary saved to: {SUMMARY_FILE}")
    print(f"\n  {'='*63}")
    print(f"  Share the output above (or the summary JSON) so Claude can")
    print(f"  identify the exact fix needed.")
    print(f"  {'='*63}\n")

    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run full extraction latency diagnosis"
    )
    parser.add_argument(
        "--skip-threads", action="store_true", help="Skip thread pool test"
    )
    parser.add_argument(
        "--skip-providers", action="store_true", help="Skip provider direct test"
    )
    parser.add_argument(
        "--skip-pipeline", action="store_true", help="Skip end-to-end pipeline test"
    )
    parser.add_argument(
        "--doc-counts", nargs="+", type=int, default=[1, 2, 4, 6, 8, 10]
    )
    parser.add_argument("--max-concurrent", type=int, default=24)
    args = parser.parse_args()

    asyncio.run(
        main(
            skip_threads=args.skip_threads,
            skip_providers=args.skip_providers,
            skip_pipeline=args.skip_pipeline,
            doc_counts=args.doc_counts,
            max_concurrent=args.max_concurrent,
        )
    )
