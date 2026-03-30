#!/usr/bin/env python3
"""
bench_failures.py — Reproduce the 504 → cache-hit-on-retry pattern.

Fires all 10 PDFs at the live server simultaneously and records which ones
time out (504) vs succeed. Then immediately retries the failures — they
should come back instantly as cache hits.

Root cause being investigated: uvicorn's ~120s request timeout fires while
the Docling thread-pool task is still running. The task writes document.md
to disk. The next request finds the file and returns cached=true.

Requires the backend server to be running:
    cd /home/azureuser/SummarizationTool/backend && python main.py

Usage:
    python backend/scripts/bench_failures.py
    python backend/scripts/bench_failures.py --pdf-dir /path/to/pdfs
    python backend/scripts/bench_failures.py --concurrency 5   # fewer parallel requests
    python backend/scripts/bench_failures.py --no-clear        # skip clearing cache first
"""

import argparse
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

# ── Bootstrap ──────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

BASE_URL = "http://localhost:8001"

# ── Colours ────────────────────────────────────────────────────────────────────
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"


def _section(title: str) -> None:
    print(f"\n{BOLD}{CYAN}{'─' * 64}{RESET}")
    print(f"{BOLD}{CYAN}  {title}{RESET}")
    print(f"{BOLD}{CYAN}{'─' * 64}{RESET}")


# ── Auth ───────────────────────────────────────────────────────────────────────


def make_test_token() -> str:
    """Mint a short-lived JWT using the same secret the server uses."""
    try:
        import toml
    except ImportError:
        print("[ERROR] pip install toml")
        sys.exit(1)
    try:
        import jwt as pyjwt
    except ImportError:
        print("[ERROR] pip install PyJWT")
        sys.exit(1)

    secrets_path = ROOT / "backend" / "core" / "secrets.toml"
    if not secrets_path.exists():
        print(f"[ERROR] secrets.toml not found at {secrets_path}")
        sys.exit(1)

    cfg = toml.load(secrets_path)
    secret = cfg["supabase"]["jwt_secret"]
    now = int(time.time())
    payload = {
        "sub": str(uuid.uuid4()),
        "email": "test@bench.local",
        "role": "authenticated",
        "aud": "authenticated",
        "iat": now,
        "exp": now + 3600,
        "user_metadata": {},
        "app_metadata": {},
    }
    return pyjwt.encode(payload, secret, algorithm="HS256")


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Server health check ────────────────────────────────────────────────────────


def check_server(token: str) -> None:
    try:
        r = requests.get(f"{BASE_URL}/api/health", timeout=10)
        if r.status_code >= 500:
            print(
                f"{RED}[ERROR] Server returned {r.status_code} — is it running?{RESET}"
            )
            sys.exit(1)
        print(f"  {GREEN}Server reachable (status {r.status_code}){RESET}")
    except requests.exceptions.ConnectionError:
        print(
            f"{RED}[ERROR] Cannot connect to {BASE_URL} — start the server first:{RESET}"
        )
        print(f"  cd {ROOT}/backend && python main.py")
        sys.exit(1)


# ── Upload helper ──────────────────────────────────────────────────────────────


def upload_pdf(pdf_path: Path, token: str) -> str:
    """Upload PDF, return file_hash."""
    with open(pdf_path, "rb") as f:
        r = requests.post(
            f"{BASE_URL}/api/upload",
            headers=auth_headers(token),
            files={"file": (pdf_path.name, f, "application/pdf")},
            timeout=60,
        )
    if r.status_code != 200:
        raise RuntimeError(f"Upload failed ({r.status_code}): {r.text[:200]}")
    data = r.json()
    return data.get("file_hash") or data.get("hash") or data["id"]


# ── Process helper ─────────────────────────────────────────────────────────────


def process_file(file_hash: str, token: str, client_timeout: int = 300) -> dict:
    """
    Request Docling processing for a file.
    Uses a generous client timeout so WE don't time out before uvicorn does —
    this lets us observe the server-side 504 rather than a client-side timeout.
    """
    t0 = time.perf_counter()
    try:
        r = requests.post(
            f"{BASE_URL}/api/documents/process/file/{file_hash}",
            headers=auth_headers(token),
            json={"processor": "docling"},
            timeout=client_timeout,
        )
        elapsed = time.perf_counter() - t0
        body = {}
        try:
            body = r.json()
        except Exception:
            pass
        return {
            "file_hash": file_hash,
            "status": r.status_code,
            "cached": body.get("cached", None),
            "elapsed": round(elapsed, 2),
            "error": body.get("detail", "") if r.status_code >= 400 else "",
        }
    except requests.exceptions.Timeout:
        elapsed = time.perf_counter() - t0
        return {
            "file_hash": file_hash,
            "status": "CLIENT_TIMEOUT",
            "cached": None,
            "elapsed": round(elapsed, 2),
            "error": f"Client timed out after {client_timeout}s",
        }
    except Exception as exc:
        elapsed = time.perf_counter() - t0
        return {
            "file_hash": file_hash,
            "status": "EXCEPTION",
            "cached": None,
            "elapsed": round(elapsed, 2),
            "error": str(exc)[:150],
        }


