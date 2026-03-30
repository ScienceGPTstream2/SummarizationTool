#!/usr/bin/env python3
"""
bench_vlm.py — Compare standard Docling pipeline vs vLLM-served VLM pipeline.

Tests three configurations on the same PDFs:
  1. Standard pipeline  — EasyOCR + layout model + table model (3 models)
  2. SmolDocling-vLLM   — SmolDocling-256M served via vLLM (1 model, 256M params)
  3. GraniteDocling-vLLM — GraniteDocling-258M served via vLLM (1 model, 258M params)

Measures: wall time, peak VRAM, markdown character count.
Saves sample markdown output for manual quality comparison.

Usage:
    python backend/scripts/bench_vlm.py
    python backend/scripts/bench_vlm.py --pdf-dir /path/to/pdfs
    python backend/scripts/bench_vlm.py --pipelines standard smoldocling
    python backend/scripts/bench_vlm.py --n-docs 3    # how many PDFs per pipeline
"""

import argparse
import gc
import sys
import time
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


def _vllm_supported() -> bool:
    """
    vLLM requires compute capability >= 8.0 for bfloat16 (A100+).
    On T4 (cc 7.5) vLLM forces float16 but the idefics3 vision encoder
    has float32 LayerNorm weights, causing a dtype mismatch on the
    first forward pass (inside the EngineCore subprocess, so it can't
    be caught with a normal try/except around build_vlm_converter).
    """
    try:
        import torch

        if not torch.cuda.is_available():
            return False
        major, _ = torch.cuda.get_device_capability()
        return major >= 8
    except Exception:
        return False


def _vram_allocated_mb() -> float:
    try:
        import torch

        return torch.cuda.memory_allocated() / 1024**2
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


# ── Pipeline builders ──────────────────────────────────────────────────────────


def build_standard_converter():
    """Build the standard Docling converter (same as DoclingService default)."""
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


def build_vlm_converter(vlm_spec):
    """Build a DocumentConverter using the VLM pipeline with the given spec."""
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import VlmPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.pipeline.vlm_pipeline import VlmPipeline

    pipeline_options = VlmPipelineOptions(vlm_options=vlm_spec)
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_cls=VlmPipeline,
                pipeline_options=pipeline_options,
            )
        }
    )


# ── Run one pipeline on a list of PDFs ────────────────────────────────────────


def run_pipeline(converter, pdfs: list, label: str) -> dict:
    """
    Convert all PDFs sequentially with the given converter.
    Returns aggregate timing, VRAM, and per-doc results.
    """
    _reset_vram()
    before_alloc = _vram_allocated_mb()

    per_doc = []
    total_chars = 0
    t0 = time.perf_counter()

    for pdf in pdfs:
        doc_t0 = time.perf_counter()
        try:
            result = converter.convert(str(pdf))
            elapsed = time.perf_counter() - doc_t0
            md = result.document.export_to_markdown() if result.document else ""
            chars = len(md)
            total_chars += chars
            per_doc.append(
                {
                    "file": pdf.name,
                    "ok": True,
                    "elapsed": round(elapsed, 2),
                    "chars": chars,
                    "md": md,
                }
            )
            print(
                f"  {GREEN}✓{RESET}  {pdf.name[:50]:<50}  {elapsed:.2f}s  {chars:>7} chars"
            )
            del result
        except Exception as exc:
            elapsed = time.perf_counter() - doc_t0
            per_doc.append(
                {
                    "file": pdf.name,
                    "ok": False,
                    "elapsed": round(elapsed, 2),
                    "chars": 0,
                    "md": "",
                    "error": str(exc)[:200],
                }
            )
            print(
                f"  {RED}✗{RESET}  {pdf.name[:50]:<50}  {elapsed:.2f}s  ERROR: {str(exc)[:80]}"
            )

    total_elapsed = time.perf_counter() - t0
    peak = _peak_vram_mb()
    ok_docs = [d for d in per_doc if d["ok"]]

    return {
        "label": label,
        "total_sec": round(total_elapsed, 2),
        "avg_sec": (
            round(sum(d["elapsed"] for d in ok_docs) / len(ok_docs), 2)
            if ok_docs
            else 0
        ),
        "peak_vram_mb": round(peak, 1),
        "before_alloc_mb": round(before_alloc, 1),
        "total_chars": total_chars,
        "avg_chars": round(total_chars / len(ok_docs)) if ok_docs else 0,
        "docs_ok": len(ok_docs),
        "docs_total": len(pdfs),
        "per_doc": per_doc,
    }


# ── Print comparison table ─────────────────────────────────────────────────────


