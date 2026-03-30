"""
bench_provider_concurrency.py
==============================
Tests all LLM providers directly (bypassing the app) at varying concurrency levels
to find the concurrency limit before rate-limiting (429s) or significant slowdown occurs.

Providers tested:
  Gemini   : gemini-2.5-flash, gemini-2.5-flash-lite
  Azure    : gpt-5.2, gpt-5.1, gpt-5-mini, gpt-5-nano, o4-mini
  Anthropic: claude-sonnet-4-6, claude-opus-4-5 (via Vertex AI)

Auto-loads credentials from backend/core/secrets.toml — no manual config needed.

Usage:
  cd /home/azureuser/SummarizationTool
  python backend/scripts/bench_provider_concurrency.py [--providers gemini azure anthropic] [--max-concurrent 24]
"""

import asyncio
import time
import json
import sys
import argparse
import random
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

# ── Path setup so we can import from backend ─────────────────────────────────
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import toml
import requests

# ── Output ───────────────────────────────────────────────────────────────────
OUTPUT_DIR = BACKEND_DIR / "output" / "bench_diagnosis"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_FILE = OUTPUT_DIR / "provider_concurrency.json"

# ── Config ────────────────────────────────────────────────────────────────────
# Short prompt to minimise token cost — just need a valid response
TEST_PROMPT = "Reply with exactly one word: hello"
MAX_TOKENS = 16
TEMPERATURE = 0.0
# Concurrency levels to test (N concurrent requests at once)
CONCURRENCY_LEVELS = [1, 2, 4, 8, 16, 24]
# Threshold: if avg latency at level N is > SLOWDOWN_FACTOR × baseline (level 1), flag it
SLOWDOWN_FACTOR = 3.0
CALL_TIMEOUT = 120  # seconds per call before we give up


def load_secrets() -> dict:
    path = BACKEND_DIR / "core" / "secrets.toml"
    if not path.exists():
        raise FileNotFoundError(f"secrets.toml not found at {path}")
    return toml.load(path)


# ═════════════════════════════════════════════════════════════════════════════
# Gemini helpers
# ═════════════════════════════════════════════════════════════════════════════


def _get_gemini_token(sa_path: Path) -> str:
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request as GRequest

    creds = service_account.Credentials.from_service_account_file(
        str(sa_path), scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    if not creds.valid:
        creds.refresh(GRequest())
    return creds.token


def _find_service_account() -> Optional[Path]:
    import os

    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if creds and Path(creds).exists():
        return Path(creds)
    core_dir = BACKEND_DIR / "core"
    jsons = list(core_dir.glob("*.json"))
    return jsons[0] if jsons else None


def _gemini_call_sync(url: str, token: str, prompt: str) -> Tuple[int, float, str]:
    """Returns (status_code, duration_s, error_msg_or_empty)"""
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": TEMPERATURE, "maxOutputTokens": MAX_TOKENS},
    }
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
    t0 = time.perf_counter()
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=CALL_TIMEOUT)
        dur = time.perf_counter() - t0
        return resp.status_code, dur, "" if resp.status_code == 200 else resp.text[:200]
    except Exception as e:
        return 0, time.perf_counter() - t0, str(e)[:200]