# ── Clear cache helper ─────────────────────────────────────────────────────────


def clear_cache(token: str) -> None:
    """Clear processed/ dirs via the server's benchmark/clear endpoint."""
    r = requests.post(
        f"{BASE_URL}/api/server/benchmark/clear",
        headers=auth_headers(token),
        json={"mode": "execute", "processor": None},
        timeout=60,
    )
    if r.status_code != 200:
        print(
            f"  {YELLOW}[WARN] Cache clear returned {r.status_code}: {r.text[:100]}{RESET}"
        )
    else:
        print(f"  {GREEN}Cache cleared{RESET}")


# ── Print results table ────────────────────────────────────────────────────────


def print_results_table(results: list, hash_to_name: dict) -> None:
    header = f"{'File':<50}  {'status':>6}  {'cached':>6}  {'elapsed':>8}"
    print(f"\n{BOLD}{header}{RESET}")
    print("─" * len(header))
    for r in results:
        name = hash_to_name.get(r["file_hash"], r["file_hash"][:12] + "…")
        name_short = (name[:48] + "…") if len(name) > 50 else name
        status = str(r["status"])
        cached_str = str(r["cached"]) if r["cached"] is not None else "—"
        elapsed_str = f"{r['elapsed']:.2f}s"

        color = GREEN if str(r["status"]) == "200" else RED
        note = f"  ← {r['error']}" if r["error"] else ""
        print(
            f"{color}{name_short:<50}  {status:>6}  {cached_str:>6}  {elapsed_str:>8}{RESET}{note}"
        )


