#!/usr/bin/env python3
"""
bench_vram_workers.py — VRAM vs worker-count vs batch-size sweep (ProcessPool architecture).

Tests the coworker's ProcessPoolExecutor approach across a grid of:
  - vram_per_worker_gb: assumed VRAM per worker → drives n_workers = floor(total_vram / assumed)
  - layout_batch_size:  pages per GPU forward pass inside each worker

For each combo: submits ALL PDFs simultaneously (max concurrency stress test),
polls nvidia-smi for total GPU VRAM, records wall time and errors.

This answers: "Is 2 GB/worker safe given observed 3.5 GB actual usage?"

Usage:
    python backend/scripts/bench_vram_workers.py
    python backend/scripts/bench_vram_workers.py --pdf-dir /path/to/pdfs
    python backend/scripts/bench_vram_workers.py --quick   # 6 combos instead of 12
"""

import argparse
import asyncio
import csv
import gc
import logging
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from itertools import product
from multiprocessing import get_context
from pathlib import Path

# ── Bootstrap ──────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

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


# ── Parameter grids ─────────────────────────────────────────────────────────────

FULL_GRID = {
    "vram_per_worker_gb": [2.0, 2.5, 3.0, 3.5],
    "layout_batch_size": [8, 16, 32],
}

QUICK_GRID = {
    "vram_per_worker_gb": [2.0, 3.0, 3.5],
    "layout_batch_size": [8, 32],
}

TABLE_BATCH_SIZE = 4  # Fixed — highly VRAM intensive, keep conservative


# ── nvidia-smi VRAM poller ──────────────────────────────────────────────────────


class VramPoller:
    """Polls nvidia-smi in a background thread to capture peak total GPU VRAM."""

    def __init__(self, interval: float = 0.5):
        self.interval = interval
        self.peak_mb: float = 0.0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self.peak_mb = 0.0
        self._stop.clear()
        self._thread = threading.Thread(target=self._poll, daemon=True)
        self._thread.start()

    def stop(self) -> float:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
        return self.peak_mb

    def _poll(self) -> None:
        while not self._stop.is_set():
            try:
                out = subprocess.check_output(
                    [
                        "nvidia-smi",
                        "--query-gpu=memory.used",
                        "--format=csv,noheader,nounits",
                    ],
                    stderr=subprocess.DEVNULL,
                    timeout=2,
                )
                mb = float(out.decode().strip().split("\n")[0])
                if mb > self.peak_mb:
                    self.peak_mb = mb
            except Exception:
                pass
            self._stop.wait(self.interval)


def _nvidia_smi_available() -> bool:
    try:
        subprocess.check_output(["nvidia-smi", "--version"], stderr=subprocess.DEVNULL)
        return True
    except Exception:
        return False


def _total_vram_gb() -> float:
    try:
        import torch

        if torch.cuda.is_available():
            return torch.cuda.get_device_properties(0).total_memory / (1024**3)
    except ImportError:
        pass
    return 0.0


def _check_vram_clear(force: bool = False) -> None:
    """
    Abort early if other processes already occupy significant VRAM.

    The benchmark spawns fresh worker processes that each need to load the
    Docling models (~1-3 GB each). If the backend server is already running
    it will have pre-loaded 6-7 workers worth of models, leaving no free VRAM.
    """
    try:
        out = (
            subprocess.check_output(
                [
                    "nvidia-smi",
                    "--query-compute-apps=pid,process_name,used_gpu_memory",
                    "--format=csv,noheader",
                ],
                stderr=subprocess.DEVNULL,
                timeout=5,
            )
            .decode()
            .strip()
        )
    except Exception:
        return  # can't check, proceed anyway

    if not out:
        print(f"  {GREEN}GPU is clear — no other processes using VRAM{RESET}")
        return

    own_pid = str(sys.argv[0])  # not exact but not needed
    rows = [r.strip() for r in out.splitlines() if r.strip()]
    total_mb = 0.0
    lines = []
    for row in rows:
        parts = [p.strip() for p in row.split(",")]
        if len(parts) < 3:
            continue
        pid, name, mem = parts[0], parts[1], parts[2]
        try:
            mb = float(mem.replace("MiB", "").replace("MB", "").strip())
        except ValueError:
            continue
        total_mb += mb
        lines.append(f"    PID {pid:>7}  {mb:>6.0f} MiB  {name}")

    if total_mb < 500:
        print(
            f"  {GREEN}GPU is clear ({total_mb:.0f} MiB used by other processes){RESET}"
        )
        return

    print(f"\n{RED}{BOLD}{'─' * 64}{RESET}")
    print(f"{RED}{BOLD}  ⚠  VRAM CONTENTION DETECTED — benchmark will OOM{RESET}")
    print(f"{RED}{BOLD}{'─' * 64}{RESET}")
    print(f"  Other processes are already using {total_mb:.0f} MiB of GPU VRAM:")
    for line in lines:
        print(f"{RED}{line}{RESET}")
    print()
    print(f"  The benchmark needs free VRAM to load Docling workers.")
    print(f"  Stop the backend server first:")
    print(f"    {BOLD}pkill -f 'uvicorn backend'{RESET}")
    print(f"  Then re-run this script.")
    print(f"  Pass {BOLD}--force{RESET} to run anyway (expect OOM errors).")
    print()

    if not force:
        sys.exit(1)