async def bench_gemini(secrets: dict, levels: List[int]) -> List[dict]:
    sa_path = _find_service_account()
    if not sa_path:
        print("  [Gemini] ⚠️  Service account not found — skipping")
        return []

    project = secrets["vertex_ai"]["project"]
    location = secrets["vertex_ai"]["location"]

    models = {
        "gemini-2.5-flash": f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/gemini-2.5-flash:generateContent",
        "gemini-2.5-flash-lite": f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/gemini-2.5-flash-lite:generateContent",
    }

    results = []
    for model_name, url in models.items():
        print(f"\n  [Gemini] Testing {model_name}...")
        # Fetch token once per model run (refresh happens inside if expired)
        token = await asyncio.to_thread(_get_gemini_token, sa_path)

        baseline_latency = None
        for n in levels:
            calls = [
                asyncio.to_thread(_gemini_call_sync, url, token, TEST_PROMPT)
                for _ in range(n)
            ]
            t_wall = time.perf_counter()
            outcomes = await asyncio.gather(*calls, return_exceptions=True)
            wall_time = time.perf_counter() - t_wall

            statuses = [o[0] if isinstance(o, tuple) else 0 for o in outcomes]
            latencies = [
                o[1] if isinstance(o, tuple) else CALL_TIMEOUT for o in outcomes
            ]
            errors = [o[2] if isinstance(o, tuple) else str(o) for o in outcomes]

            ok = sum(1 for s in statuses if s == 200)
            rate_limited = sum(1 for s in statuses if s == 429)
            other_errors = sum(1 for s in statuses if s not in (200, 429))
            avg_lat = sum(latencies) / len(latencies)

            if n == 1:
                baseline_latency = avg_lat

            slowdown = avg_lat / baseline_latency if baseline_latency else 1.0
            flagged = slowdown > SLOWDOWN_FACTOR or rate_limited > 0

            row = {
                "provider": "gemini",
                "model": model_name,
                "concurrency": n,
                "wall_time_s": round(wall_time, 2),
                "avg_latency_s": round(avg_lat, 2),
                "slowdown_vs_baseline": round(slowdown, 2),
                "ok": ok,
                "rate_limited_429": rate_limited,
                "other_errors": other_errors,
                "flagged": flagged,
                "sample_errors": [e for e in errors if e][:3],
            }
            results.append(row)

            flag_str = (
                "⚠️  RATE LIMITED" if rate_limited else ("🔴 SLOW" if flagged else "✅")
            )
            print(
                f"    N={n:3d} | wall={wall_time:.2f}s avg_lat={avg_lat:.2f}s "
                f"ok={ok}/{n} 429s={rate_limited} {flag_str}"
            )

            # Brief pause between levels to let rate limits recover
            if n < levels[-1]:
                await asyncio.sleep(2)

    return results


# ═════════════════════════════════════════════════════════════════════════════
# Azure OpenAI helpers
# ═════════════════════════════════════════════════════════════════════════════


def _azure_call_sync(
    endpoint: str, deployment: str, api_version: str, api_key: str, prompt: str
) -> Tuple[int, float, str]:
    url = f"{endpoint.rstrip('/')}/openai/deployments/{deployment}/chat/completions?api-version={api_version}"
    headers = {"api-key": api_key, "Content-Type": "application/json"}
    payload = {
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": MAX_TOKENS,
        "temperature": TEMPERATURE,
    }
    t0 = time.perf_counter()
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=CALL_TIMEOUT)
        dur = time.perf_counter() - t0
        return resp.status_code, dur, "" if resp.status_code == 200 else resp.text[:200]
    except Exception as e:
        return 0, time.perf_counter() - t0, str(e)[:200]


