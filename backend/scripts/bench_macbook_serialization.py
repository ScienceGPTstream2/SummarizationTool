"""
bench_macbook_serialization.py
================================
A/B benchmark comparing concurrent vs serialized extraction for Macbook-hosted
LLM models. Uses the exact same API endpoints and functions as the production app
to ensure results are representative.

PROBLEM:
  When multiple entities are sent to a MacBook-hosted Ollama server simultaneously
  (via asyncio.gather or batched /api/extract), all models try to load into GPU VRAM
  at once, causing timeouts, failures, and degraded quality.

STRATEGIES:
  concurrent  — Send ALL entities in ONE batched request to /api/extract with
                model_type="macbook". Backend uses asyncio.gather → N simultaneous
                Ollama requests. This is the OLD behaviour (before serialization).

  serialized  — Send entities ONE AT A TIME, each as a separate /api/extract request
                with entities=[single_entity]. Only one Ollama inference runs at a time.
                This is the NEW behaviour after the FIFO queue + sequential dispatch.

WHAT THIS MEASURES:
  - Wall time for complete extraction
  - Success rate (% of entities that return valid results vs errors/timeouts)
  - Per-entity latency distribution
  - Timeout count

Usage:
  cd /home/azureuser/SummarizationTool
  python backend/scripts/bench_macbook_serialization.py --model "qwen2.5:7b"
  python backend/scripts/bench_macbook_serialization.py --model "deepseek-r1:8b" --entities 8
  python backend/scripts/bench_macbook_serialization.py --strategy serialized --entities 4
  python backend/scripts/bench_macbook_serialization.py --strategy all  # both strategies
"""

import asyncio
import time
import json
import uuid
import sys
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timezone
from dataclasses import dataclass, field

# ── Path setup ────────────────────────────────────────────────────────────────
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import toml
import requests
import jwt  # PyJWT

# ── Config ────────────────────────────────────────────────────────────────────
APP_BASE_URL = "http://localhost:8001"
TESTING_MDS_DIR = BACKEND_DIR.parent / "Testing-MDs"
FILES_GLOBAL_DIR = BACKEND_DIR / "files" / "global"
OUTPUT_DIR = BACKEND_DIR / "output" / "bench_macbook_serialization"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Generous timeout for macbook models — large documents can take >600s for local inference.
# Must match or exceed per_attempt_timeout in macbook.py (1800s).
MACBOOK_REQUEST_TIMEOUT = 1800  # 30 minutes per request

# Test entities — representative extraction prompts that exercise the LLM
TEST_ENTITIES = [
    {
        "name": "compound",
        "prompt": "What is the main chemical compound or substance studied in this paper? Provide the name and any synonyms mentioned.",
        "system_prompt": "You are an expert toxicologist extracting key information from scientific studies.",
    },
    {
        "name": "study_type",
        "prompt": "What type of study is this (e.g., in vitro, in vivo, epidemiological, clinical trial, review)? Classify and explain briefly.",
        "system_prompt": "You are an expert toxicologist extracting key information from scientific studies.",
    },
    {
        "name": "species_strain",
        "prompt": "What species and strain of animal was used in this study? If human, state 'Human study'. If in vitro, state the cell line(s) used.",
        "system_prompt": "You are an expert toxicologist extracting key information from scientific studies.",
    },
    {
        "name": "dose_levels",
        "prompt": "List all dose levels, concentrations, or treatment groups used in this study. Include units and route of administration if mentioned.",
        "system_prompt": "You are an expert toxicologist extracting key information from scientific studies.",
    },
    {
        "name": "endpoints",
        "prompt": "What biological endpoints or outcomes were measured? List the primary and secondary endpoints.",
        "system_prompt": "You are an expert toxicologist extracting key information from scientific studies.",
    },
    {
        "name": "findings",
        "prompt": "Summarize the key findings and results of this study. Include statistical significance where mentioned.",
        "system_prompt": "You are an expert toxicologist extracting key information from scientific studies.",
    },
    {
        "name": "noael_loael",
        "prompt": "Was a NOAEL (No Observed Adverse Effect Level) or LOAEL (Lowest Observed Adverse Effect Level) determined? If so, what were the values?",
        "system_prompt": "You are an expert toxicologist extracting key information from scientific studies.",
    },
    {
        "name": "conclusions",
        "prompt": "What were the main conclusions drawn by the authors? Summarize in 2-3 sentences.",
        "system_prompt": "You are an expert toxicologist extracting key information from scientific studies.",
    },
]


