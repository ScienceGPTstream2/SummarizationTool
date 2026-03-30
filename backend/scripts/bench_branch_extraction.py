"""
bench_branch_extraction.py
===========================
Compare extraction speed between git branches.

Sends batched extraction requests (multiple entities per request) to the
backend's POST /api/extract endpoint and measures:
  - Total wall time for all documents
  - Per-document wall time
  - Per-entity average time
  - Throughput (entities/second)

Uses pre-processed documents from backend/files/global/ with docling processor.

Usage:
  cd /home/azureuser/SummarizationTool
  python backend/scripts/bench_branch_extraction.py
  python backend/scripts/bench_branch_extraction.py --doc-counts 1 3 --entity-counts 4
"""

import asyncio
import time
import json
import uuid
import sys
import argparse
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

# ── Path setup ────────────────────────────────────────────────────────────────
BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

import toml
import requests
import jwt as pyjwt  # PyJWT

# ── Config ────────────────────────────────────────────────────────────────────
APP_BASE_URL = "http://localhost:8001"
OUTPUT_DIR = BACKEND_DIR / "output" / "bench_branch_comparison"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_DOC_COUNTS = [1, 3, 5]
DEFAULT_ENTITY_COUNT = 6

# File hashes of pre-processed documents (docling output available)
AVAILABLE_DOCS = [
    "050a79dbc63b6d5b963b2ad3c71db194cb67654c305b4a55e3a97430f3ee9332",
    "1927fdfcc06bfbda1f99bf692d0011bcfa3c14d8b373fe7650fa1dc5fa0aefa9",
    "3efeb5adc48d8e455344f71147046462ae3b7098cdd4ea5f10b16af93d3929ba",
    "6d8c52db7f74ddc1c43a1a19a0503b2940e4008194b23011ed08b3b3be44c15a",
    "a01f05b87ebc2f924dc6707141d057bb9d5134b8cafd975f742a467b0d95edca",
    "a970448034a119ecde89423a3f6866eb73d2caa3c88a65284741193517d7ccb7",
    "ae0baaee030e5dae36e8b6297bc49fb51bfe5d30879403841f0283285919894d",
    "b1dc7a0cef34815586e6eb015b0c2583c2f920d05079457a1417662488907606",
    "c4d5055f6f407f955f77a061859b17feeeb1a7f70f3652f7f4bf9d34e02936ff",
    "dfd585b02da62e5d68c0298bdd3fb58377f00fcf56668c00dc42978fd4b19eba",
]

# Realistic entity prompts (varied types matching a toxicology template)
ENTITY_TEMPLATES = [
    {
        "name": "study_title",
        "prompt": "What is the title of this study? Provide the exact title as written.",
        "system_prompt": None,
    },
    {
        "name": "authors",
        "prompt": "List all authors of this study in the format: Last, First Initial.",
        "system_prompt": None,
    },
    {
        "name": "species_tested",
        "prompt": "What species or organisms were used in this study? List all species mentioned.",
        "system_prompt": None,
    },
    {
        "name": "dose_levels",
        "prompt": "What dose levels or concentrations were used in this study? Include units.",
        "system_prompt": None,
    },
    {
        "name": "route_of_administration",
        "prompt": "What was the route of administration used in this study (e.g., oral, dermal, inhalation)?",
        "system_prompt": None,
    },
    {
        "name": "main_findings",
        "prompt": "Summarize the main findings or conclusions of this study in 2-3 sentences.",
        "system_prompt": None,
    },
    {
        "name": "study_type",
        "prompt": "What type of study is this (e.g., in vivo, in vitro, epidemiological, clinical trial)?",
        "system_prompt": None,
    },
    {
        "name": "endpoints_measured",
        "prompt": "What endpoints or parameters were measured in this study? List the key endpoints.",
        "system_prompt": None,
    },
]

# Provider config — use Gemini Flash for speed and low cost
PROVIDER = {
    "model_type": "gemini",
    "model_id": "publishers/google/models/gemini-2.5-flash",
    "deployment": None,
    "display": "Gemini 2.5 Flash",
}


def get_current_branch() -> str:
    """Get the current git branch name."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, cwd=str(PROJECT_DIR),
        )
        return result.stdout.strip()
    except Exception:
        return "unknown"


def get_current_commit() -> str:
    """Get the current git commit hash (short)."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, cwd=str(PROJECT_DIR),
        )
        return result.stdout.strip()
    except Exception:
        return "unknown"


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
    return pyjwt.encode(payload, jwt_secret, algorithm="HS256")


