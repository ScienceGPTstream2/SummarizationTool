#!/usr/bin/env python3
"""
bench_params.py — Parameter grid sweep for Docling batch processing speed.

Sweeps layout_batch_size × table_batch_size × max_workers combinations and
measures total wall-clock time to convert all PDFs in the test directory.
Runs Docling synchronously (no asyncio / HTTP) so results reflect pure
Docling throughput.

Usage:
    python backend/scripts/bench_params.py
    python backend/scripts/bench_params.py --pdf-dir /path/to/pdfs
    python backend/scripts/bench_params.py --quick   # smaller grid, faster
"""

import argparse
import csv
import gc
import sys
import time
from itertools import product
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


def _section(title: str) -> None:
    print(f"\n{BOLD}{CYAN}{'─' * 64}{RESET}")
    print(f"{BOLD}{CYAN}  {title}{RESET}")
    print(f"{BOLD}{CYAN}{'─' * 64}{RESET}")


# ── Parameter grids ────────────────────────────────────────────────────────────
FULL_GRID = {
    "layout_batch_size": [4, 8, 16, 32, 64],
    "table_batch_size": [4, 8, 16],
    "max_workers": [1, 2, 4, 8],
}

QUICK_GRID = {
    "layout_batch_size": [8, 16, 32],
    "table_batch_size": [4, 8],
    "max_workers": [2, 4],
}


def vram_mb() -> float:
    try:
        import torch

        return torch.cuda.memory_allocated() / 1024**2
    except Exception:
        return 0.0


def peak_vram_mb() -> float:
    try:
        import torch

        return torch.cuda.max_memory_allocated() / 1024**2
    except Exception:
        return 0.0


def reset_vram_stats() -> None:
    try:
        import torch

        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()
    except Exception:
        pass


def build_converter(layout_bs: int, table_bs: int, workers: int):
    """Create a fresh DocumentConverter with given parameters."""
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
            num_threads=workers,
            device=AcceleratorDevice.AUTO,
        ),
        ocr_batch_size=4,
        layout_batch_size=layout_bs,
        table_batch_size=table_bs,
    )
    pipeline_options.generate_page_images = False
    pipeline_options.generate_picture_images = False  # skip image extraction for speed
    pipeline_options.do_ocr = False

    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
        }
    )


def run_combo(pdfs: list, layout_bs: int, table_bs: int, workers: int) -> dict:
    """Build converter, convert all PDFs, return timing + VRAM stats.

    Processes each PDF individually so a single corrupt/invalid file doesn't
    abort the entire combo run.
    """
    gc.collect()
    reset_vram_stats()

    converter = build_converter(layout_bs, table_bs, workers)

    docs_ok = 0
    docs_fail = 0
    t0 = time.perf_counter()
    for pdf in pdfs:
        try:
            # convert() returns a ConversionResult; failed files raise or set status
            result = converter.convert(str(pdf))
            docs_ok += 1
            del result
        except Exception:
            docs_fail += 1
    total_sec = time.perf_counter() - t0
    peak = peak_vram_mb()

    # Cleanup before next run
    del converter
    gc.collect()
    reset_vram_stats()

    note = f"{docs_fail} files skipped" if docs_fail else ""
    return {
        "layout_bs": layout_bs,
        "table_bs": table_bs,
        "workers": workers,
        "total_sec": round(total_sec, 2),
        "peak_vram_mb": round(peak, 1),
        "docs_ok": docs_ok,
        "error": note,
    }


def print_table(rows: list) -> None:
    header = f"{'layout_bs':>10}  {'table_bs':>8}  {'workers':>7}  {'total_sec':>9}  {'peak_vram_mb':>12}  {'docs':>4}  note"
    print(f"\n{BOLD}{header}{RESET}")
    print("─" * len(header))
    for r in rows:
        total = (
            f"{r['total_sec']:>9.2f}" if r["total_sec"] is not None else "     ERROR"
        )
        peak = (
            f"{r['peak_vram_mb']:>12.1f}"
            if r["peak_vram_mb"] is not None
            else "       N/A"
        )
        note = r.get("error", "") or ""
        print(
            f"{r['layout_bs']:>10}  {r['table_bs']:>8}  {r['workers']:>7}  {total}  {peak}  {r['docs_ok']:>4}  {note}"
        )


def save_csv(rows: list, out_path: Path) -> None:
    fields = [
        "layout_bs",
        "table_bs",
        "workers",
        "total_sec",
        "peak_vram_mb",
        "docs_ok",
        "error",
    ]
    with open(out_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    print(f"\n{GREEN}Results saved to {out_path}{RESET}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Docling parameter grid sweep")
    parser.add_argument(
        "--pdf-dir",
        default=str(ROOT / "Testing_documents"),
        help="Directory containing PDFs to process",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Use smaller parameter grid for a faster run",
    )
    parser.add_argument(
        "--out",
        default=str(ROOT / "backend" / "scripts" / "bench_params_results.csv"),
        help="Output CSV path",
    )
    args = parser.parse_args()

    pdf_dir = Path(args.pdf_dir)
    pdfs = sorted(pdf_dir.glob("*.pdf")) + sorted(pdf_dir.glob("*.PDF"))
    if not pdfs:
        print(f"[ERROR] No PDFs found in {pdf_dir}")
        sys.exit(1)

    grid = QUICK_GRID if args.quick else FULL_GRID
    combos = list(
        product(
            grid["layout_batch_size"],
            grid["table_batch_size"],
            grid["max_workers"],
        )
    )

    _section(f"bench_params.py — {len(combos)} combos × {len(pdfs)} PDFs")
    print(f"  PDF dir : {pdf_dir}")
    print(f"  PDFs    : {len(pdfs)}")
    print(f"  Grid    : {'quick' if args.quick else 'full'}")
    for p in pdfs:
        size_kb = p.stat().st_size // 1024
        print(f"    {p.name}  ({size_kb} KB)")

    rows: list[dict] = []
    for i, (lbs, tbs, wk) in enumerate(combos, 1):
        label = f"[{i}/{len(combos)}] layout={lbs} table={tbs} workers={wk}"
        print(f"\n{YELLOW}{label}{RESET}")
        row = run_combo(pdfs, lbs, tbs, wk)
        rows.append(row)
        if row["total_sec"] is not None:
            print(f"  → {row['total_sec']:.2f}s  peak_vram={row['peak_vram_mb']:.1f}MB")
        else:
            print(f"  → ERROR: {row['error']}")

    # Sort by total_sec ascending (errors at end)
    rows.sort(key=lambda r: r["total_sec"] if r["total_sec"] is not None else 1e9)

    _section("Results (sorted by speed)")
    print_table(rows)
    save_csv(rows, Path(args.out))

    # Print top 3
    ok_rows = [r for r in rows if r["total_sec"] is not None]
    if ok_rows:
        _section("Top 3 fastest combos")
        print_table(ok_rows[:3])


if __name__ == "__main__":
    main()