def print_comparison(rows: list) -> None:
    header = (
        f"{'Pipeline':<28}  {'avg_sec':>7}  {'total_sec':>9}  {'peak_vram_mb':>12}"
        f"  {'avg_chars':>9}  {'ok/total':>8}"
    )
    print(f"\n{BOLD}{header}{RESET}")
    print("─" * len(header))
    for r in rows:
        print(
            f"{r['label']:<28}  {r['avg_sec']:>7.2f}  {r['total_sec']:>9.2f}"
            f"  {r['peak_vram_mb']:>12.1f}  {r['avg_chars']:>9}  {r['docs_ok']:>4}/{r['docs_total']:<3}"
        )


# ── Save sample markdown ───────────────────────────────────────────────────────


def save_sample_md(row: dict, out_dir: Path) -> None:
    """Save the markdown output of the first successful doc for manual review."""
    slug = (
        row["label"]
        .lower()
        .replace(" ", "_")
        .replace("-", "_")
        .replace("(", "")
        .replace(")", "")
    )
    out_path = out_dir / f"bench_vlm_output_{slug}.md"
    for doc in row["per_doc"]:
        if doc["ok"] and doc["md"]:
            out_path.write_text(doc["md"], encoding="utf-8")
            print(f"  {GREEN}Saved sample output → {out_path.name}{RESET}")
            return
    print(f"  {YELLOW}No successful output to save for {row['label']}{RESET}")