def call_extract(
    token: str,
    conversion_id: str,
    entities: List[Dict],
    provider_cfg: dict,
    processor_used: str = "docling",
) -> Dict[str, Any]:
    """
    Single synchronous POST /api/extract call with multiple entities.
    Returns timing + result info.
    """
    url = f"{APP_BASE_URL}/api/extract"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    payload = {
        "conversion_id": conversion_id,
        "entities": entities,
        "model_type": provider_cfg["model_type"],
        "processor_used": processor_used,
        "max_tokens": 1024,
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

        extracted_entities = body.get("extracted_entities", [])
        successful = sum(
            1 for e in extracted_entities
            if isinstance(e.get("extracted"), str) and not e["extracted"].startswith("Error:")
        )

        return {
            "conversion_id": conversion_id[:12] + "...",
            "status": resp.status_code,
            "duration_s": round(duration, 3),
            "success": resp.status_code == 200,
            "entities_sent": len(entities),
            "entities_ok": successful,
            "entities_failed": len(entities) - successful,
            "error": body.get("detail") if resp.status_code != 200 else None,
        }
    except Exception as e:
        return {
            "conversion_id": conversion_id[:12] + "...",
            "status": 0,
            "duration_s": round(time.perf_counter() - t0, 3),
            "success": False,
            "entities_sent": len(entities),
            "entities_ok": 0,
            "entities_failed": len(entities),
            "error": str(e)[:300],
        }


async def run_benchmark(
    doc_counts: List[int],
    entity_count: int,
    token: str,
    n_runs: int = 2,
) -> List[Dict]:
    """Run the benchmark for given doc counts and entity counts."""
    entities = ENTITY_TEMPLATES[:entity_count]
    results = []

    for n_docs in doc_counts:
        if n_docs > len(AVAILABLE_DOCS):
            print(f"    N={n_docs}: ⚠️  Only {len(AVAILABLE_DOCS)} docs available — skipping")
            continue

        docs_to_use = AVAILABLE_DOCS[:n_docs]
        run_times = []

        for run_idx in range(n_runs):
            # Fire all doc extractions concurrently (mirrors what the app does)
            tasks = [
                asyncio.to_thread(
                    call_extract,
                    token,
                    doc_hash,
                    entities,
                    PROVIDER,
                )
                for doc_hash in docs_to_use
            ]

            t_wall = time.perf_counter()
            outcomes = await asyncio.gather(*tasks, return_exceptions=True)
            wall_time = time.perf_counter() - t_wall

            call_results = [
                (
                    o if isinstance(o, dict)
                    else {"status": 0, "duration_s": 0, "success": False,
                          "entities_sent": entity_count, "entities_ok": 0,
                          "entities_failed": entity_count, "error": str(o)}
                )
                for o in outcomes
            ]

            ok_docs = sum(1 for r in call_results if r["success"])
            total_entities_ok = sum(r.get("entities_ok", 0) for r in call_results)
            total_entities = n_docs * entity_count
            avg_doc_time = sum(r["duration_s"] for r in call_results) / len(call_results)

            run_data = {
                "run": run_idx + 1,
                "n_docs": n_docs,
                "n_entities_per_doc": entity_count,
                "total_entities": total_entities,
                "wall_time_s": round(wall_time, 3),
                "avg_doc_time_s": round(avg_doc_time, 3),
                "per_entity_wall_s": round(wall_time / total_entities, 3) if total_entities else 0,
                "throughput_entities_per_sec": round(total_entities / wall_time, 2) if wall_time > 0 else 0,
                "docs_ok": ok_docs,
                "docs_failed": n_docs - ok_docs,
                "entities_ok": total_entities_ok,
                "entities_failed": total_entities - total_entities_ok,
            }
            run_times.append(run_data)

            status_str = "✅" if ok_docs == n_docs else f"⚠️  {ok_docs}/{n_docs} docs OK"
            print(
                f"    Run {run_idx+1}: {n_docs} docs × {entity_count} entities | "
                f"wall={wall_time:.1f}s  avg_doc={avg_doc_time:.1f}s  "
                f"throughput={run_data['throughput_entities_per_sec']:.1f} ent/s  "
                f"{status_str}"
            )

            # Brief pause between runs
            if run_idx < n_runs - 1:
                await asyncio.sleep(2)

        # Average across runs
        avg_wall = sum(r["wall_time_s"] for r in run_times) / len(run_times)
        avg_throughput = sum(r["throughput_entities_per_sec"] for r in run_times) / len(run_times)

        summary = {
            "n_docs": n_docs,
            "n_entities_per_doc": entity_count,
            "total_entities": n_docs * entity_count,
            "avg_wall_time_s": round(avg_wall, 3),
            "avg_throughput_ent_per_sec": round(avg_throughput, 2),
            "runs": run_times,
        }
        results.append(summary)

        print(
            f"    ── Average: wall={avg_wall:.1f}s  throughput={avg_throughput:.1f} ent/s ──"
        )

        # Pause between doc counts
        await asyncio.sleep(3)

    return results


async def main(doc_counts: List[int], entity_count: int, n_runs: int):
    secrets = load_secrets()
    supabase_cfg = secrets["supabase"]
    jwt_secret = supabase_cfg["jwt_secret"]

    branch = get_current_branch()
    commit = get_current_commit()

    print(f"\n{'='*70}")
    print(f"  Extraction Branch Benchmark")
    print(f"  Branch : {branch}")
    print(f"  Commit : {commit}")
    print(f"  Time   : {datetime.now().isoformat()}")
    print(f"{'='*70}")

    # ── Health check ──────────────────────────────────────────────────────────
    try:
        r = requests.get(f"{APP_BASE_URL}/api/server/models", timeout=5)
        print(f"  Backend health: {'OK' if r.status_code == 200 else r.status_code}")
    except Exception as e:
        try:
            r = requests.get(f"{APP_BASE_URL}/docs", timeout=5)
            print(f"  Backend reachable (models endpoint failed): {r.status_code}")
        except Exception:
            print(f"  ⚠️  Cannot reach backend at {APP_BASE_URL}: {e}")
            print(f"  Start with: cd backend && uvicorn main:app --port 8001")
            sys.exit(1)

    # ── Verify docs exist ─────────────────────────────────────────────────────
    max_needed = max(doc_counts)
    available = 0
    for h in AVAILABLE_DOCS[:max_needed]:
        md_path = BACKEND_DIR / "files" / "global" / h / "processed" / "docling" / "document.md"
        if md_path.exists():
            available += 1
    print(f"  Documents available: {available}/{max_needed} needed")
    if available < max_needed:
        print(f"  ⚠️  Only {available} docs found — adjusting doc counts")
        doc_counts = [d for d in doc_counts if d <= available]

    # ── Mint JWT ──────────────────────────────────────────────────────────────
    token = mint_user_jwt(jwt_secret)
    print(f"  Auth token minted ✅")

    print(f"\n  Config:")
    print(f"    Doc counts     : {doc_counts}")
    print(f"    Entities/doc   : {entity_count}")
    print(f"    Runs per config: {n_runs}")
    print(f"    Provider       : {PROVIDER['display']}")
    print(f"{'='*70}\n")

    # ── Run benchmark ─────────────────────────────────────────────────────────
    results = await run_benchmark(doc_counts, entity_count, token, n_runs)

    # ── Summary table ─────────────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  Summary — {branch} ({commit})")
    print(f"{'='*70}")
    print(f"  {'Docs':>5}  {'Entities':>8}  {'Wall(s)':>8}  {'Throughput':>12}  {'Status':>10}")
    print(f"  {'-'*50}")
    for r in results:
        total_ok = sum(run["entities_ok"] for run in r["runs"])
        total_ent = sum(run["total_entities"] for run in r["runs"])
        status = "✅" if total_ok == total_ent else f"⚠️ {total_ok}/{total_ent}"
        print(
            f"  {r['n_docs']:>5}  {r['total_entities']:>8}  "
            f"{r['avg_wall_time_s']:>8.1f}  "
            f"{r['avg_throughput_ent_per_sec']:>10.1f}/s  "
            f"{status:>10}"
        )

    # ── Save results ──────────────────────────────────────────────────────────
    output = {
        "branch": branch,
        "commit": commit,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "doc_counts": doc_counts,
            "entity_count": entity_count,
            "n_runs": n_runs,
            "provider": PROVIDER["display"],
            "model_type": PROVIDER["model_type"],
            "model_id": PROVIDER.get("model_id"),
        },
        "documents_used": AVAILABLE_DOCS[:max(doc_counts)] if doc_counts else [],
        "results": results,
    }

    safe_branch = branch.replace("/", "_").replace("\\", "_")
    output_file = OUTPUT_DIR / f"bench_{safe_branch}_{commit}.json"
    with open(output_file, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n  Results saved to: {output_file}")
    print(f"{'='*70}\n")

    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Benchmark extraction speed across branches"
    )
    parser.add_argument(
        "--doc-counts",
        nargs="+",
        type=int,
        default=DEFAULT_DOC_COUNTS,
        help=f"Number of docs to test (default: {DEFAULT_DOC_COUNTS})",
    )
    parser.add_argument(
        "--entity-count",
        type=int,
        default=DEFAULT_ENTITY_COUNT,
        help=f"Number of entities per doc (default: {DEFAULT_ENTITY_COUNT})",
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=2,
        help="Number of runs per configuration (default: 2)",
    )
    args = parser.parse_args()
    asyncio.run(main(args.doc_counts, args.entity_count, args.runs))
