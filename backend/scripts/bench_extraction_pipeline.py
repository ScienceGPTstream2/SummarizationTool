"""
bench_extraction_pipeline.py
=============================
End-to-end benchmark of the app's extraction pipeline.

Auto-fetches everything it needs:
  - Auth JWT   : minted from SUPABASE jwt_secret in secrets.toml
  - Documents  : queried from Supabase (most recent completed conversions)
  - App URL    : http://localhost:8001

Tests the app's POST /api/extract endpoint with increasing document counts
(N = 1, 2, 4, 6, 8, 10) and measures total wall time and per-doc time.
Also tests each provider (Gemini, Azure, Anthropic) individually.

Interpretation:
  - If per-doc time stays constant as N grows → pipeline scales well
  - If per-doc time grows with N → bottleneck (rate limits, serialisation, etc.)
  - Difference between providers reveals which is the bottleneck

Usage:
  cd /home/azureuser/SummarizationTool
  python backend/scripts/bench_extraction_pipeline.py
  python backend/scripts/bench_extraction_pipeline.py --doc-counts 1 4 8 --providers gemini
"""

import asyncio
import time
import json
import uuid
import sys
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

# ── Path setup ────────────────────────────────────────────────────────────────
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import toml
import requests
import jwt  # PyJWT

# ── Config ────────────────────────────────────────────────────────────────────
APP_BASE_URL = "http://localhost:8001"
OUTPUT_DIR = BACKEND_DIR / "output" / "bench_diagnosis"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_FILE = OUTPUT_DIR / "extraction_pipeline.json"
TIMEOUT_LOG = BACKEND_DIR / "output" / "timeout_logs" / "timeout_log.txt"

DEFAULT_DOC_COUNTS = [1, 2, 4, 6, 8, 10]

# Simple entity prompt — short enough to be cheap, realistic enough to exercise the path
TEST_ENTITY = {
    "name": "bench_entity",
    "prompt": "What is the main topic of this document? Answer in one sentence.",
    "system_prompt": None,
}

# Provider configs — (model_type, model_id, deployment, display_name)
PROVIDERS = {
    "gemini": {
        "model_type": "gemini",
        "model_id": "publishers/google/models/gemini-2.5-flash",
        "deployment": None,
        "display": "Gemini 2.5 Flash",
    },
    "azure_gpt5mini": {
        "model_type": "azure",
        "model_id": None,
        "deployment": "gpt-5-mini",
        "display": "Azure gpt-5-mini",
    },
    "azure_gpt52": {
        "model_type": "azure",
        "model_id": None,
        "deployment": "gpt-5.2",
        "display": "Azure gpt-5.2",
    },
    "azure_gpt51": {
        "model_type": "azure",
        "model_id": None,
        "deployment": "gpt-5.1",
        "display": "Azure gpt-5.1",
    },
    "azure_gpt5nano": {
        "model_type": "azure",
        "model_id": None,
        "deployment": "gpt-5-nano",
        "display": "Azure gpt-5-nano",
    },
    "azure_o4mini": {
        "model_type": "azure",
        "model_id": None,
        "deployment": "o4-mini",
        "display": "Azure o4-mini",
    },
    "anthropic_sonnet": {
        "model_type": "anthropic",
        "model_id": "claude-sonnet-4-6@20251001",
        "deployment": None,
        "display": "Anthropic Claude Sonnet 4.6",
    },
    "anthropic_opus": {
        "model_type": "anthropic",
        "model_id": "claude-opus-4-5@20251101",
        "deployment": None,
        "display": "Anthropic Claude Opus 4.5",
    },
}


def load_secrets() -> dict:
    path = BACKEND_DIR / "core" / "secrets.toml"
    if not path.exists():
        raise FileNotFoundError(f"secrets.toml not found at {path}")
    return toml.load(path)


def mint_user_jwt(jwt_secret: str) -> str:
    """Create a valid Supabase-compatible user JWT for bench requests."""
    now = int(time.time())
    payload = {
        "sub": str(uuid.uuid4()),
        "aud": "authenticated",
        "role": "authenticated",
        "iss": "supabase",
        "iat": now,
        "exp": now + 7200,
        "email": "bench@bench.local",
        "app_metadata": {},
        "user_metadata": {},
    }
    return jwt.encode(payload, jwt_secret, algorithm="HS256")