# ── Helpers (reused from bench_concurrent_strategies.py) ──────────────────────


def load_secrets() -> dict:
    path = BACKEND_DIR / "core" / "secrets.toml"
    if not path.exists():
        raise FileNotFoundError(f"secrets.toml not found at {path}")
    return toml.load(path)


def mint_user_jwt(jwt_secret: str) -> str:
    now = int(time.time())
    payload = {
        "sub": str(uuid.uuid4()),
        "aud": "authenticated",
        "role": "authenticated",
        "iss": "supabase",
        "iat": now,
        "exp": now + 7200,
        "email": "bench-macbook@bench.local",
        "app_metadata": {},
        "user_metadata": {},
    }
    return jwt.encode(payload, jwt_secret, algorithm="HS256")


def discover_documents_from_filesystem(limit: int = 5) -> List[Dict]:
    """Discover processed documents from the filesystem."""
    docs: List[Dict] = []
    seen: set = set()

    if TESTING_MDS_DIR.exists():
        for md_file in sorted(TESTING_MDS_DIR.glob("*_base*.md")):
            file_hash = md_file.name.split("_base")[0]
            if file_hash in seen:
                continue
            seen.add(file_hash)
            processor = "docling"
            for proc in ("docling", "azure_doc_intelligence"):
                p = FILES_GLOBAL_DIR / file_hash / "processed" / proc / "document.md"
                if p.exists():
                    processor = proc
                    break
            docs.append(
                {
                    "id": file_hash,
                    "file_hash": file_hash,
                    "filename": md_file.name,
                    "processor_used": processor,
                }
            )
            if len(docs) >= limit:
                break

    if not docs and FILES_GLOBAL_DIR.exists():
        for hash_dir in sorted(FILES_GLOBAL_DIR.iterdir()):
            if not hash_dir.is_dir():
                continue
            file_hash = hash_dir.name
            if file_hash in seen:
                continue
            processor = None
            for proc in ("docling", "azure_doc_intelligence"):
                p = hash_dir / "processed" / proc / "document.md"
                if p.exists():
                    processor = proc
                    break
            if not processor:
                continue
            seen.add(file_hash)
            docs.append(
                {
                    "id": file_hash,
                    "file_hash": file_hash,
                    "filename": file_hash[:12] + "...",
                    "processor_used": processor,
                }
            )
            if len(docs) >= limit:
                break

    if not docs:
        raise RuntimeError(
            f"No processed documents found. "
            f"Expected Testing-MDs/ at {TESTING_MDS_DIR} "
            f"or processed files under {FILES_GLOBAL_DIR}"
        )
    return docs


def call_extract_single_entity(
    token: str,
    conversion_id: str,
    processor_used: str,
    entity: dict,
    model_id: str,
    timeout: float = MACBOOK_REQUEST_TIMEOUT,
) -> Dict[str, Any]:
    """
    Send a SINGLE entity to /api/extract with model_type="macbook".
    This mirrors exactly what extractEntityFromApi() does in the frontend.
    """
    url = f"{APP_BASE_URL}/api/extract"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "conversion_id": conversion_id,
        "entities": [entity],
        "model_type": "macbook",
        "model_id": model_id,
        "processor_used": processor_used,
        "max_tokens": 4096,
        "temperature": 0.0,
    }

    t0 = time.perf_counter()
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=timeout)
        duration = time.perf_counter() - t0

        if resp.status_code == 200:
            data = resp.json()
            extracted = data.get("extracted_entities", [])
            if extracted:
                content = extracted[0].get("extracted", "")
                is_error = isinstance(content, str) and content.startswith("Error:")
                is_empty = not content or not content.strip()
                return {
                    "status": resp.status_code,
                    "duration_s": round(duration, 2),
                    "success": not is_error and not is_empty,
                    "entity": entity["name"],
                    "model": model_id,
                    # Show up to 200 chars so we can see what Ollama actually returned
                    "content_preview": (
                        content[:200]
                        if content
                        else "(EMPTY — think-tag stripped or timeout)"
                    ),
                    "is_error_content": is_error,
                    "is_empty_content": is_empty,
                }
            return {
                "status": resp.status_code,
                "duration_s": round(duration, 2),
                "success": False,
                "entity": entity["name"],
                "model": model_id,
                "error": "No extracted_entities in response",
            }
        else:
            return {
                "status": resp.status_code,
                "duration_s": round(duration, 2),
                "success": False,
                "entity": entity["name"],
                "model": model_id,
                "error": resp.text[:200],
            }
    except requests.exceptions.Timeout:
        return {
            "status": 0,
            "duration_s": round(time.perf_counter() - t0, 2),
            "success": False,
            "entity": entity["name"],
            "model": model_id,
            "error": f"Timeout after {timeout}s",
            "is_timeout": True,
        }
    except Exception as e:
        return {
            "status": 0,
            "duration_s": round(time.perf_counter() - t0, 2),
            "success": False,
            "entity": entity["name"],
            "model": model_id,
            "error": str(e)[:200],
        }