# ── Worker function (top-level so ProcessPoolExecutor can pickle it) ─────────────


def _bench_worker_process(task_args: dict) -> dict:
    """
    Subprocess worker: creates a fresh converter with the given batch sizes,
    converts one PDF, returns timing + basic metadata.
    Does NOT extract figures — benchmark focuses on VRAM/time, not output quality.
    """
    import logging as _logging
    import time as _time
    from pathlib import Path as _Path

    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        AcceleratorDevice,
        AcceleratorOptions,
        ThreadedPdfPipelineOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.pipeline.threaded_standard_pdf_pipeline import (
        ThreadedStandardPdfPipeline,
    )

    source = task_args["source"]
    layout_bs = task_args["layout_batch_size"]
    table_bs = task_args["table_batch_size"]

    # Silence noisy loggers in worker
    _logging.getLogger("docling").setLevel(_logging.ERROR)
    _logging.getLogger("PIL").setLevel(_logging.ERROR)
    _logging.getLogger("transformers").setLevel(_logging.ERROR)

    try:
        opts = ThreadedPdfPipelineOptions(
            accelerator_options=AcceleratorOptions(
                num_threads=1,
                device=AcceleratorDevice.AUTO,
            ),
            ocr_batch_size=8,
            layout_batch_size=layout_bs,
            table_batch_size=table_bs,
        )
        opts.generate_page_images = False
        opts.generate_picture_images = False  # skip image extraction for speed
        opts.do_ocr = False

        converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(
                    pipeline_cls=ThreadedStandardPdfPipeline,
                    pipeline_options=opts,
                )
            }
        )

        t0 = _time.perf_counter()
        result = converter.convert(source)
        duration = _time.perf_counter() - t0

        page_count = 0
        try:
            page_count = result.document.num_pages()
        except Exception:
            pass

        return {
            "success": True,
            "source": source,
            "duration_s": round(duration, 3),
            "page_count": page_count,
        }

    except Exception as exc:
        return {
            "success": False,
            "source": source,
            "error": str(exc),
            "duration_s": 0.0,
            "page_count": 0,
        }


# ── Core benchmark ───────────────────────────────────────────────────────────────


async def run_combo(
    pdfs: list[Path],
    vram_per_worker_gb: float,
    layout_bs: int,
    total_vram_gb: float,
    use_poller: bool,
) -> dict:
    """Run one grid combination: spawn pool, submit all PDFs at once, measure."""
    n_workers = max(1, int(total_vram_gb / vram_per_worker_gb))

    print(
        f"  {BOLD}vram_per_worker={vram_per_worker_gb}GB{RESET}  "
        f"{BOLD}layout_bs={layout_bs}{RESET}  "
        f"→ {n_workers} workers × {len(pdfs)} docs (all concurrent)"
    )

    pool = ProcessPoolExecutor(
        max_workers=n_workers,
        mp_context=get_context("spawn"),
    )

    poller = VramPoller(interval=0.5)
    if use_poller:
        poller.start()

    loop = asyncio.get_event_loop()
    task_args_list = [
        {
            "source": str(pdf),
            "layout_batch_size": layout_bs,
            "table_batch_size": TABLE_BATCH_SIZE,
        }
        for pdf in pdfs
    ]

    t0 = time.perf_counter()
    futures = [
        loop.run_in_executor(pool, _bench_worker_process, args)
        for args in task_args_list
    ]
    results = await asyncio.gather(*futures, return_exceptions=True)
    wall_time = time.perf_counter() - t0

    peak_mb = poller.stop() if use_poller else 0.0

    # Shutdown pool — this terminates worker processes and frees their VRAM
    pool.shutdown(wait=True)

    # Brief pause to let VRAM actually free before next combo
    await asyncio.sleep(3)
    gc.collect()

    docs_ok = sum(1 for r in results if isinstance(r, dict) and r.get("success"))
    docs_err = len(results) - docs_ok
    errors = [
        r.get("error", str(r))
        for r in results
        if isinstance(r, dict) and not r.get("success")
    ] + [str(r) for r in results if isinstance(r, Exception)]

    return {
        "vram_per_worker_gb": vram_per_worker_gb,
        "layout_batch_size": layout_bs,
        "n_workers": n_workers,
        "n_docs": len(pdfs),
        "peak_vram_mb": round(peak_mb, 1),
        "wall_time_s": round(wall_time, 2),
        "docs_ok": docs_ok,
        "docs_err": docs_err,
        "errors": "; ".join(errors[:3]) if errors else "",
    }


# ── Main ─────────────────────────────────────────────────────────────────────────


