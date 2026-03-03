"""
Benchmark: Can we speed up Docling by using MORE VRAM (~15GB) with multiple instances?

Tests:
1. Single ThreadedStandardPdfPipeline (baseline)
2. Multiple ThreadedStandardPdfPipeline in threads (shared VRAM due to PyTorch weight sharing)
3. Multiple ThreadedStandardPdfPipeline in separate PROCESSES (each gets own CUDA context = true VRAM multiplication)

Why batch sizes don't change speed:
- Batch size = how many PAGES are sent to GPU in one kernel call
- Our docs have 6-17 pages each, so even batch_size=4 handles them in 1-4 passes
- Increasing to 128 doesn't help because there aren't enough pages to fill the batch
- Batch sizes would matter more with 100+ page documents
"""

import os
import sys
import time
import gc
import argparse
import multiprocessing as mp
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor

try:
    import torch

    HAS_TORCH = torch.cuda.is_available()
except ImportError:
    HAS_TORCH = False

from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import (
    AcceleratorOptions,
    AcceleratorDevice,
    ThreadedPdfPipelineOptions,
)
from docling.pipeline.threaded_standard_pdf_pipeline import ThreadedStandardPdfPipeline


def get_vram():
    if not HAS_TORCH:
        return 0, 0
    torch.cuda.synchronize()
    return (
        torch.cuda.memory_allocated(0) / (1024**3),
        torch.cuda.memory_reserved(0) / (1024**3),
    )


def print_vram(prefix=""):
    if HAS_TORCH:
        a, r = get_vram()
        print(f"  [{prefix}] VRAM: {a:.2f}GB alloc, {r:.2f}GB reserved")


def make_converter():
    opts = ThreadedPdfPipelineOptions(
        accelerator_options=AcceleratorOptions(
            num_threads=1,
            device=AcceleratorDevice.CUDA if HAS_TORCH else AcceleratorDevice.AUTO,
        ),
        ocr_batch_size=4,
        layout_batch_size=16,
        table_batch_size=4,
    )
    opts.generate_page_images = False
    opts.generate_picture_images = False
    opts.do_ocr = False
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_cls=ThreadedStandardPdfPipeline,
                pipeline_options=opts,
            )
        }
    )


def convert_one(pdf_path):
    """Used by ProcessPoolExecutor — each process creates its own converter."""
    converter = make_converter()
    try:
        start = time.time()
        result = converter.convert(pdf_path)
        dur = time.time() - start
        pages = len(result.document.pages) if hasattr(result.document, "pages") else 0
        if HAS_TORCH:
            a, r = get_vram()
            vram_info = f"{a:.2f}/{r:.2f}GB"
        else:
            vram_info = "N/A"
        return True, dur, pages, Path(pdf_path).name, vram_info
    except Exception as e:
        return False, 0, 0, Path(pdf_path).name, str(e)


def report(label, results, total_time):
    successes = sum(1 for ok, *_ in results if ok)
    total_pages = sum(p for _, _, p, *_ in results)
    print(f"\n  ✅ {successes}/{len(results)} successful, {total_pages} pages")
    print(f"  ⏱  Total: {total_time:.1f}s")
    if total_time > 0:
        print(
            f"  📊 Throughput: {len(results)/total_time:.2f} docs/s, {total_pages/total_time:.2f} pages/s"
        )
    for ok, dur, pages, name, vram in sorted(results, key=lambda x: x[1]):
        if ok:
            print(f"     {name:55s} {dur:5.1f}s ({pages:2d}p) VRAM={vram}")
        else:
            print(f"     {name:55s} FAILED: {vram}")


# ─── TEST 1: Single instance, sequential ─────────────────────────
def test_single_sequential(pdf_paths):
    print(f"\n{'='*65}")
    print(f"  TEST 1: SINGLE Instance, Sequential (Baseline)")
    print(f"{'='*65}")
    print_vram("before")
    converter = make_converter()
    print_vram("after init")

    start = time.time()
    results = []
    for p in pdf_paths:
        try:
            t0 = time.time()
            r = converter.convert(p)
            dur = time.time() - t0
            pages = len(r.document.pages) if hasattr(r.document, "pages") else 0
            a, rv = get_vram() if HAS_TORCH else (0, 0)
            results.append((True, dur, pages, Path(p).name, f"{a:.2f}/{rv:.2f}GB"))
        except Exception as e:
            results.append((False, 0, 0, Path(p).name, str(e)))
    total = time.time() - start
    print_vram("peak/end")
    report("Single Sequential", results, total)

    del converter
    if HAS_TORCH:
        torch.cuda.empty_cache()
    gc.collect()
    time.sleep(2)
    return total