def call_extract_all_entities_batched(
    token: str,
    conversion_id: str,
    processor_used: str,
    entities: List[dict],
    model_id: str,
    timeout: float = MACBOOK_REQUEST_TIMEOUT,
) -> Dict[str, Any]:
    """
    Send ALL entities in ONE request to /api/extract with model_type="macbook".
    This mirrors exactly what extractAllEntitiesForModelBatched() does in the frontend.
    The backend runs them via asyncio.gather → N simultaneous Ollama calls.
    """
    url = f"{APP_BASE_URL}/api/extract"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "conversion_id": conversion_id,
        "entities": entities,
        "model_type": "macbook",
        "model_id": model_id,
        "processor_used": processor_used,
        "max_tokens": 4096,
        "temperature": 0.0,
    }

    t0 = time.perf_counter()
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=timeout)
        duration = time.perf_counter() - t0

        if resp.status_code == 200:
            data = resp.json()
            extracted = data.get("extracted_entities", [])
            successes = 0
            errors = 0
            timeouts = 0
            per_entity = []

            for item in extracted:
                content = item.get("extracted", "")
                is_err = isinstance(content, str) and content.startswith("Error:")
                is_timeout = is_err and "timed out" in content.lower()
                is_empty = not content or not content.strip()
                if is_err:
                    errors += 1
                    if is_timeout:
                        timeouts += 1
                elif is_empty:
                    errors += 1  # treat empty as failure
                else:
                    successes += 1
                per_entity.append(
                    {
                        "name": item.get("name"),
                        "success": not is_err and not is_empty,
                        "is_timeout": is_timeout,
                        "is_empty": is_empty,
                        "duration_s": item.get("meta", {}).get("duration"),
                        # Show up to 200 chars so we can see what Ollama actually returned
                        "content_preview": (
                            content[:200]
                            if content
                            else "(EMPTY — think-tag stripped or timeout)"
                        ),
                    }
                )

            return {
                "status": resp.status_code,
                "duration_s": round(duration, 2),
                "success": successes > 0,
                "entity_count": len(entities),
                "successes": successes,
                "errors": errors,
                "timeouts": timeouts,
                "model": model_id,
                "per_entity": per_entity,
            }
        else:
            return {
                "status": resp.status_code,
                "duration_s": round(duration, 2),
                "success": False,
                "entity_count": len(entities),
                "model": model_id,
                "error": resp.text[:200],
            }
    except requests.exceptions.Timeout:
        return {
            "status": 0,
            "duration_s": round(time.perf_counter() - t0, 2),
            "success": False,
            "entity_count": len(entities),
            "model": model_id,
            "error": f"HTTP timeout after {timeout}s",
            "is_timeout": True,
        }
    except Exception as e:
        return {
            "status": 0,
            "duration_s": round(time.perf_counter() - t0, 2),
            "success": False,
            "entity_count": len(entities),
            "model": model_id,
            "error": str(e)[:200],
        }


# ── Strategy runners ──────────────────────────────────────────────────────────


async def run_concurrent(
    doc: dict,
    entities: List[dict],
    model_id: str,
    token: str,
) -> Dict[str, Any]:
    """
    CONCURRENT strategy: send all entities in one batched request.
    Backend asyncio.gather fires N Ollama requests simultaneously.
    This is the OLD behaviour (before the serialization fix).
    """
    print(f"    📦 Concurrent: {len(entities)} entities → 1 batched request")
    result = await asyncio.to_thread(
        call_extract_all_entities_batched,
        token,
        doc["id"],
        doc.get("processor_used", "docling"),
        entities,
        model_id,
    )
    return result