async def main() -> None:
    parser = argparse.ArgumentParser(description="VRAM vs workers vs batch size sweep")
    parser.add_argument(
        "--pdf-dir",
        default=str(ROOT / "Testing_documents"),
        help="Directory of PDFs to use (default: Testing_documents/)",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Smaller grid (6 combos instead of 12)",
    )
    parser.add_argument(
        "--out-csv",
        default=str(ROOT / "backend/scripts/bench_vram_workers_results.csv"),
        help="Output CSV path",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Skip VRAM contention check and run even if backend is loaded",
    )
    parser.add_argument(
        "--kill-backend",
        action="store_true",
        help="Kill running uvicorn backend before benchmarking (frees VRAM)",
    )
    args = parser.parse_args()

    if args.kill_backend:
        print(f"{YELLOW}Stopping backend server...{RESET}")
        result = subprocess.run(
            ["pkill", "-f", "uvicorn backend"],
            capture_output=True,
        )
        if result.returncode == 0:
            print(f"{GREEN}Backend stopped. Waiting 5s for VRAM to free...{RESET}")
            time.sleep(5)
        else:
            print(
                f"{YELLOW}No uvicorn backend process found (may already be stopped){RESET}"
            )

    pdf_dir = Path(args.pdf_dir)
    pdfs = sorted(pdf_dir.glob("*.pdf")) + sorted(pdf_dir.glob("*.PDF"))
    if not pdfs:
        print(f"{RED}No PDFs found in {pdf_dir}{RESET}")
        sys.exit(1)

    grid = QUICK_GRID if args.quick else FULL_GRID
    combos = list(product(grid["vram_per_worker_gb"], grid["layout_batch_size"]))

    total_vram = _total_vram_gb()
    smi_ok = _nvidia_smi_available()

    _section(f"bench_vram_workers — {'QUICK' if args.quick else 'FULL'} grid")
    _check_vram_clear(force=args.force)
    print(f"  PDFs:        {len(pdfs)} files from {pdf_dir.name}/")
    print(f"  GPU VRAM:    {total_vram:.1f} GB")
    print(
        f"  nvidia-smi:  {'✓ available' if smi_ok else '✗ not found — peak_vram_mb will be 0'}"
    )
    print(f"  Combos:      {len(combos)}")
    print(f"  table_bs:    {TABLE_BATCH_SIZE} (fixed)")

    all_results = []
    for i, (vram_gb, layout_bs) in enumerate(combos, 1):
        n_workers = max(1, int(total_vram / vram_gb))
        _section(
            f"Combo {i}/{len(combos)}: vram_per_worker={vram_gb}GB layout_bs={layout_bs} → {n_workers} workers"
        )
        result = await run_combo(
            pdfs=pdfs,
            vram_per_worker_gb=vram_gb,
            layout_bs=layout_bs,
            total_vram_gb=total_vram,
            use_poller=smi_ok,
        )
        all_results.append(result)

        # Print per-combo result immediately
        colour = (
            GREEN
            if result["docs_err"] == 0
            else (YELLOW if result["docs_ok"] > 0 else RED)
        )
        status = (
            "✓ all ok" if result["docs_err"] == 0 else f"⚠ {result['docs_err']} errors"
        )
        print(
            f"  {colour}→ peak {result['peak_vram_mb']:.0f} MB  |  "
            f"{result['wall_time_s']:.1f}s total  |  {status}{RESET}"
        )
        if result["errors"]:
            print(f"  {RED}  errors: {result['errors'][:120]}{RESET}")

    # ── Summary table ──────────────────────────────────────────────────────────
    _section("Results (sorted by wall time)")
    sorted_results = sorted(all_results, key=lambda r: r["wall_time_s"])
    header = f"{'vram_gb':>8}  {'layout_bs':>9}  {'workers':>7}  {'peak_MB':>8}  {'wall_s':>7}  {'ok':>4}  {'err':>4}"
    print(f"  {BOLD}{header}{RESET}")
    for r in sorted_results:
        colour = GREEN if r["docs_err"] == 0 else (YELLOW if r["docs_ok"] > 0 else RED)
        row = (
            f"  {r['vram_per_worker_gb']:>8}  {r['layout_batch_size']:>9}  "
            f"{r['n_workers']:>7}  {r['peak_vram_mb']:>8.0f}  "
            f"{r['wall_time_s']:>7.1f}  {r['docs_ok']:>4}  {r['docs_err']:>4}"
        )
        print(f"{colour}{row}{RESET}")

    # ── CSV output ─────────────────────────────────────────────────────────────
    out_path = Path(args.out_csv)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "vram_per_worker_gb",
        "layout_batch_size",
        "n_workers",
        "n_docs",
        "peak_vram_mb",
        "wall_time_s",
        "docs_ok",
        "docs_err",
        "errors",
    ]
    with out_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(sorted_results)

    print(f"\n{GREEN}CSV saved → {out_path}{RESET}")


if __name__ == "__main__":
    asyncio.run(main())
