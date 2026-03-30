"""
bench_concurrent_strategies.py
================================
Benchmarks four HTTP dispatch strategies for the extraction pipeline to determine
which maximises throughput given browser/proxy HTTP/1.1 connection pool limits.

ROOT CAUSE BEING TESTED:
  Browsers allow only 6 concurrent TCP connections per origin (HTTP/1.1).
  With 5 docs × 16 entities × 5 models = 400 requests all launched via Promise.all,
  the browser queues 394. Doc1's requests are first in queue, so it finishes while
  docs 3-5 show 0 progress. Backend semaphore (48) and thread pool (64) sit idle.

STRATEGIES:
  baseline    — Fire all requests concurrently with asyncio.Semaphore(SIM_BROWSER_CONNS=6)
                Simulates browser HTTP/1.1 FIFO queue. Requests ordered by doc (doc1 first).
  interleaved — Same concurrency cap but requests ordered round-robin across docs.
                Each doc gets equal share of the 6 available connections.
  all_entities— Send ALL entities for a doc+model in ONE request (backend asyncio.gather
                handles per-entity LLM calls). Reduces 400 requests → N_DOCS*N_MODELS.
                Each entity still gets its own LLM prompt — quality unchanged.
  semaphore_N — Fire all requests with larger semaphore (N=24, 48) to test how many
                concurrent backend connections are actually achievable (server capacity).

Usage:
  cd /home/azureuser/SummarizationTool
  python backend/scripts/bench_concurrent_strategies.py
  python backend/scripts/bench_concurrent_strategies.py --docs 5 --entities 4 --strategy all
  python backend/scripts/bench_concurrent_strategies.py --strategy baseline interleaved
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
OUTPUT_DIR = BACKEND_DIR / "output" / "bench_diagnosis"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_FILE = OUTPUT_DIR / "concurrent_strategies.json"

# Simulated browser connection pool limit (Chrome HTTP/1.1 = 6 per origin)
SIM_BROWSER_CONNS = 6

# Test entities — short prompts so LLM calls are fast (cost < $0.001 each)
TEST_ENTITIES = [
    {
        "name": "compound",
        "prompt": "What is the main chemical compound studied? One sentence.",
        "system_prompt": None,
    },
    {
        "name": "study_type",
        "prompt": "Is this an in vitro, in vivo, or clinical study? One sentence.",
        "system_prompt": None,
    },
    {
        "name": "endpoint",
        "prompt": "What biological endpoint was measured? One sentence.",
        "system_prompt": None,
    },
    {
        "name": "dose",
        "prompt": "What dose or concentration levels were used? One sentence.",
        "system_prompt": None,
    },
]

# Models to test — pick fast/cheap ones; override with --models flag
DEFAULT_MODELS = [
    {
        "model_type": "gemini",
        "model_id": "publishers/google/models/gemini-2.5-flash",
        "deployment": None,
        "display": "Gemini 2.5 Flash",
    },
    {
        "model_type": "azure",
        "model_id": None,
        "deployment": "gpt-5-mini",
        "display": "Azure gpt-5-mini",
    },
]


# ── Helpers ───────────────────────────────────────────────────────────────────


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
        "email": "bench@bench.local",
        "app_metadata": {},
        "user_metadata": {},
    }
    return jwt.encode(payload, jwt_secret, algorithm="HS256")


def discover_documents_from_filesystem(limit: int = 15) -> List[Dict]:
    """
    Discover processed documents from the filesystem.

    Priority order:
    1. Testing-MDs/ directory — filenames are {hash}_base.md, hash = conversion_id
    2. backend/files/global/{hash}/processed/docling/document.md — direct cache scan

    This bypasses the Supabase documents table entirely, which may have rows stuck at
    'pending' when cache-hit processing skips the DB status update.
    """
    docs: List[Dict] = []
    seen: set = set()

    # ── Try Testing-MDs/ first ────────────────────────────────────────────────
    if TESTING_MDS_DIR.exists():
        for md_file in sorted(TESTING_MDS_DIR.glob("*_base*.md")):
            # Filename: {hash}_base.md  or  {hash}_base (1).md
            file_hash = md_file.name.split("_base")[0]
            if file_hash in seen:
                continue
            seen.add(file_hash)
            # Check which processors are available for this hash
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
                    "page_count": None,
                }
            )
            if len(docs) >= limit:
                break

    # ── Fallback: scan files/global/ directly ─────────────────────────────────
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
                    "page_count": None,
                }
            )
            if len(docs) >= limit:
                break

    if not docs:
        raise RuntimeError(
            "No processed documents found. "
            f"Expected Testing-MDs/ at {TESTING_MDS_DIR} "
            f"or processed files under {FILES_GLOBAL_DIR}"
        )

    return docs


def call_extract_single(
    token: str,
    conversion_id: str,
    processor_used: str,
    entity: dict,
    model: dict,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """One entity + one model → POST /api/extract (current frontend pattern)."""
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
        "entities": [entity],
        "model_type": model["model_type"],
        "processor_used": processor_used,
        "max_tokens": 256,
        "temperature": 0.0,
    }
    if model.get("deployment"):
        payload["deployment"] = model["deployment"]
    if model.get("model_id"):
        payload["model_id"] = model["model_id"]

    t0 = time.perf_counter()
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=120)
        duration = time.perf_counter() - t0
        return {
            "status": resp.status_code,
            "duration_s": round(duration, 2),
            "success": resp.status_code == 200,
            "entity": entity["name"],
            "model": model["display"],
        }
    except Exception as e:
        return {
            "status": 0,
            "duration_s": round(time.perf_counter() - t0, 2),
            "success": False,
            "entity": entity["name"],
            "model": model["display"],
            "error": str(e)[:200],
        }


def call_extract_all_entities(
    token: str,
    conversion_id: str,
    processor_used: str,
    entities: List[dict],
    model: dict,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """ALL entities + one model → POST /api/extract (backend asyncio.gather handles parallelism)."""
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
        "entities": entities,
        "model_type": model["model_type"],
        "processor_used": processor_used,
        "max_tokens": 256,
        "temperature": 0.0,
    }
    if model.get("deployment"):
        payload["deployment"] = model["deployment"]
    if model.get("model_id"):
        payload["model_id"] = model["model_id"]

    t0 = time.perf_counter()
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=120)
        duration = time.perf_counter() - t0
        return {
            "status": resp.status_code,
            "duration_s": round(duration, 2),
            "success": resp.status_code == 200,
            "entity_count": len(entities),
            "model": model["display"],
        }
    except Exception as e:
        return {
            "status": 0,
            "duration_s": round(time.perf_counter() - t0, 2),
            "success": False,
            "entity_count": len(entities),
            "model": model["display"],
            "error": str(e)[:200],
        }


# ── Strategy runners ──────────────────────────────────────────────────────────


@dataclass
class DocResult:
    doc_id: str
    filename: str
    first_result_at: Optional[float] = None  # seconds from wall_start
    last_result_at: Optional[float] = None
    results: List[dict] = field(default_factory=list)

    def completion_time(self) -> Optional[float]:
        return self.last_result_at


async def run_strategy(
    strategy: str,
    docs: List[dict],
    entities: List[dict],
    models: List[dict],
    token: str,
    concurrency: int = SIM_BROWSER_CONNS,
) -> Tuple[float, Dict[str, DocResult], List[dict]]:
    """
    Run a strategy and return (wall_time, per_doc_results, all_call_results).
    """
    sem = asyncio.Semaphore(concurrency)
    doc_results: Dict[str, DocResult] = {
        d["id"]: DocResult(doc_id=d["id"], filename=d.get("filename", d["id"][:8]))
        for d in docs
    }
    all_calls: List[dict] = []
    wall_start = time.perf_counter()

    async def execute(fn, *args, doc_id: str, **kwargs):
        async with sem:
            result = await asyncio.to_thread(fn, *args, **kwargs)
            t = time.perf_counter() - wall_start
            dr = doc_results[doc_id]
            if dr.first_result_at is None:
                dr.first_result_at = t
            dr.last_result_at = t
            dr.results.append(result)
            all_calls.append(
                {**result, "doc_id": doc_id, "completed_at_s": round(t, 2)}
            )
            return result

    if strategy in ("baseline", "interleaved", f"semaphore_{concurrency}"):
        # Build job list — ordering determines queue priority in FIFO browser
        jobs = []  # (doc, entity, model)

        if strategy == "interleaved":
            # Round-robin: entity0-doc1, entity0-doc2, ..., entity1-doc1, entity1-doc2, ...
            max_e = max(len(entities), 1)
            for ei in range(max_e):
                for doc in docs:
                    for model in models:
                        if ei < len(entities):
                            jobs.append((doc, entities[ei], model))
        else:
            # FIFO: all entities for doc1, then all for doc2, ...
            for doc in docs:
                for entity in entities:
                    for model in models:
                        jobs.append((doc, entity, model))

        tasks = [
            execute(
                call_extract_single,
                token,
                doc["id"],
                doc.get("processor_used", "docling"),
                entity,
                model,
                doc_id=doc["id"],
            )
            for (doc, entity, model) in jobs
        ]
        await asyncio.gather(*tasks, return_exceptions=True)

    elif strategy == "all_entities":
        # One request per doc×model with ALL entities; backend asyncio.gather
        jobs = [(doc, model) for doc in docs for model in models]
        tasks = [
            execute(
                call_extract_all_entities,
                token,
                doc["id"],
                doc.get("processor_used", "docling"),
                entities,
                model,
                doc_id=doc["id"],
            )
            for (doc, model) in jobs
        ]
        await asyncio.gather(*tasks, return_exceptions=True)

    wall_time = time.perf_counter() - wall_start
    return wall_time, doc_results, all_calls


# ── Main ──────────────────────────────────────────────────────────────────────


def print_results(
    strategy: str,
    wall_time: float,
    doc_results: Dict[str, DocResult],
    all_calls: List[dict],
    total_jobs: int,
):
    ok = sum(1 for c in all_calls if c.get("success"))
    entities_per_s = ok / wall_time if wall_time > 0 else 0
    completion_times = sorted(
        [
            dr.completion_time()
            for dr in doc_results.values()
            if dr.completion_time() is not None
        ]
    )
    first_doc_done = completion_times[0] if completion_times else float("nan")
    last_doc_done = completion_times[-1] if completion_times else float("nan")
    delta = last_doc_done - first_doc_done if len(completion_times) >= 2 else 0.0

    print(f"\n  Strategy: {strategy.upper()}")
    print(f"  ─────────────────────────────────────────────")
    print(f"  Wall time          : {wall_time:.1f}s")
    print(f"  Successful calls   : {ok}/{total_jobs}")
    print(f"  Throughput         : {entities_per_s:.2f} entities/s")
    print(f"  First doc done     : {first_doc_done:.1f}s")
    print(f"  Last doc done      : {last_doc_done:.1f}s")
    print(
        f"  First→Last delta   : {delta:.1f}s  ({'even ✅' if delta < wall_time * 0.2 else 'uneven ⚠️'})"
    )
    print(f"  Per-doc completion :")
    for dr in sorted(doc_results.values(), key=lambda x: x.completion_time() or 999):
        t = dr.completion_time()
        bar = "█" * min(int((t / wall_time) * 30), 30) if t else "—"
        print(f"    [{bar:<30}] {t:.1f}s  {dr.filename[:40]}")


async def main(
    n_docs: int = 5,
    n_entities: int = 4,
    strategies: List[str] = None,
    extra_concurrencies: List[int] = None,
):
    if strategies is None:
        strategies = [
            "baseline",
            "interleaved",
            "all_entities",
            "semaphore_24",
            "semaphore_48",
        ]

    print(f"\n{'='*65}")
    print(f"  Concurrent Strategies Benchmark")
    print(
        f"  Docs: {n_docs} | Entities/doc: {n_entities} | Models: {len(DEFAULT_MODELS)}"
    )
    print(f"  Simulated browser connections: {SIM_BROWSER_CONNS}")
    print(
        f"  Total requests (single mode) : {n_docs} × {n_entities} × {len(DEFAULT_MODELS)} = {n_docs * n_entities * len(DEFAULT_MODELS)}"
    )
    print(
        f"  Total requests (batch mode)  : {n_docs} × {len(DEFAULT_MODELS)} = {n_docs * len(DEFAULT_MODELS)}"
    )
    print(f"{'='*65}")

    # ── Load config ───────────────────────────────────────────────────────────
    secrets = load_secrets()
    sb = secrets["supabase"]
    token = mint_user_jwt(sb["jwt_secret"])

    # ── Health check ──────────────────────────────────────────────────────────
    try:
        r = requests.get(
            f"{APP_BASE_URL}/api/models",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
        print(f"\n  Backend: reachable (HTTP {r.status_code})")
    except Exception as e:
        print(f"\n  ⚠️  Cannot reach backend at {APP_BASE_URL}: {e}")
        print(f"  Start with: cd backend && uvicorn main:app --port 8001 --reload")
        sys.exit(1)

    # ── Discover documents from filesystem (bypasses DB status issues) ────────
    all_docs = discover_documents_from_filesystem(limit=n_docs + 5)
    docs = all_docs[:n_docs]
    entities = TEST_ENTITIES[:n_entities]

    print(f"\n  Using {len(docs)} documents:")
    for i, d in enumerate(docs):
        print(
            f"    [{i+1}] {d.get('filename', d['id'][:12])} (pages={d.get('page_count','?')})"
        )

    print(f"\n  Entities: {[e['name'] for e in entities]}")
    print(f"  Models  : {[m['display'] for m in DEFAULT_MODELS]}")

    # ── Run strategies ────────────────────────────────────────────────────────
    all_results = {}
    total_single = len(docs) * len(entities) * len(DEFAULT_MODELS)
    total_batch = len(docs) * len(DEFAULT_MODELS)

    for strategy in strategies:
        print(f"\n{'─'*65}")
        print(f"  Running: {strategy} ...")

        # Determine concurrency
        if strategy.startswith("semaphore_"):
            try:
                conc = int(strategy.split("_")[1])
            except Exception:
                conc = 24
        elif strategy == "all_entities":
            conc = len(DEFAULT_MODELS) * len(docs)  # all batched requests fire together
        else:
            conc = SIM_BROWSER_CONNS  # simulate browser

        total_jobs = total_batch if strategy == "all_entities" else total_single

        wall, doc_res, calls = await run_strategy(
            strategy=strategy,
            docs=docs,
            entities=entities,
            models=DEFAULT_MODELS,
            token=token,
            concurrency=conc,
        )

        print_results(strategy, wall, doc_res, calls, total_jobs)
        all_results[strategy] = {
            "wall_time_s": round(wall, 2),
            "total_jobs": total_jobs,
            "ok": sum(1 for c in calls if c.get("success")),
            "entities_per_s": (
                round(sum(1 for c in calls if c.get("success")) / wall, 3)
                if wall > 0
                else 0
            ),
            "doc_completion_times_s": {
                dr.filename[:40]: round(dr.completion_time() or 0, 2)
                for dr in doc_res.values()
            },
        }

        # Cool-down between strategies
        if strategy != strategies[-1]:
            print(f"\n  Cooling down 5s before next strategy...")
            await asyncio.sleep(5)

    # ── Summary table ─────────────────────────────────────────────────────────
    print(f"\n\n{'='*65}")
    print(f"  SUMMARY")
    print(f"{'='*65}")
    print(f"  {'Strategy':<20} {'Wall(s)':>8} {'OK':>6} {'Ent/s':>8} {'Delta(s)':>10}")
    print(f"  {'─'*20} {'─'*8} {'─'*6} {'─'*8} {'─'*10}")

    for s, r in all_results.items():
        times = sorted(r["doc_completion_times_s"].values())
        delta = (times[-1] - times[0]) if len(times) >= 2 else 0
        print(
            f"  {s:<20} {r['wall_time_s']:>8.1f} {r['ok']:>6}/{r['total_jobs']:<4}"
            f" {r['entities_per_s']:>8.3f} {delta:>10.1f}"
        )

    print(f"\n  Delta = time between first doc completing and last doc completing.")
    print(f"  Low delta = even progress across documents. ✅")

    # ── Save ──────────────────────────────────────────────────────────────────
    output = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "n_docs": n_docs,
            "n_entities": n_entities,
            "n_models": len(DEFAULT_MODELS),
            "sim_browser_conns": SIM_BROWSER_CONNS,
            "app_url": APP_BASE_URL,
        },
        "results": all_results,
    }
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\n  Results saved to: {OUTPUT_FILE}")
    print(f"{'='*65}\n")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Benchmark concurrent dispatch strategies"
    )
    parser.add_argument(
        "--docs", type=int, default=5, help="Number of documents to use (default: 5)"
    )
    parser.add_argument(
        "--entities",
        type=int,
        default=4,
        help="Number of test entities per doc (default: 4)",
    )
    parser.add_argument(
        "--strategy",
        nargs="+",
        default=[
            "baseline",
            "interleaved",
            "all_entities",
            "semaphore_24",
            "semaphore_48",
        ],
        choices=[
            "baseline",
            "interleaved",
            "all_entities",
            "semaphore_6",
            "semaphore_12",
            "semaphore_24",
            "semaphore_48",
            "all",
        ],
        help="Strategies to run (default: all)",
    )
    args = parser.parse_args()

    strategies = args.strategy
    if "all" in strategies:
        strategies = [
            "baseline",
            "interleaved",
            "all_entities",
            "semaphore_6",
            "semaphore_24",
            "semaphore_48",
        ]

    asyncio.run(
        main(
            n_docs=args.docs,
            n_entities=args.entities,
            strategies=strategies,
        )
    )