def fetch_completed_documents(
    supabase_url: str, service_role_key: str, limit: int = 20
) -> List[Dict]:
    """Query Supabase REST API for most recent completed documents."""
    url = f"{supabase_url}/rest/v1/documents"
    params = {
        "select": "id,session_id,processor_used,filename,page_count",
        "processing_status": "eq.completed",
        "order": "processed_at.desc",
        "limit": str(limit),
    }
    headers = {
        "Authorization": f"Bearer {service_role_key}",
        "apikey": service_role_key,
    }
    resp = requests.get(url, params=params, headers=headers, timeout=10)
    resp.raise_for_status()
    docs = resp.json()
    if not docs:
        raise RuntimeError(
            "No completed documents found in DB. Upload and process some documents first."
        )
    return docs


def read_timeout_log_tail(n_lines: int = 50) -> List[str]:
    if not TIMEOUT_LOG.exists():
        return []
    with open(TIMEOUT_LOG, "r") as f:
        lines = f.readlines()
    return [l.strip() for l in lines[-n_lines:] if l.strip()]


def call_extract(
    token: str,
    conversion_id: str,
    session_id: Optional[str],
    processor_used: str,
    provider_cfg: dict,
) -> Dict[str, Any]:
    """Single synchronous POST /api/extract call. Returns timing + success info."""
    url = f"{APP_BASE_URL}/api/extract"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    if session_id:
        headers["X-Session-Id"] = session_id

    payload = {
        "conversion_id": conversion_id,
        "session_id": session_id,
        "entities": [TEST_ENTITY],
        "model_type": provider_cfg["model_type"],
        "processor_used": processor_used,
        "max_tokens": 256,
        "temperature": 0.0,
    }
    if provider_cfg.get("deployment"):
        payload["deployment"] = provider_cfg["deployment"]
    if provider_cfg.get("model_id"):
        payload["model_id"] = provider_cfg["model_id"]

    t0 = time.perf_counter()
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=300)
        duration = time.perf_counter() - t0
        try:
            body = resp.json()
        except Exception:
            body = {}
        return {
            "status": resp.status_code,
            "duration_s": round(duration, 2),
            "success": resp.status_code == 200,
            "error": body.get("detail") if resp.status_code != 200 else None,
        }
    except Exception as e:
        return {
            "status": 0,
            "duration_s": round(time.perf_counter() - t0, 2),
            "success": False,
            "error": str(e)[:300],
        }


async def bench_provider(
    provider_key: str,
    provider_cfg: dict,
    doc_counts: List[int],
    all_docs: List[dict],
    token: str,
) -> List[dict]:
    results = []
    display = provider_cfg["display"]

    for n_docs in doc_counts:
        if n_docs > len(all_docs):
            print(
                f"    N={n_docs}: ⚠️  Only {len(all_docs)} completed docs available — skipping"
            )
            continue

        docs_to_use = all_docs[:n_docs]
        # Fire all doc extractions concurrently (same as the app does internally)
        tasks = [
            asyncio.to_thread(
                call_extract,
                token,
                doc["id"],
                doc.get("session_id"),
                doc.get("processor_used", "docling"),
                provider_cfg,
            )
            for doc in docs_to_use
        ]

        t_wall = time.perf_counter()
        outcomes = await asyncio.gather(*tasks, return_exceptions=True)
        wall_time = time.perf_counter() - t_wall

        call_results = [
            (
                o
                if isinstance(o, dict)
                else {"status": 0, "duration_s": 0, "success": False, "error": str(o)}
            )
            for o in outcomes
        ]
        ok = sum(1 for r in call_results if r["success"])
        avg_per_doc = sum(r["duration_s"] for r in call_results) / len(call_results)
        per_doc_wall = wall_time / n_docs

        row = {
            "provider": provider_key,
            "display": display,
            "n_docs": n_docs,
            "wall_time_s": round(wall_time, 2),
            "avg_per_doc_s": round(avg_per_doc, 2),
            "wall_per_doc_s": round(per_doc_wall, 2),
            "ok": ok,
            "failed": n_docs - ok,
            "call_details": call_results,
        }
        results.append(row)

        status_str = "✅" if ok == n_docs else f"⚠️  {ok}/{n_docs} succeeded"
        print(
            f"    N={n_docs:3d} docs | wall={wall_time:.1f}s "
            f"avg_per_doc={avg_per_doc:.1f}s {status_str}"
        )

        # Give API a moment to recover between runs
        await asyncio.sleep(3)

    return results


