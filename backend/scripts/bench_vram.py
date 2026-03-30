#!/usr/bin/env python3
"""
bench_vram.py — VRAM profiling under increasing concurrency.

Loads the Docling model once (mimicking DoclingService behaviour), then
converts N documents simultaneously for N = 1, 2, 3, 4, 5, 6, 8.
Records VRAM allocated before, at peak, and after cleanup to understand
why VRAM grows with concurrency even though the model loads only once.

Usage:
    python backend/scripts/bench_vram.py
    python backend/scripts/bench_vram.py --pdf-dir /path/to/pdfs
    python backend/scripts/bench_vram.py --n-values 1 2 4 8
"""

import argparse
import gc
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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


# ── VRAM helpers ───────────────────────────────────────────────────────────────


def _has_cuda() -> bool:
    try:
        import torch

        return torch.cuda.is_available()
    except ImportError:
        return False


def _vram_allocated_mb() -> float:
    try:
        import torch

        return torch.cuda.memory_allocated() / 1024**2
    except Exception:
        return 0.0


def _vram_reserved_mb() -> float:
    try:
        import torch

        return torch.cuda.memory_reserved() / 1024**2
    except Exception:
        return 0.0


def _peak_vram_mb() -> float:
    try:
        import torch

        return torch.cuda.max_memory_allocated() / 1024**2
    except Exception:
        return 0.0


def _reset_vram() -> None:
    try:
        import torch

        gc.collect()
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()
    except Exception:
        pass


# ── Converter factory ──────────────────────────────────────────────────────────


def build_converter():
    """Build a DocumentConverter identical to DoclingService's default."""
    import multiprocessing

    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        AcceleratorDevice,
        AcceleratorOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.pipeline.standard_pdf_pipeline import ThreadedPdfPipelineOptions

    pipeline_options = ThreadedPdfPipelineOptions(
        accelerator_options=AcceleratorOptions(
            num_threads=multiprocessing.cpu_count(),
            device=AcceleratorDevice.AUTO,
        ),
        ocr_batch_size=4,
        layout_batch_size=8,
        table_batch_size=8,
    )
    pipeline_options.generate_page_images = False
    pipeline_options.generate_picture_images = True
    pipeline_options.do_ocr = False

    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
        }
    )


# ── Single-doc conversion (called from thread pool) ───────────────────────────


def convert_one(converter, pdf_path: Path) -> dict:
    """Convert a single PDF and return timing info."""
    t0 = time.perf_counter()
    try:
        result = converter.convert(str(pdf_path))
        elapsed = time.perf_counter() - t0
        pages = result.document.num_pages() if result.document else 0
        del result
        return {"ok": True, "elapsed": elapsed, "pages": pages, "file": pdf_path.name}
    except Exception as exc:
        elapsed = time.perf_counter() - t0
        return {
            "ok": False,
            "elapsed": elapsed,
            "pages": 0,
            "file": pdf_path.name,
            "error": str(exc)[:100],
        }


# ── Run one concurrency level ─────────────────────────────────────────────────


def run_n_concurrent(converter, pdfs: list, n: int) -> dict:
    """
    Process n PDFs concurrently with a single shared converter.
    Returns timing and VRAM statistics.
    """
    # Cycle through pdfs if n > len(pdfs)
    work_pdfs = [pdfs[i % len(pdfs)] for i in range(n)]

    before_alloc = _vram_allocated_mb()
    before_reserved = _vram_reserved_mb()
    _reset_vram()  # reset peak counter just before the test
    before_alloc = _vram_allocated_mb()  # re-read after reset

    t0 = time.perf_counter()
    file_results = []

    with ThreadPoolExecutor(max_workers=n) as ex:
        futures = {ex.submit(convert_one, converter, p): p for p in work_pdfs}
        for fut in as_completed(futures):
            file_results.append(fut.result())

    total_elapsed = time.perf_counter() - t0
    peak = _peak_vram_mb()

    gc.collect()
    try:
        import torch

        torch.cuda.empty_cache()
    except Exception:
        pass

    after_alloc = _vram_allocated_mb()

    elapsed_list = [r["elapsed"] for r in file_results]
    ok_count = sum(1 for r in file_results if r["ok"])

    return {
        "n": n,
        "before_alloc_mb": round(before_alloc, 1),
        "peak_mb": round(peak, 1),
        "after_cleanup_mb": round(after_alloc, 1),
        "total_sec": round(total_elapsed, 2),
        "avg_sec": (
            round(sum(elapsed_list) / len(elapsed_list), 2) if elapsed_list else 0
        ),
        "max_sec": round(max(elapsed_list), 2) if elapsed_list else 0,
        "docs_ok": ok_count,
        "docs_total": n,
        "files": [r["file"] for r in file_results],
        "errors": [r.get("error", "") for r in file_results if not r["ok"]],
    }


# ── Print table ────────────────────────────────────────────────────────────────