async def run_serialized(
    doc: dict,
    entities: List[dict],
    model_id: str,
    token: str,
) -> Dict[str, Any]:
    """
    SERIALIZED strategy: send entities one at a time, sequentially.
    Only one Ollama inference runs at any time.
    This is the NEW behaviour (after the serialization fix).
    """
    print(
        f"    🐢 Serialized: {len(entities)} entities → {len(entities)} sequential requests"
    )
    results = []
    total_duration = 0.0
    successes = 0
    errors = 0
    timeouts = 0

    for i, entity in enumerate(entities):
        print(
            f"      [{i+1}/{len(entities)}] Extracting '{entity['name']}'...",
            end=" ",
            flush=True,
        )
        result = await asyncio.to_thread(
            call_extract_single_entity,
            token,
            doc["id"],
            doc.get("processor_used", "docling"),
            entity,
            model_id,
        )
        duration = result.get("duration_s", 0)
        total_duration += duration

        if result.get("success"):
            successes += 1
            print(f"✅ ({duration:.1f}s)")
        elif result.get("is_timeout"):
            timeouts += 1
            errors += 1
            print(f"⏰ TIMEOUT ({duration:.1f}s)")
        else:
            errors += 1
            print(f"❌ ({duration:.1f}s) {result.get('error', '')[:60]}")

        results.append(result)

    return {
        "status": 200 if successes > 0 else 0,
        "duration_s": round(total_duration, 2),
        "success": successes > 0,
        "entity_count": len(entities),
        "successes": successes,
        "errors": errors,
        "timeouts": timeouts,
        "model": model_id,
        "per_entity": [
            {
                "name": r.get("entity"),
                "success": r.get("success", False),
                "is_timeout": r.get("is_timeout", False),
                "duration_s": r.get("duration_s"),
                "content_preview": r.get("content_preview", ""),
            }
            for r in results
        ],
    }


# ── Main ──────────────────────────────────────────────────────────────────────