async def main(doc_counts: List[int], provider_keys: List[str]):
    secrets = load_secrets()
    supabase_cfg = secrets["supabase"]
    jwt_secret = supabase_cfg["jwt_secret"]
    supabase_url = supabase_cfg["url"]
    service_role_key = supabase_cfg["service_role_key"]

    print(f"\n{'='*65}")
    print(f"  Extraction Pipeline Benchmark")
    print(f"{'='*65}")

    # ── Health check ──────────────────────────────────────────────────────────
    try:
        r = requests.get(f"{APP_BASE_URL}/health", timeout=5)
        print(
            f"  App health: {r.status_code} — {'OK' if r.status_code == 200 else r.text[:100]}"
        )
    except Exception as e:
        # Try docs endpoint as fallback
        try:
            r = requests.get(f"{APP_BASE_URL}/docs", timeout=5)
            print(
                f"  App reachable at {APP_BASE_URL} (health endpoint not found, /docs={r.status_code})"
            )
        except Exception:
            print(f"  ⚠️  Cannot reach app at {APP_BASE_URL}: {e}")
            print(
                f"  Make sure the backend is running: cd backend && uvicorn main:app --port 8001"
            )
            sys.exit(1)

    # ── Fetch documents ───────────────────────────────────────────────────────
    print(f"\n  Fetching completed documents from Supabase...")
    all_docs = fetch_completed_documents(
        supabase_url, service_role_key, limit=max(doc_counts) + 5
    )
    print(f"  Found {len(all_docs)} completed documents")
    for i, d in enumerate(all_docs[:5]):
        print(
            f"    [{i+1}] {d.get('filename', 'unknown')} (id={d['id'][:8]}... pages={d.get('page_count','?')})"
        )
    if len(all_docs) > 5:
        print(f"    ... and {len(all_docs)-5} more")

    # ── Mint JWT ──────────────────────────────────────────────────────────────
    token = mint_user_jwt(jwt_secret)
    print(f"\n  Auth token minted ✅")

    # ── Baseline: log timeout file line count before run ──────────────────────
    timeout_lines_before = len(read_timeout_log_tail(1000))

    print(f"\n  Doc counts to test : {doc_counts}")
    print(f"  Providers to test  : {provider_keys}")
    print(f"{'='*65}\n")

    all_results = []
    for provider_key in provider_keys:
        if provider_key not in PROVIDERS:
            print(f"  ⚠️  Unknown provider '{provider_key}' — skipping")
            continue
        provider_cfg = PROVIDERS[provider_key]
        print(f"── {provider_cfg['display']} ──────────────────────────────────────")
        rows = await bench_provider(
            provider_key, provider_cfg, doc_counts, all_docs, token
        )
        all_results.extend(rows)
        print()

    # ── Timeout log delta ─────────────────────────────────────────────────────
    new_timeout_lines = read_timeout_log_tail(1000)[timeout_lines_before:]

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'='*65}")
    print(f"  Scaling Summary (wall_time per doc as N grows)")
    print(f"{'='*65}")
    print(
        f"  {'Provider':<28} {'N=1':>6} {'N=2':>6} {'N=4':>6} {'N=6':>6} {'N=8':>6} {'N=10':>6}"
    )
    print(f"  {'-'*64}")

    by_provider: Dict[str, Dict[int, float]] = {}
    for r in all_results:
        pk = r["provider"]
        if pk not in by_provider:
            by_provider[pk] = {}
        by_provider[pk][r["n_docs"]] = r["wall_per_doc_s"]

    for pk, times in by_provider.items():
        display = PROVIDERS.get(pk, {}).get("display", pk)
        cells = [
            (
                f"{times.get(n, '-'):>6.1f}"
                if isinstance(times.get(n), float)
                else f"{'—':>6}"
            )
            for n in [1, 2, 4, 6, 8, 10]
        ]
        print(f"  {display:<28} {'  '.join(cells)}")

    if new_timeout_lines:
        print(
            f"\n  ⚠️  {len(new_timeout_lines)} new timeout log entries during this run:"
        )
        for line in new_timeout_lines[:10]:
            print(f"    {line}")

    output = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "doc_counts": doc_counts,
        "providers_tested": provider_keys,
        "documents_used": [
            {"id": d["id"], "filename": d.get("filename"), "pages": d.get("page_count")}
            for d in all_docs[: max(doc_counts)]
        ],
        "results": all_results,
        "new_timeout_events": len(new_timeout_lines),
        "timeout_log_samples": new_timeout_lines[:20],
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n  Full results saved to: {OUTPUT_FILE}")
    print(f"{'='*65}\n")

    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Benchmark app extraction pipeline end-to-end"
    )
    parser.add_argument(
        "--doc-counts",
        nargs="+",
        type=int,
        default=DEFAULT_DOC_COUNTS,
        help=f"Number of docs to test (default: {DEFAULT_DOC_COUNTS})",
    )
    parser.add_argument(
        "--providers",
        nargs="+",
        default=list(PROVIDERS.keys()),
        choices=list(PROVIDERS.keys()),
        help="Providers to test (default: all)",
    )
    args = parser.parse_args()
    asyncio.run(main(args.doc_counts, args.providers))