# ── Main ───────────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare standard Docling vs vLLM-served VLM pipeline"
    )
    parser.add_argument(
        "--pdf-dir",
        default=str(ROOT / "Testing_documents"),
        help="Directory containing PDFs",
    )
    parser.add_argument(
        "--n-docs",
        type=int,
        default=3,
        help="Number of PDFs to process per pipeline (default: 3)",
    )
    parser.add_argument(
        "--pipelines",
        nargs="+",
        choices=["standard", "smoldocling", "granitedocling"],
        default=["standard", "smoldocling", "granitedocling"],
        help="Which pipelines to run",
    )
    parser.add_argument(
        "--out-dir",
        default=str(ROOT / "backend" / "scripts"),
        help="Directory to save sample markdown output files",
    )
    args = parser.parse_args()

    pdf_dir = Path(args.pdf_dir)
    out_dir = Path(args.out_dir)
    all_pdfs = sorted(pdf_dir.glob("*.pdf")) + sorted(pdf_dir.glob("*.PDF"))
    if not all_pdfs:
        print(f"[ERROR] No PDFs found in {pdf_dir}")
        sys.exit(1)

    # Use medium-sized PDFs for fair comparison; skip the 9 MB Ying et al
    medium_pdfs = [p for p in all_pdfs if p.stat().st_size < 2 * 1024 * 1024]
    if not medium_pdfs:
        medium_pdfs = all_pdfs
    pdfs = medium_pdfs[: args.n_docs]

    _section("bench_vlm.py — Standard vs vLLM pipeline comparison")
    print(f"  PDF dir    : {pdf_dir}")
    print(f"  PDFs       : {len(pdfs)} (of {len(all_pdfs)} available)")
    for p in pdfs:
        size_kb = p.stat().st_size // 1024
        print(f"    {p.name}  ({size_kb} KB)")
    print(f"  Pipelines  : {args.pipelines}")

    if not _has_cuda():
        print(f"\n{YELLOW}[WARN] No CUDA — VRAM columns will show 0.0{RESET}")

    comparison_rows = []

    # ── Standard pipeline ────────────────────────────────────────────────────
    if "standard" in args.pipelines:
        _section("Pipeline 1 — Standard (EasyOCR + layout + table models)")
        print("  Building converter …")
        t_build = time.perf_counter()
        try:
            converter = build_standard_converter()
            print(
                f"  Built in {time.perf_counter() - t_build:.1f}s  (VRAM: {_vram_allocated_mb():.1f} MB)"
            )
            row = run_pipeline(converter, pdfs, "Standard (3 models)")
            comparison_rows.append(row)
            save_sample_md(row, out_dir)
            del converter
        except Exception as exc:
            print(f"  {RED}FAILED to build/run standard pipeline: {exc}{RESET}")
        finally:
            _reset_vram()

    # ── SmolDocling VLM ──────────────────────────────────────────────────────
    if "smoldocling" in args.pipelines:
        _section("Pipeline 2 — SmolDocling-256M")
        try:
            from docling.datamodel.vlm_model_specs import (
                SMOLDOCLING_TRANSFORMERS,
                SMOLDOCLING_VLLM,
            )

            # vLLM requires compute capability >= 8.0 (A100+).
            # On T4 (cc 7.5) vLLM casts everything to float16, but
            # idefics3's vision encoder has float32 LayerNorm weights.
            # This causes "expected scalar type Float but found Half"
            # inside the EngineCore subprocess — uncatchable at the
            # build_vlm_converter() level because init is deferred to
            # the first convert() call.  Check cc upfront.
            use_vllm = _vllm_supported()
            if use_vllm:
                spec = SMOLDOCLING_VLLM
                backend_label = "vLLM"
                print(f"  GPU supports vLLM (cc >= 8.0) — using vLLM backend")
            else:
                spec = SMOLDOCLING_TRANSFORMERS
                backend_label = "Transformers"
                try:
                    import torch

                    cc = torch.cuda.get_device_capability()
                    print(
                        f"  {YELLOW}GPU compute capability {cc[0]}.{cc[1]} < 8.0 — vLLM not supported."
                        f"\n  Using Transformers backend instead.{RESET}"
                    )
                except Exception:
                    print(
                        f"  {YELLOW}Using Transformers backend (vLLM not supported on this GPU){RESET}"
                    )

            print(f"  Model: {spec.repo_id}")
            print("  Building converter …")
            t_build = time.perf_counter()
            converter = build_vlm_converter(spec)
            print(
                f"  Built in {time.perf_counter() - t_build:.1f}s  (VRAM: {_vram_allocated_mb():.1f} MB)"
            )

            row = run_pipeline(converter, pdfs, f"SmolDocling-256M ({backend_label})")
            comparison_rows.append(row)
            save_sample_md(row, out_dir)
            del converter
        except ImportError as exc:
            print(f"  {YELLOW}SKIPPED — import error: {exc}{RESET}")
        except Exception as exc:
            print(f"  {RED}FAILED: {exc}{RESET}")
        finally:
            _reset_vram()

    # ── GraniteDocling VLM ───────────────────────────────────────────────────
    if "granitedocling" in args.pipelines:
        _section("Pipeline 3 — GraniteDocling-258M")
        try:
            from docling.datamodel.vlm_model_specs import (
                GRANITEDOCLING_TRANSFORMERS,
                GRANITEDOCLING_VLLM,
            )

            use_vllm = _vllm_supported()
            if use_vllm:
                spec = GRANITEDOCLING_VLLM
                backend_label = "vLLM"
                print(f"  GPU supports vLLM (cc >= 8.0) — using vLLM backend")
            else:
                spec = GRANITEDOCLING_TRANSFORMERS
                backend_label = "Transformers"
                print(
                    f"  {YELLOW}Using Transformers backend (vLLM requires cc >= 8.0){RESET}"
                )

            print(f"  Model: {spec.repo_id}")
            print("  Building converter …")
            t_build = time.perf_counter()
            converter = build_vlm_converter(spec)
            print(
                f"  Built in {time.perf_counter() - t_build:.1f}s  (VRAM: {_vram_allocated_mb():.1f} MB)"
            )

            row = run_pipeline(
                converter, pdfs, f"GraniteDocling-258M ({backend_label})"
            )
            comparison_rows.append(row)
            save_sample_md(row, out_dir)
            del converter
        except ImportError as exc:
            print(f"  {YELLOW}SKIPPED — import error: {exc}{RESET}")
        except Exception as exc:
            print(f"  {RED}FAILED: {exc}{RESET}")
        finally:
            _reset_vram()

    # ── Final comparison ─────────────────────────────────────────────────────
    if comparison_rows:
        _section("Comparison table")
        print_comparison(comparison_rows)

        # Speed delta vs standard
        std_rows = [r for r in comparison_rows if r["label"].startswith("Standard")]
        if std_rows:
            std_avg = std_rows[0]["avg_sec"]
            print(f"\n  Speed delta vs Standard ({std_avg:.2f}s avg):")
            for r in comparison_rows:
                if not r["label"].startswith("Standard") and r["avg_sec"] > 0:
                    delta = r["avg_sec"] - std_avg
                    symbol = (
                        GREEN + "faster" + RESET
                        if delta < 0
                        else RED + "slower" + RESET
                    )
                    print(f"    {r['label']}: {abs(delta):.2f}s {symbol}")

        _section("Quality notes")
        print("  Compare the saved markdown files to judge output quality:")
        for r in comparison_rows:
            slug = (
                r["label"]
                .lower()
                .replace(" ", "_")
                .replace("-", "_")
                .replace("(", "")
                .replace(")", "")
            )
            print(f"    bench_vlm_output_{slug}.md  ({r['avg_chars']} avg chars)")
        print(
            "\n  Key things to check in the markdown files:"
            "\n  - Are section headers preserved?"
            "\n  - Are tables formatted correctly?"
            "\n  - Is text extraction complete (no truncation)?"
            "\n  - Are there hallucinated words/lines?"
        )
    else:
        print(f"\n{RED}No pipelines completed successfully.{RESET}")


if __name__ == "__main__":
    main()