# ─── TEST 2: Multiple instances in THREADS (shared VRAM) ─────────
def test_multi_threaded(pdf_paths, n_workers):
    print(f"\n{'='*65}")
    print(f"  TEST 2: {n_workers} Instances in THREADS (shared VRAM)")
    print(f"{'='*65}")
    print_vram("before")

    import threading

    tl = threading.local()

    def get_conv():
        if not hasattr(tl, "c"):
            tl.c = make_converter()
            print_vram(f"thread-init")
        return tl.c

    def worker(pdf_path):
        conv = get_conv()
        try:
            t0 = time.time()
            r = conv.convert(pdf_path)
            dur = time.time() - t0
            pages = len(r.document.pages) if hasattr(r.document, "pages") else 0
            a, rv = get_vram() if HAS_TORCH else (0, 0)
            return True, dur, pages, Path(pdf_path).name, f"{a:.2f}/{rv:.2f}GB"
        except Exception as e:
            return False, 0, 0, Path(pdf_path).name, str(e)

    start = time.time()
    with ThreadPoolExecutor(max_workers=n_workers) as ex:
        results = list(ex.map(worker, pdf_paths))
    total = time.time() - start
    print_vram("peak/end")
    report(f"{n_workers} Threads", results, total)

    if HAS_TORCH:
        torch.cuda.empty_cache()
    gc.collect()
    time.sleep(2)
    return total


# ─── TEST 3: Multiple instances in PROCESSES (isolated VRAM) ─────
def test_multi_process(pdf_paths, n_workers):
    print(f"\n{'='*65}")
    print(f"  TEST 3: {n_workers} Instances in PROCESSES (isolated VRAM!)")
    print(f"  Each process loads its own models → VRAM should multiply!")
    print(f"{'='*65}")
    print_vram("before (parent)")

    start = time.time()
    # Use spawn to ensure each child gets a fresh CUDA context
    ctx = mp.get_context("spawn")
    with ProcessPoolExecutor(max_workers=n_workers, mp_context=ctx) as ex:
        results = list(ex.map(convert_one, pdf_paths))
    total = time.time() - start
    print_vram("after (parent)")
    report(f"{n_workers} Processes", results, total)

    if HAS_TORCH:
        torch.cuda.empty_cache()
    gc.collect()
    time.sleep(2)
    return total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    parser.add_argument("--count", type=int, default=10)
    parser.add_argument("--workers", type=int, default=5)
    args = parser.parse_args()

    pdf_dir = Path(args.dir)
    all_pdfs = sorted(list(pdf_dir.glob("*.pdf")) + list(pdf_dir.glob("*.PDF")))
    if not all_pdfs:
        print(f"No PDFs in {pdf_dir}")
        return
    pdf_paths = [str(p) for p in all_pdfs]
    while len(pdf_paths) < args.count:
        pdf_paths.extend([str(p) for p in all_pdfs])
    pdf_paths = pdf_paths[: args.count]

    print(f"╔═══════════════════════════════════════════════════════════╗")
    print(f"║  Docling Multi-Instance VRAM Benchmark                   ║")
    print(
        f"║  Files: {len(pdf_paths):3d}   Workers: {args.workers:2d}                            ║"
    )
    if HAS_TORCH:
        name = torch.cuda.get_device_name(0)
        mem = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        print(f"║  GPU: {name:38s}   ║")
        print(f"║  VRAM: {mem:.1f} GB                                        ║")
    print(f"╚═══════════════════════════════════════════════════════════╝")

    t1 = test_single_sequential(pdf_paths)
    t2 = test_multi_threaded(pdf_paths, args.workers)
    t3 = test_multi_process(pdf_paths, args.workers)

    print(f"\n\n{'='*65}")
    print(f"  FINAL COMPARISON")
    print(f"{'='*65}")
    print(f"  {'Config':<40s} {'Time':>8s} {'Speedup':>8s}")
    print(f"  {'-'*58}")
    print(f"  {'Single Sequential (baseline)':<40s} {t1:>7.1f}s {'1.00x':>8s}")
    print(
        f"  {f'{args.workers} Threaded (shared VRAM)':<40s} {t2:>7.1f}s {f'{t1/t2:.2f}x':>8s}"
    )
    print(
        f"  {f'{args.workers} Processes (isolated VRAM)':<40s} {t3:>7.1f}s {f'{t1/t3:.2f}x':>8s}"
    )


if __name__ == "__main__":
    main()