async def bench_azure(secrets: dict, levels: List[int]) -> List[dict]:
    models_cfg = secrets.get("azure_openai", {}).get("models", [])
    # Only test pure OpenAI models (not Llama/meta)
    target_deployments = {"gpt-5.2", "gpt-5.1", "gpt-5-mini", "gpt-5-nano", "o4-mini"}
    models = [m for m in models_cfg if m.get("deployment") in target_deployments]

    if not models:
        print("  [Azure] ⚠️  No matching models found in secrets.toml — skipping")
        return []

    results = []
    for model_cfg in models:
        dep = model_cfg["deployment"]
        endpoint = model_cfg["endpoint"]
        api_key = model_cfg["api_key"]
        api_version = model_cfg.get("api_version", "2025-04-01-preview")

        print(f"\n  [Azure] Testing {dep}...")
        baseline_latency = None

        for n in levels:
            calls = [
                asyncio.to_thread(
                    _azure_call_sync, endpoint, dep, api_version, api_key, TEST_PROMPT
                )
                for _ in range(n)
            ]
            t_wall = time.perf_counter()
            outcomes = await asyncio.gather(*calls, return_exceptions=True)
            wall_time = time.perf_counter() - t_wall

            statuses = [o[0] if isinstance(o, tuple) else 0 for o in outcomes]
            latencies = [
                o[1] if isinstance(o, tuple) else CALL_TIMEOUT for o in outcomes
            ]
            errors = [o[2] if isinstance(o, tuple) else str(o) for o in outcomes]

            ok = sum(1 for s in statuses if s == 200)
            rate_limited = sum(1 for s in statuses if s == 429)
            other_errors = sum(1 for s in statuses if s not in (200, 429))
            avg_lat = sum(latencies) / len(latencies)

            if n == 1:
                baseline_latency = avg_lat

            slowdown = avg_lat / baseline_latency if baseline_latency else 1.0
            flagged = slowdown > SLOWDOWN_FACTOR or rate_limited > 0

            row = {
                "provider": "azure",
                "model": dep,
                "concurrency": n,
                "wall_time_s": round(wall_time, 2),
                "avg_latency_s": round(avg_lat, 2),
                "slowdown_vs_baseline": round(slowdown, 2),
                "ok": ok,
                "rate_limited_429": rate_limited,
                "other_errors": other_errors,
                "flagged": flagged,
                "sample_errors": [e for e in errors if e][:3],
            }
            results.append(row)

            flag_str = (
                "⚠️  RATE LIMITED" if rate_limited else ("🔴 SLOW" if flagged else "✅")
            )
            print(
                f"    N={n:3d} | wall={wall_time:.2f}s avg_lat={avg_lat:.2f}s "
                f"ok={ok}/{n} 429s={rate_limited} {flag_str}"
            )

            if n < levels[-1]:
                await asyncio.sleep(1)

    return results


# ═════════════════════════════════════════════════════════════════════════════
# Anthropic (Vertex) helpers
# ═════════════════════════════════════════════════════════════════════════════