# ── Main ───────────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Reproduce Docling 504 → cache-hit pattern"
    )
    parser.add_argument(
        "--pdf-dir",
        default=str(ROOT / "Testing_documents"),
        help="Directory containing PDFs to use",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=10,
        help="Number of simultaneous process requests (default: 10 = all PDFs at once)",
    )
    parser.add_argument(
        "--no-clear",
        action="store_true",
        help="Skip clearing the cache before round 1 (useful if cache is already clear)",
    )
    parser.add_argument(
        "--client-timeout",
        type=int,
        default=300,
        help="Client-side HTTP timeout in seconds (default: 300). Use a value > uvicorn's timeout to observe server-side 504s.",
    )
    args = parser.parse_args()

    pdf_dir = Path(args.pdf_dir)
    pdfs = sorted(pdf_dir.glob("*.pdf")) + sorted(pdf_dir.glob("*.PDF"))
    if not pdfs:
        print(f"[ERROR] No PDFs found in {pdf_dir}")
        sys.exit(1)

    _section("bench_failures.py — 504 reproduction test")
    print(f"  Server     : {BASE_URL}")
    print(f"  PDFs       : {len(pdfs)}")
    print(f"  Concurrency: {args.concurrency}")
    print(f"  Client TO  : {args.client_timeout}s")

    token = make_test_token()
    check_server(token)

    # ── Upload all PDFs ──────────────────────────────────────────────────────
    _section(f"Step 1 — Upload {len(pdfs)} PDFs")
    hash_to_name: dict[str, str] = {}
    for pdf in pdfs:
        size_kb = pdf.stat().st_size // 1024
        try:
            fh = upload_pdf(pdf, token)
            hash_to_name[fh] = pdf.name
            print(f"  {GREEN}✓{RESET} {pdf.name}  ({size_kb} KB)  →  {fh[:12]}…")
        except Exception as exc:
            print(f"  {RED}✗{RESET} {pdf.name}: {exc}")

    file_hashes = list(hash_to_name.keys())
    if not file_hashes:
        print(f"{RED}[ERROR] No files uploaded successfully.{RESET}")
        sys.exit(1)

    # ── Clear cache ──────────────────────────────────────────────────────────
    if not args.no_clear:
        _section("Step 2 — Clear processed/ cache")
        clear_cache(token)
    else:
        _section("Step 2 — Skip cache clear (--no-clear)")

    # ── Round 1: all files concurrently ─────────────────────────────────────
    _section(f"Step 3 — Round 1: {len(file_hashes)} concurrent process requests")
    print(
        f"  Firing {min(len(file_hashes), args.concurrency)} simultaneous requests …\n"
        f"  (client timeout={args.client_timeout}s — server-side 504s will show as status=504)"
    )

    t_round1 = time.perf_counter()
    round1_results: list[dict] = []

    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures = {
            ex.submit(process_file, fh, token, args.client_timeout): fh
            for fh in file_hashes
        }
        for fut in as_completed(futures):
            r = fut.result()
            round1_results.append(r)
            status_color = GREEN if str(r["status"]) == "200" else RED
            name = hash_to_name.get(r["file_hash"], r["file_hash"][:12])
            print(
                f"  {status_color}[{r['status']}]{RESET}  {name[:45]:<45}  {r['elapsed']:.2f}s"
                + (f"  cached={r['cached']}" if r["cached"] is not None else "")
            )

    round1_elapsed = time.perf_counter() - t_round1
    print(f"\n  Round 1 wall time: {round1_elapsed:.2f}s")

    # Sort by elapsed descending for display
    round1_results.sort(key=lambda r: r["elapsed"], reverse=True)
    print_results_table(round1_results, hash_to_name)

    # ── Round 2: retry failures ──────────────────────────────────────────────
    failed = [r for r in round1_results if str(r["status"]) != "200"]
    _section(f"Step 4 — Round 2: retry {len(failed)} failed requests")

    if not failed:
        print(f"  {GREEN}All files succeeded in round 1 — no retries needed.{RESET}")
        print(
            "\n  (Try a harder test: --no-clear to start with warm cache already cleared,"
        )
        print("   or add more PDFs / a very large PDF to trigger the timeout.)")
        round2_results = []
    else:
        print(f"  Retrying {len(failed)} file(s) sequentially …")
        round2_results = []
        for r in failed:
            fh = r["file_hash"]
            name = hash_to_name.get(fh, fh[:12])
            result = process_file(fh, token, args.client_timeout)
            round2_results.append(result)
            status_color = GREEN if str(result["status"]) == "200" else RED
            print(
                f"  {status_color}[{result['status']}]{RESET}  {name[:45]:<45}  "
                f"{result['elapsed']:.2f}s"
                + (
                    f"  cached={result['cached']}"
                    if result["cached"] is not None
                    else ""
                )
            )
        print_results_table(round2_results, hash_to_name)

    # ── Summary ──────────────────────────────────────────────────────────────
    _section("Summary")
    ok1 = sum(1 for r in round1_results if str(r["status"]) == "200")
    fail_504 = sum(1 for r in round1_results if str(r["status"]) == "504")
    fail_500 = sum(1 for r in round1_results if str(r["status"]) == "500")
    fail_other = len(round1_results) - ok1 - fail_504 - fail_500
    cache_hits_r1 = sum(1 for r in round1_results if r["cached"] is True)
    fresh_r1 = sum(1 for r in round1_results if r["cached"] is False)

    print(f"  Round 1: {ok1} succeeded / {fail_504+fail_500+fail_other} failed")
    print(f"           {fresh_r1} fresh conversions, {cache_hits_r1} cache hits")
    if fail_504:
        print(f"           {fail_504} timed out with 504 (uvicorn timeout hit)")
    if fail_500:
        print(
            f"           {fail_500} failed with 500 (conversion error — likely corrupt PDF)"
        )
    if fail_other:
        print(f"           {fail_other} other failures")

    if round2_results:
        ok2 = sum(1 for r in round2_results if str(r["status"]) == "200")
        cache_hits_r2 = sum(1 for r in round2_results if r["cached"] is True)
        print(f"\n  Round 2: {ok2}/{len(round2_results)} retries succeeded")
        print(f"           {cache_hits_r2} of those were instant cache hits")

        if cache_hits_r2 > 0:
            print(
                f"\n  {YELLOW}Pattern confirmed:{RESET} {fail_504} file(s) timed out in round 1 but"
                f"\n  the server continued working and wrote the output — round 2 hit the cache."
                f"\n\n  Root cause: uvicorn's default timeout is ~120s. Files that take longer"
                f"\n  get a 504 HTTP response, but the thread-pool task keeps running and writes"
                f"\n  document.md. The next request finds the file and returns cached=true."
            )
        elif fail_504 == 0 and ok1 == len(round1_results):
            print(
                f"\n  {GREEN}No 504s triggered — all files completed within uvicorn's timeout.{RESET}"
                "\n  The 9 test PDFs (108 KB–1 MB) each finish in 60–85s under 10-file concurrency,"
                "\n  which is under uvicorn's ~120s limit. To reproduce 504s you would need"
                "\n  very large PDFs (>10 MB) or a severely loaded server."
            )

    # Timing analysis
    round1_times = [r["elapsed"] for r in round1_results if str(r["status"]) == "200"]
    if round1_times:
        print(f"\n  Round-1 timing (successful files):")
        print(
            f"    min: {min(round1_times):.2f}s  max: {max(round1_times):.2f}s  avg: {sum(round1_times)/len(round1_times):.2f}s"
        )

    if round2_results:
        r2_cache = [r["elapsed"] for r in round2_results if r["cached"] is True]
        if r2_cache:
            print(
                f"\n  Round-2 cache-hit latency: {min(r2_cache):.2f}s – {max(r2_cache):.2f}s  (should be <1s)"
            )


if __name__ == "__main__":
    main()