def print_table(rows: list) -> None:
    header = (
        f"{'N':>4}  {'before_mb':>9}  {'peak_mb':>8}  {'after_mb':>8}"
        f"  {'total_s':>7}  {'avg_s':>6}  {'max_s':>6}  {'ok/total':>8}"
    )
    print(f"\n{BOLD}{header}{RESET}")
    print("─" * len(header))
    for r in rows:
        print(
            f"{r['n']:>4}  {r['before_alloc_mb']:>9.1f}  {r['peak_mb']:>8.1f}"
            f"  {r['after_cleanup_mb']:>8.1f}  {r['total_sec']:>7.2f}"
            f"  {r['avg_sec']:>6.2f}  {r['max_sec']:>6.2f}"
            f"  {r['docs_ok']:>4}/{r['docs_total']:<3}"
        )


# ── Main ───────────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description="Docling VRAM scaling benchmark")
    parser.add_argument(
        "--pdf-dir",
        default=str(ROOT / "Testing_documents"),
        help="Directory containing PDFs to process",
    )
    parser.add_argument(
        "--n-values",
        nargs="+",
        type=int,
        default=[1, 2, 3],
        help=(
            "Concurrency levels to test (e.g. --n-values 1 2 3). "
            "WARNING: N>=4 has been observed to cause a C-level heap corruption "
            "crash (corrupted double-linked list / SIGABRT) in pdfium/PIL when "
            "multiple threads call the converter simultaneously. The default is "
            "capped at 3. Use --n-values 1 2 3 4 at your own risk."
        ),
    )
    parser.add_argument(
        "--no-large",
        action="store_true",
        help="Exclude large PDFs (>2 MB) to keep run times manageable",
    )
    args = parser.parse_args()

    pdf_dir = Path(args.pdf_dir)
    all_pdfs = sorted(pdf_dir.glob("*.pdf")) + sorted(pdf_dir.glob("*.PDF"))
    if args.no_large:
        all_pdfs = [p for p in all_pdfs if p.stat().st_size < 2 * 1024 * 1024]
    if not all_pdfs:
        print(f"[ERROR] No PDFs found in {pdf_dir}")
        sys.exit(1)

    # Use medium-sized PDFs for consistent comparisons (skip the 9 MB monster by default)
    # but cap at 8 so N=8 can always be satisfied by cycling
    pdfs = all_pdfs

    _section(f"bench_vram.py — concurrency levels: {args.n_values}")
    print(f"  PDF dir    : {pdf_dir}")
    print(f"  PDFs found : {len(all_pdfs)}")
    for p in all_pdfs:
        size_kb = p.stat().st_size // 1024
        print(f"    {p.name}  ({size_kb} KB)")

    if not _has_cuda():
        print(f"\n{YELLOW}[WARN] No CUDA detected — VRAM columns will show 0.0{RESET}")

    _section("Loading model (one-time warm-up)")
    print("  Building DocumentConverter …")
    t_load = time.perf_counter()
    converter = build_converter()
    load_sec = time.perf_counter() - t_load
    print(
        f"  Model loaded in {load_sec:.1f}s  (VRAM after load: {_vram_allocated_mb():.1f} MB)"
    )

    _section("Running concurrency levels")
    rows = []
    for n in args.n_values:
        label = f"N={n} ({n} docs concurrent)"
        print(f"\n{YELLOW}{label}{RESET}")
        _reset_vram()
        row = run_n_concurrent(converter, pdfs, n)
        rows.append(row)
        if row["errors"]:
            for e in row["errors"]:
                print(f"  {RED}[ERR]{RESET} {e}")
        print(
            f"  before={row['before_alloc_mb']:.1f}MB  "
            f"peak={row['peak_mb']:.1f}MB  "
            f"after={row['after_cleanup_mb']:.1f}MB  "
            f"total={row['total_sec']:.2f}s  "
            f"avg={row['avg_sec']:.2f}s  "
            f"max={row['max_sec']:.2f}s"
        )

    _section("Summary table")
    print_table(rows)

    # Analysis hints
    _section("Analysis hints")
    max_n_tested = max(r["n"] for r in rows) if rows else 0
    if max_n_tested >= 3:
        print(
            f"  {YELLOW}Thread-safety note:{RESET} N>=4 concurrent conversions have been"
            "\n  observed to cause a C-level heap corruption crash (SIGABRT:"
            "\n  'corrupted double-linked list') in pdfium or PIL. This means"
            "\n  Docling is NOT safe to call from 4+ threads concurrently."
            "\n  The backend's ThreadPoolExecutor(max_workers=4) combined with"
            "\n  5 frontend uploads may be triggering this in production."
        )
    if len(rows) >= 2:
        first_peak = rows[0]["peak_mb"]
        last_peak = rows[-1]["peak_mb"]
        growth = last_peak - first_peak
        if growth > 500:
            print(
                f"  {YELLOW}VRAM grew by {growth:.0f} MB from N=1 to N={rows[-1]['n']}.{RESET}"
                "\n  Possible causes: intermediate tensors not freed between"
                "\n  concurrent conversions, or Docling batching accumulating inputs."
            )
        else:
            print(
                f"  {GREEN}VRAM growth is small ({growth:.0f} MB) — model is shared well.{RESET}"
            )

    cleanup_diffs = [
        r["peak_mb"] - r["after_cleanup_mb"] for r in rows if r["peak_mb"] > 0
    ]
    if cleanup_diffs:
        avg_freed = sum(cleanup_diffs) / len(cleanup_diffs)
        print(
            f"  gc.collect() + empty_cache() frees ~{avg_freed:.0f} MB on average after each run."
        )


if __name__ == "__main__":
    main()