def _anthropic_call_sync(
    project_id: str, location: str, model_id: str, prompt: str, sa_path: Path
) -> Tuple[int, float, str]:
    import os

    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(sa_path)
    from anthropic import AnthropicVertex

    t0 = time.perf_counter()
    try:
        client = AnthropicVertex(project_id=project_id, region=location)
        resp = client.messages.create(
            model=model_id,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        dur = time.perf_counter() - t0
        return 200, dur, ""
    except Exception as e:
        err = str(e)
        dur = time.perf_counter() - t0
        status = 429 if "429" in err or "rate" in err.lower() else 0
        return status, dur, err[:200]


async def bench_anthropic(secrets: dict, levels: List[int]) -> List[dict]:
    sa_path = _find_service_account()
    if not sa_path:
        print("  [Anthropic] ⚠️  Service account not found — skipping")
        return []

    project_id = secrets["anthropic"]["project_id"]
    location = secrets["anthropic"]["location"]  # "global"

    # Anthropic Vertex model IDs
    models = {
        "claude-sonnet-4-6": "claude-sonnet-4-6@20251001",
        "claude-opus-4-5": "claude-opus-4-5@20251101",
    }

    results = []
    for model_name, model_id in models.items():
        print(f"\n  [Anthropic] Testing {model_name}...")
        baseline_latency = None

        for n in levels:
            calls = [
                asyncio.to_thread(
                    _anthropic_call_sync,
                    project_id,
                    location,
                    model_id,
                    TEST_PROMPT,
                    sa_path,
                )
                for _ in range(n)
            ]
            t_wall = time.perf_counter()
            outcomes = await asyncio.gather(*calls, return_exceptions=True)
            wall_time = time.perf_counter() - t_wall

            statuses = [o[0] if isinstance(o, tuple) else 0 for o in outcomes]
            latencies = [
                o[1] if isinstance(o, tuple) else CALL_TIMEOUT for o in outcomes
            ]
            errors = [o[2] if isinstance(o, tuple) else str(o) for o in outcomes]

            ok = sum(1 for s in statuses if s == 200)
            rate_limited = sum(1 for s in statuses if s == 429)
            other_errors = sum(1 for s in statuses if s not in (200, 429))
            avg_lat = sum(latencies) / len(latencies)

            if n == 1:
                baseline_latency = avg_lat

            slowdown = avg_lat / baseline_latency if baseline_latency else 1.0
            flagged = slowdown > SLOWDOWN_FACTOR or rate_limited > 0

            row = {
                "provider": "anthropic",
                "model": model_name,
                "concurrency": n,
                "wall_time_s": round(wall_time, 2),
                "avg_latency_s": round(avg_lat, 2),
                "slowdown_vs_baseline": round(slowdown, 2),
                "ok": ok,
                "rate_limited_429": rate_limited,
                "other_errors": other_errors,
                "flagged": flagged,
                "sample_errors": [e for e in errors if e][:3],
            }
            results.append(row)

            flag_str = (
                "⚠️  RATE LIMITED" if rate_limited else ("🔴 SLOW" if flagged else "✅")
            )
            print(
                f"    N={n:3d} | wall={wall_time:.2f}s avg_lat={avg_lat:.2f}s "
                f"ok={ok}/{n} 429s={rate_limited} {flag_str}"
            )

            if n < levels[-1]:
                await asyncio.sleep(2)

    return results


# ═════════════════════════════════════════════════════════════════════════════
# Main
# ═════════════════════════════════════════════════════════════════════════════


async def main(providers: List[str], max_concurrent: int):
    secrets = load_secrets()
    levels = [l for l in CONCURRENCY_LEVELS if l <= max_concurrent]

    print(f"\n{'='*65}")
    print(f"  Provider Concurrency Benchmark")
    print(f"{'='*65}")
    print(f"  Providers : {', '.join(providers)}")
    print(f"  Levels    : {levels}")
    print(f"  Prompt    : '{TEST_PROMPT}'")
    print(f"  Max tokens: {MAX_TOKENS}  (minimal cost)")
    print(f"{'='*65}\n")

    all_results = []

    if "gemini" in providers:
        print("── Gemini ──────────────────────────────────────────────────────")
        results = await bench_gemini(secrets, levels)
        all_results.extend(results)

    if "azure" in providers:
        print("\n── Azure OpenAI ────────────────────────────────────────────────")
        results = await bench_azure(secrets, levels)
        all_results.extend(results)

    if "anthropic" in providers:
        print("\n── Anthropic (Vertex) ──────────────────────────────────────────")
        results = await bench_anthropic(secrets, levels)
        all_results.extend(results)

    # ── Summary ──────────────────────────────────────────────────────────────
    print(f"\n{'='*65}")
    print(f"  Summary — first concurrency level causing issues per model")
    print(f"{'='*65}")

    summary_by_model = {}
    for row in all_results:
        key = f"{row['provider']}/{row['model']}"
        if key not in summary_by_model:
            summary_by_model[key] = {
                "safe_up_to": None,
                "first_issue_at": None,
                "issue_type": None,
            }
        if not row["flagged"]:
            summary_by_model[key]["safe_up_to"] = row["concurrency"]
        elif summary_by_model[key]["first_issue_at"] is None:
            summary_by_model[key]["first_issue_at"] = row["concurrency"]
            summary_by_model[key]["issue_type"] = (
                "429_rate_limit" if row["rate_limited_429"] else "slowdown"
            )

    for model_key, s in summary_by_model.items():
        if s["first_issue_at"]:
            print(
                f"  {model_key}: safe up to N={s['safe_up_to']}, issues at N={s['first_issue_at']} ({s['issue_type']})"
            )
        else:
            print(
                f"  {model_key}: ✅ no issues at any tested level (max N={levels[-1]})"
            )

    output = {
        "concurrency_levels_tested": levels,
        "providers": providers,
        "results": all_results,
        "summary_by_model": summary_by_model,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n  Full results saved to: {OUTPUT_FILE}")
    print(f"{'='*65}\n")

    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Benchmark LLM provider concurrency limits"
    )
    parser.add_argument(
        "--providers",
        nargs="+",
        default=["gemini", "azure", "anthropic"],
        choices=["gemini", "azure", "anthropic"],
        help="Which providers to test (default: all)",
    )
    parser.add_argument(
        "--max-concurrent",
        type=int,
        default=24,
        help="Max concurrency level to test (default: 24)",
    )
    args = parser.parse_args()
    asyncio.run(main(args.providers, args.max_concurrent))