async def main(
    model_id: str,
    n_entities: int = 4,
    strategies: List[str] = None,
    n_docs: int = 1,
):
    if strategies is None:
        strategies = ["concurrent", "serialized"]

    print(f"\n{'='*70}")
    print(f"  Macbook Serialization Benchmark")
    print(f"  Model       : {model_id}")
    print(f"  Entities    : {n_entities}")
    print(f"  Documents   : {n_docs}")
    print(f"  Strategies  : {', '.join(strategies)}")
    print(f"  Timeout/req : {MACBOOK_REQUEST_TIMEOUT}s")
    print(f"{'='*70}")

    # ── Load config ──
    secrets = load_secrets()
    sb = secrets["supabase"]
    token = mint_user_jwt(sb["jwt_secret"])

    # ── Health check (use simple endpoint, /api/models can be slow when fetching macbook tags) ──
    try:
        r = requests.get(f"{APP_BASE_URL}/api/server/health", timeout=15)
        print(f"\n  Backend: reachable (HTTP {r.status_code})")
    except Exception as e:
        print(f"\n  ⚠️  Cannot reach backend at {APP_BASE_URL}: {e}")
        print(f"  Start with: cd backend && uvicorn main:app --port 8001 --reload")
        sys.exit(1)

    # Optionally try to list macbook models (non-blocking, just informational)
    try:
        r2 = requests.get(
            f"{APP_BASE_URL}/api/models",
            headers={"Authorization": f"Bearer {token}"},
            timeout=120,  # Macbook tag fetch can be very slow
        )
        if r2.status_code == 200:
            data = r2.json()
            models_list = (
                data
                if isinstance(data, list)
                else data.get("models", []) if isinstance(data, dict) else []
            )
            macbook_models = [
                m
                for m in models_list
                if isinstance(m, dict)
                and m.get("provider", "").lower().startswith("macbook")
            ]
            print(f"  Macbook models available: {len(macbook_models)}")
            if macbook_models:
                print(
                    f"    {[m.get('name', m.get('id', '?')) for m in macbook_models]}"
                )
            if not macbook_models:
                print(f"  ⚠️  No macbook models detected — is the MacBook reachable?")
    except Exception as e2:
        print(f"  ⚠️  Could not list models (non-fatal): {e2}")

    # ── Discover documents ──
    docs = discover_documents_from_filesystem(limit=n_docs)
    entities = TEST_ENTITIES[:n_entities]

    print(f"\n  Using {len(docs)} document(s):")
    for i, d in enumerate(docs):
        print(f"    [{i+1}] {d.get('filename', d['id'][:12])}")
    print(f"\n  Entities: {[e['name'] for e in entities]}")

    # ── Run strategies ──
    all_results: Dict[str, Dict] = {}

    for strategy in strategies:
        print(f"\n{'─'*70}")
        print(f"  Running: {strategy.upper()}")
        print(f"{'─'*70}")

        strategy_results = []
        wall_start = time.perf_counter()

        for doc_idx, doc in enumerate(docs):
            print(
                f"\n  Document {doc_idx+1}/{len(docs)}: {doc.get('filename', doc['id'][:12])}"
            )

            if strategy == "concurrent":
                result = await run_concurrent(doc, entities, model_id, token)
            elif strategy == "serialized":
                result = await run_serialized(doc, entities, model_id, token)
            else:
                raise ValueError(f"Unknown strategy: {strategy}")

            strategy_results.append(
                {
                    "doc_id": doc["id"],
                    "doc_filename": doc.get("filename", ""),
                    **result,
                }
            )

        wall_time = time.perf_counter() - wall_start

        # Aggregate stats
        total_entities = sum(r.get("entity_count", 1) for r in strategy_results)
        total_success = sum(
            r.get("successes", 1 if r.get("success") else 0) for r in strategy_results
        )
        total_errors = sum(
            r.get("errors", 0 if r.get("success") else 1) for r in strategy_results
        )
        total_timeouts = sum(r.get("timeouts", 0) for r in strategy_results)
        durations = [r.get("duration_s", 0) for r in strategy_results]

        # Per-entity latency stats
        per_entity_durations = []
        for r in strategy_results:
            for pe in r.get("per_entity", []):
                if pe.get("duration_s") is not None:
                    per_entity_durations.append(pe["duration_s"])

        avg_entity_latency = (
            sum(per_entity_durations) / len(per_entity_durations)
            if per_entity_durations
            else 0
        )
        min_entity_latency = min(per_entity_durations) if per_entity_durations else 0
        max_entity_latency = max(per_entity_durations) if per_entity_durations else 0

        success_rate = (
            (total_success / total_entities * 100) if total_entities > 0 else 0
        )

        print(f"\n  ── {strategy.upper()} RESULTS ──")
        print(f"  Wall time       : {wall_time:.1f}s")
        print(f"  Total entities  : {total_entities}")
        print(
            f"  Successes       : {total_success}/{total_entities} ({success_rate:.0f}%)"
        )
        print(f"  Errors          : {total_errors}")
        print(f"  Timeouts        : {total_timeouts}")
        if per_entity_durations:
            print(
                f"  Entity latency  : avg={avg_entity_latency:.1f}s  min={min_entity_latency:.1f}s  max={max_entity_latency:.1f}s"
            )

        # Print per-entity content previews so we can verify Ollama is returning real content
        print(f"\n  Per-entity content preview:")
        for r in strategy_results:
            for pe in r.get("per_entity", []):
                status = (
                    "OK "
                    if pe.get("success")
                    else (
                        "TMO"
                        if pe.get("is_timeout")
                        else ("EMP" if pe.get("is_empty") else "ERR")
                    )
                )
                latency = f"{pe['duration_s']:.1f}s" if pe.get("duration_s") else "  ?"
                preview = pe.get("content_preview", "")
                print(f"    [{status}] {pe['name']:<20} {latency:>7}  {preview[:120]}")

        all_results[strategy] = {
            "wall_time_s": round(wall_time, 2),
            "total_entities": total_entities,
            "successes": total_success,
            "errors": total_errors,
            "timeouts": total_timeouts,
            "success_rate_pct": round(success_rate, 1),
            "avg_entity_latency_s": round(avg_entity_latency, 2),
            "min_entity_latency_s": round(min_entity_latency, 2),
            "max_entity_latency_s": round(max_entity_latency, 2),
            "per_doc": strategy_results,
        }

        # Cool-down between strategies to let Ollama release GPU
        if strategy != strategies[-1]:
            cooldown = 10
            print(f"\n  Cooling down {cooldown}s to let Ollama release GPU memory...")
            await asyncio.sleep(cooldown)

    # ── Comparison ────────────────────────────────────────────────────────────
    print(f"\n\n{'='*70}")
    print(f"  COMPARISON: {model_id}")
    print(f"{'='*70}")
    print(f"  {'Metric':<25} ", end="")
    for s in strategies:
        print(f"{'│ ' + s.upper():<20}", end="")
    print()
    print(f"  {'─'*25} ", end="")
    for _ in strategies:
        print(f"{'│ ' + '─'*17}", end="")
    print()

    metrics = [
        ("Wall time (s)", "wall_time_s"),
        ("Success rate (%)", "success_rate_pct"),
        ("Successes", "successes"),
        ("Errors", "errors"),
        ("Timeouts", "timeouts"),
        ("Avg entity latency (s)", "avg_entity_latency_s"),
        ("Min entity latency (s)", "min_entity_latency_s"),
        ("Max entity latency (s)", "max_entity_latency_s"),
    ]

    for label, key in metrics:
        print(f"  {label:<25} ", end="")
        for s in strategies:
            val = all_results.get(s, {}).get(key, "—")
            print(f"│ {val:<18}", end="")
        print()

    # Verdict
    if (
        len(strategies) == 2
        and "concurrent" in all_results
        and "serialized" in all_results
    ):
        conc = all_results["concurrent"]
        ser = all_results["serialized"]

        print(f"\n  ── VERDICT ──")
        if ser["success_rate_pct"] > conc["success_rate_pct"]:
            improvement = ser["success_rate_pct"] - conc["success_rate_pct"]
            print(f"  ✅ Serialized is MORE RELIABLE: +{improvement:.0f}% success rate")
        elif ser["success_rate_pct"] == conc["success_rate_pct"]:
            print(f"  ⚖️  Same success rate ({ser['success_rate_pct']}%)")
        else:
            regression = conc["success_rate_pct"] - ser["success_rate_pct"]
            print(f"  ⚠️  Serialized is LESS reliable: -{regression:.0f}% success rate")

        if ser["timeouts"] < conc["timeouts"]:
            print(
                f"  ✅ Serialized has FEWER timeouts: {ser['timeouts']} vs {conc['timeouts']}"
            )
        elif ser["timeouts"] == conc["timeouts"]:
            print(f"  ⚖️  Same timeout count ({ser['timeouts']})")
        else:
            print(
                f"  ⚠️  Serialized has MORE timeouts: {ser['timeouts']} vs {conc['timeouts']}"
            )

        time_diff = ser["wall_time_s"] - conc["wall_time_s"]
        if time_diff > 0:
            print(
                f"  ℹ️  Serialized is {time_diff:.0f}s slower (expected trade-off for reliability)"
            )
        else:
            print(
                f"  🎉 Serialized is {abs(time_diff):.0f}s FASTER (GPU not overloaded)"
            )

    # ── Save ──────────────────────────────────────────────────────────────────
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    model_safe = model_id.replace("/", "_").replace(":", "_")
    output_file = OUTPUT_DIR / f"bench_{model_safe}_{timestamp}.json"

    output = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "model_id": model_id,
            "n_entities": n_entities,
            "n_docs": n_docs,
            "strategies": strategies,
            "macbook_request_timeout_s": MACBOOK_REQUEST_TIMEOUT,
            "app_url": APP_BASE_URL,
        },
        "results": all_results,
    }

    with open(output_file, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\n  Results saved to: {output_file}")
    print(f"{'='*70}\n")

    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Benchmark Macbook LLM serialization: concurrent vs serialized"
    )
    parser.add_argument(
        "--model",
        type=str,
        default="qwen2.5:7b",
        help="Macbook model ID (Ollama model name). Default: qwen2.5:7b",
    )
    parser.add_argument(
        "--entities",
        type=int,
        default=4,
        help="Number of test entities to extract (default: 4, max: 8)",
    )
    parser.add_argument(
        "--docs",
        type=int,
        default=1,
        help="Number of documents to test (default: 1)",
    )
    parser.add_argument(
        "--strategy",
        nargs="+",
        default=["concurrent", "serialized"],
        choices=["concurrent", "serialized", "all"],
        help="Strategies to benchmark (default: both)",
    )
    args = parser.parse_args()

    strategies = args.strategy
    if "all" in strategies:
        strategies = ["concurrent", "serialized"]

    asyncio.run(
        main(
            model_id=args.model,
            n_entities=min(args.entities, len(TEST_ENTITIES)),
            strategies=strategies,
            n_docs=args.docs,
        )
    )
