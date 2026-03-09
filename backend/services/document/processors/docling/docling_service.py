import os
import uuid
import time
import re
import logging
import traceback
import aiofiles
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, Union
import json
import asyncio
import multiprocessing
from concurrent.futures import ProcessPoolExecutor
from services.document.processors.docling.vram_guard import VRAMGuard
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import (
    AcceleratorOptions,
    AcceleratorDevice,
    ThreadedPdfPipelineOptions,
)
from docling.pipeline.threaded_standard_pdf_pipeline import (
    ThreadedStandardPdfPipeline,
)
from docling_core.types.doc import ImageRefMode, PictureItem, TableItem

_log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Module-level helpers for multiprocessing (must be picklable / top-level)
# ─────────────────────────────────────────────────────────────────────────────

# Per-process cached converter (avoids re-creating on every call)
_process_converter: Optional[DocumentConverter] = None
_process_converter_key: Optional[str] = None


def _get_or_create_converter(image_resolution_scale: float = 1.5) -> DocumentConverter:
    """Return a cached converter for this process, creating one if needed."""
    global _process_converter, _process_converter_key
    cache_key = f"{image_resolution_scale}"
    if _process_converter is not None and _process_converter_key == cache_key:
        return _process_converter

    opts = ThreadedPdfPipelineOptions(
        accelerator_options=AcceleratorOptions(
            num_threads=1,
            device=AcceleratorDevice.AUTO,
        ),
        ocr_batch_size=8,  # Increased from 4 for better GPU throughput
        layout_batch_size=8,  # Bench-optimal: same throughput as 32, lower per-worker VRAM
        table_batch_size=4,  # Kept at 4 as tables are highly VRAM intensive
    )
    opts.images_scale = image_resolution_scale
    opts.generate_page_images = False
    opts.generate_picture_images = True
    opts.do_ocr = False

    _process_converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_cls=ThreadedStandardPdfPipeline,
                pipeline_options=opts,
            )
        }
    )
    _process_converter_key = cache_key
    return _process_converter


def _calculate_max_workers(vram_per_worker_gb: float = 2.0) -> int:
    """Dynamically calculate max workers based on available GPU VRAM."""
    try:
        import torch

        if torch.cuda.is_available():
            total_vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
            gpu_workers = int(total_vram_gb / vram_per_worker_gb)
            max_w = max(1, gpu_workers)
            _log.info(
                f"Worker calculation: {total_vram_gb:.1f}GB VRAM / "
                f"{vram_per_worker_gb}GB per worker = {gpu_workers} GPU workers "
                f"→ using {max_w} workers"
            )
            return max_w
    except ImportError:
        pass
    # CPU-only fallback: use all cores minus 1 (leave one free for Uvicorn/OS).
    # We also pin each worker's PyTorch to 1 thread (see _docling_worker_process)
    # so that N workers = exactly N cores, with no inter-thread contention.
    cpu_cores = os.cpu_count() or 2
    cpu_workers = max(1, cpu_cores - 1)
    _log.info(
        f"No CUDA GPU detected. Using {cpu_workers} CPU workers "
        f"({cpu_cores} cores - 1 reserved for Uvicorn)"
    )
    return cpu_workers


def _serialize_node_item(node) -> Optional[Dict[str, Any]]:
    """Serialize a NodeItem to a dictionary (module-level for subprocess use)."""
    if not node:
        return None

    def to_string(obj):
        return str(obj) if obj is not None else None

    def to_string_list(items):
        return [str(item) for item in items] if items else []

    return {
        "label": to_string(node.label) if hasattr(node, "label") else None,
        "self_ref": to_string(node.self_ref) if hasattr(node, "self_ref") else None,
        "parent": to_string(node.parent) if hasattr(node, "parent") else None,
        "children": to_string_list(node.children) if hasattr(node, "children") else [],
    }


def _docling_worker_process(task_args: dict) -> dict:
    """
    Standalone worker function that runs in a subprocess.

    Creates (or reuses) its own DocumentConverter, converts the file,
    extracts images/markdown/bboxes, and writes everything to disk.
    Returns a simple dict with status info (no unpicklable objects).
    """
    source = task_args["source"]
    source_type = task_args["source_type"]
    conversion_dir = Path(task_args["conversion_dir"])
    image_resolution_scale = task_args.get("image_resolution_scale", 1.5)

    conversion_dir.mkdir(parents=True, exist_ok=True)
    log_path = conversion_dir / "conversion.log"
    metadata_path = conversion_dir / "metadata.json"

    # Set up per-conversion file logging
    handler = logging.FileHandler(str(log_path), mode="w", encoding="utf-8")
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
    root_logger = logging.getLogger()
    root_logger.addHandler(handler)
    logging.captureWarnings(True)

    # Pin PyTorch to 1 thread per worker so N workers = N cores, not N×T threads.
    # Without this, each worker spawns multiple OpenMP threads causing core thrashing.
    try:
        import torch

        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
    except Exception:
        pass

    try:
        converter = _get_or_create_converter(image_resolution_scale)

        # Measure peak VRAM usage during conversion
        peak_vram_mb = -1.0
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.reset_peak_memory_stats()
        except Exception:
            pass

        # Phase 1: Convert
        t0 = time.perf_counter()
        result = converter.convert(source)
        parse_duration = time.perf_counter() - t0

        try:
            import torch
            if torch.cuda.is_available():
                peak_vram_mb = torch.cuda.max_memory_allocated() / (1024 ** 2)
        except Exception:
            pass

        if source_type == "url":
            base_filename = "url_document"
        else:
            base_filename = Path(source).stem

        # Phase 2: Extract images
        figures_dir = conversion_dir / "figures"
        figures_dir.mkdir(parents=True, exist_ok=True)
        figures_metadata = []
        picture_count = 0
        table_count = 0
        for element, _level in result.document.iterate_items():
            if isinstance(element, TableItem):
                table_count += 1
            if isinstance(element, PictureItem):
                picture_count += 1
                fig_id = f"picture-{picture_count}"
                img_path = figures_dir / f"{fig_id}.png"
                try:
                    with img_path.open("wb") as fp:
                        element.get_image(result.document).save(fp, "PNG")
                except Exception:
                    pass
                page_num = None
                caption = None
                if hasattr(element, "prov") and element.prov:
                    for prov in element.prov:
                        if hasattr(prov, "page_no"):
                            page_num = prov.page_no
                            break
                if hasattr(element, "caption"):
                    caption = str(element.caption)
                figures_metadata.append(
                    {
                        "id": fig_id,
                        "page": page_num,
                        "caption": caption or f"Figure {picture_count}",
                        "image_path": f"figures/{fig_id}.png",
                        "type": "picture",
                    }
                )
        image_info = {
            "figures_found": len(figures_metadata),
            "figures": figures_metadata,
            "tables_found": table_count,
            "pictures_found": picture_count,
        }

        # Phase 3: Save markdown with HTML tables
        markdown_filename = "document.md"
        markdown_path = conversion_dir / markdown_filename
        tables_dir = conversion_dir / "tables"
        tables_dir.mkdir(parents=True, exist_ok=True)
        markdown_content = result.document.export_to_markdown(
            image_mode=ImageRefMode.REFERENCED
        )
        table_html_list = []
        for idx, table in enumerate(result.document.tables, start=1):
            try:
                html_table = table.export_to_html(doc=result.document)
                table_html_list.append(html_table)
                with open(tables_dir / f"table-{idx}.html", "w", encoding="utf-8") as f:
                    f.write(html_table)
            except Exception:
                table_html_list.append(None)
        table_pattern = r"\|[^\n]*\|[\n\r]+\|[-:\s|]+\|[\n\r]+(?:\|[^\n]*\|[\n\r]+)+"
        md_tables = list(re.finditer(table_pattern, markdown_content))
        t_idx = 0
        for match in reversed(md_tables):
            if t_idx < len(table_html_list) and table_html_list[-(t_idx + 1)]:
                s, e = match.span()
                markdown_content = (
                    markdown_content[:s]
                    + table_html_list[-(t_idx + 1)]
                    + markdown_content[e:]
                )
            t_idx += 1
        with open(markdown_path, "w", encoding="utf-8") as f:
            f.write(markdown_content)

        # Phase 4: Extract bounding boxes
        raw_analysis_path = conversion_dir / "raw_analysis.json"
        try:
            doc = result.document
            analysis = {
                "processor": "docling",
                "api_version": "2.0",
                "model_id": "docling-document",
                "pages": [],
                "paragraphs": [],
                "tables": [],
                "figures": [],
                "document_structure": {"body": None, "furniture": None, "groups": []},
            }
            try:
                analysis["content"] = doc.export_to_markdown()
            except Exception:
                analysis["content"] = ""
            if hasattr(doc, "pages") and doc.pages:
                for page_no, page in doc.pages.items():
                    analysis["pages"].append(
                        {
                            "page_number": page_no,
                            "width": (
                                page.size.width
                                if hasattr(page, "size") and page.size
                                else None
                            ),
                            "height": (
                                page.size.height
                                if hasattr(page, "size") and page.size
                                else None
                            ),
                            "unit": "pt",
                            "words": [],
                            "lines": [],
                        }
                    )
            if hasattr(doc, "texts") and doc.texts:
                for idx, text_item in enumerate(doc.texts):
                    paragraph = {
                        "id": f"text_{idx}",
                        "content": text_item.text if hasattr(text_item, "text") else "",
                        "role": (
                            text_item.label
                            if hasattr(text_item, "label")
                            else "paragraph"
                        ),
                        "bounding_regions": [],
                    }
                    if hasattr(text_item, "prov") and text_item.prov:
                        for prov in text_item.prov:
                            if hasattr(prov, "bbox") and prov.bbox:
                                bbox = prov.bbox
                                paragraph["bounding_regions"].append(
                                    {
                                        "page_number": (
                                            prov.page_no
                                            if hasattr(prov, "page_no")
                                            else None
                                        ),
                                        "polygon": [
                                            bbox.l,
                                            bbox.t,
                                            bbox.r,
                                            bbox.t,
                                            bbox.r,
                                            bbox.b,
                                            bbox.l,
                                            bbox.b,
                                        ],
                                    }
                                )
                    analysis["paragraphs"].append(paragraph)
            if hasattr(doc, "tables") and doc.tables:
                for idx, ti in enumerate(doc.tables):
                    tbl = {
                        "id": f"table_{idx}",
                        "row_count": 0,
                        "column_count": 0,
                        "cells": [],
                        "bounding_regions": [],
                    }
                    if hasattr(ti, "data") and ti.data:
                        tbl["row_count"] = (
                            len(ti.data.table_cells)
                            if hasattr(ti.data, "table_cells")
                            else 0
                        )
                        if hasattr(ti.data, "table_cells"):
                            for cell in ti.data.table_cells:
                                tbl["cells"].append(
                                    {
                                        "row_index": getattr(cell, "row_index", 0),
                                        "column_index": getattr(cell, "col_index", 0),
                                        "row_span": getattr(cell, "row_span", 1),
                                        "column_span": getattr(cell, "col_span", 1),
                                        "content": getattr(cell, "text", ""),
                                        "kind": "content",
                                    }
                                )
                    if hasattr(ti, "prov") and ti.prov:
                        for prov in ti.prov:
                            if hasattr(prov, "bbox") and prov.bbox:
                                bbox = prov.bbox
                                tbl["bounding_regions"].append(
                                    {
                                        "page_number": (
                                            prov.page_no
                                            if hasattr(prov, "page_no")
                                            else None
                                        ),
                                        "polygon": [
                                            bbox.l,
                                            bbox.t,
                                            bbox.r,
                                            bbox.t,
                                            bbox.r,
                                            bbox.b,
                                            bbox.l,
                                            bbox.b,
                                        ],
                                    }
                                )
                    analysis["tables"].append(tbl)
            if hasattr(doc, "pictures") and doc.pictures:
                for idx, pi in enumerate(doc.pictures):
                    fig = {
                        "id": f"picture_{idx}",
                        "caption": {
                            "content": (
                                str(pi.caption)
                                if hasattr(pi, "caption") and pi.caption
                                else None
                            )
                        },
                        "bounding_regions": [],
                    }
                    if hasattr(pi, "prov") and pi.prov:
                        for prov in pi.prov:
                            if hasattr(prov, "bbox") and prov.bbox:
                                bbox = prov.bbox
                                fig["bounding_regions"].append(
                                    {
                                        "page_number": (
                                            prov.page_no
                                            if hasattr(prov, "page_no")
                                            else None
                                        ),
                                        "polygon": [
                                            bbox.l,
                                            bbox.t,
                                            bbox.r,
                                            bbox.t,
                                            bbox.r,
                                            bbox.b,
                                            bbox.l,
                                            bbox.b,
                                        ],
                                    }
                                )
                    analysis["figures"].append(fig)
            if hasattr(doc, "body") and doc.body:
                analysis["document_structure"]["body"] = _serialize_node_item(doc.body)
            if hasattr(doc, "furniture") and doc.furniture:
                analysis["document_structure"]["furniture"] = _serialize_node_item(
                    doc.furniture
                )
            if hasattr(doc, "groups") and doc.groups:
                for group in doc.groups:
                    analysis["document_structure"]["groups"].append(
                        _serialize_node_item(group)
                    )
            with open(raw_analysis_path, "w", encoding="utf-8") as f:
                json.dump(analysis, f, indent=2, ensure_ascii=False)
        except Exception as exc:
            with open(raw_analysis_path, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "processor": "docling",
                        "error": str(exc),
                        "pages": [],
                        "paragraphs": [],
                        "tables": [],
                        "figures": [],
                    },
                    f,
                    indent=2,
                )

        # Debug dump
        try:
            doc_json_path = conversion_dir / "docling_document.json"
            if hasattr(result.document, "model_dump_json"):
                with open(doc_json_path, "w", encoding="utf-8") as f:
                    f.write(result.document.model_dump_json(indent=2))
            elif hasattr(result.document, "model_dump"):
                with open(doc_json_path, "w", encoding="utf-8") as f:
                    f.write(
                        json.dumps(result.document.model_dump(mode="json"), indent=2)
                    )
        except Exception:
            pass

        # Read back markdown for metadata
        with open(markdown_path, "r", encoding="utf-8") as mf:
            md_content = mf.read()

        page_count = 0
        try:
            if hasattr(result, "document") and hasattr(result.document, "pages"):
                page_count = len(result.document.pages or {})
        except Exception:
            pass

        return {
            "success": True,
            "parse_duration": parse_duration,
            "markdown_content": md_content,
            "markdown_filename": markdown_filename,
            "markdown_path": str(markdown_path),
            "page_count": page_count,
            "image_info": image_info,
            "peak_vram_mb": peak_vram_mb,
        }

    except Exception as exc:
        error_trace = traceback.format_exc()
        error_str = str(exc).lower()
        is_oom = any(p in error_str for p in [
            "cuda out of memory", "outofmemoryerror",
            "cuda error: out of memory", "cublas_status_alloc_failed",
        ])
        _log.error(f"Worker process error (oom={is_oom}): {exc}\n{error_trace}")

        # On OOM, try to free VRAM so the subprocess can be reused
        if is_oom:
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

        return {
            "success": False,
            "error": str(exc),
            "error_trace": error_trace,
            "is_oom": is_oom,
        }
    finally:
        # Release PyTorch's cached VRAM blocks back to the GPU driver.
        # Without this, idle workers hold onto runtime VRAM in PyTorch's
        # caching allocator — invisible to other processes and unusable
        # by them.  Peak measurement has already been captured above.
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

        try:
            root_logger.removeHandler(handler)
            handler.close()
            logging.captureWarnings(False)
        except Exception:
            pass


class DoclingService:
    """
    Service for handling document ingestion and conversion using Docling
    """

    def __init__(
        self,
        markdown_dir: Optional[Union[str, Path]] = None,
        image_resolution_scale: float = 1.5,
    ):
        """
        Initialize the docling service

        Args:
            markdown_dir: Directory where converted markdown files will be stored.
                          If None, defaults to output/docling relative to this file.
            image_resolution_scale: Resolution scale for image extraction (1.0 = 72 DPI, 2.0 = 144 DPI)
        """
        # Base path is 4 levels up from this file (backend/)
        self.base_path = Path(__file__).resolve().parents[4]

        # Unified directory structure: output/docling/{conversion_id}/
        if markdown_dir is None:
            self.output_base_dir = self.base_path / "output" / "docling"
        else:
            self.output_base_dir = Path(markdown_dir)

        # Create base directory if it doesn't exist
        self.output_base_dir.mkdir(parents=True, exist_ok=True)

        self.image_resolution_scale = image_resolution_scale

        # Lazy-initialized: the ProcessPoolExecutor and VRAMGuard are only
        # created on the first conversion call, so DoclingService instances
        # that are only used for reading results (e.g. in the extractions
        # router) never allocate subprocesses or VRAM.
        self._process_pool: Optional[ProcessPoolExecutor] = None
        self._vram_guard: Optional[VRAMGuard] = None

    def _ensure_initialized(self):
        """Lazily create the VRAMGuard and ProcessPoolExecutor on first use."""
        if self._vram_guard is not None:
            return

        # The VRAMGuard auto-detects total VRAM and computes max_workers.
        self._vram_guard = VRAMGuard()

        # Size the pool slightly larger than the guard's max_workers so the
        # pool itself never blocks — all admission control goes through the
        # guard's semaphore + real-time VRAM check.
        pool_size = self._vram_guard.max_workers + 2
        _log.info(
            f"DoclingService: creating ProcessPoolExecutor with {pool_size} slots "
            f"(VRAMGuard max_workers={self._vram_guard.max_workers})"
        )
        self._process_pool = ProcessPoolExecutor(
            max_workers=pool_size,
            mp_context=multiprocessing.get_context("spawn"),
        )

    @property
    def process_pool(self) -> ProcessPoolExecutor:
        """Lazily create the ProcessPoolExecutor on first use."""
        self._ensure_initialized()
        return self._process_pool

    @property
    def vram_guard(self) -> VRAMGuard:
        """Lazily create the VRAMGuard on first use."""
        self._ensure_initialized()
        return self._vram_guard

    @property
    def max_workers(self) -> int:
        """Return the VRAM-based worker count from the guard."""
        self._ensure_initialized()
        return self._vram_guard.max_workers

    async def convert_document_to_markdown(
        self,
        source: Union[str, Path],
        source_type: str = "file",
        output_dir: Optional[Path] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """
        Convert a document to markdown using Docling.

        Dispatches the work to a subprocess via ProcessPoolExecutor for true
        parallel GPU usage. Each subprocess creates its own DocumentConverter.
        """
        try:
            conversion_id = str(uuid.uuid4())

            if output_dir:
                conversion_dir = output_dir
            else:
                conversion_dir = self.output_base_dir / conversion_id
            conversion_dir.mkdir(parents=True, exist_ok=True)

            metadata_path = conversion_dir / "metadata.json"

            # Build task args for the subprocess worker
            task_args = {
                "source": str(source),
                "source_type": source_type,
                "conversion_dir": str(conversion_dir),
                "image_resolution_scale": self.image_resolution_scale,
            }

            # Acquire a VRAM slot, then submit to the process pool.
            # The guard queues excess requests until VRAM is available.
            loop = asyncio.get_running_loop()
            async with self.vram_guard.acquire_slot() as slot:
                worker_result = await loop.run_in_executor(
                    self.process_pool, _docling_worker_process, task_args
                )

            # Feed the guard's EMA with the worker's actual peak VRAM
            peak = worker_result.get("peak_vram_mb", -1)
            if peak > 0:
                self.vram_guard.report_worker_result(peak)
            if worker_result.get("is_oom"):
                self.vram_guard.report_oom()

            if not worker_result.get("success"):
                raise RuntimeError(
                    worker_result.get("error", "Unknown error in worker process")
                )

            # Build metadata from worker result
            markdown_content = worker_result["markdown_content"]
            metadata = {
                "conversion_id": conversion_id,
                "source": str(source),
                "source_type": source_type,
                "processor": "docling",
                "conversion_dir": str(conversion_dir),
                "markdown_filename": worker_result["markdown_filename"],
                "markdown_path": worker_result["markdown_path"],
                "log_path": str(conversion_dir / "conversion.log"),
                "conversion_time": datetime.now().isoformat(),
                "parse_duration_seconds": worker_result["parse_duration"],
                "content_length": len(markdown_content),
                "page_count": worker_result["page_count"],
                "status": "success",
                **worker_result["image_info"],
            }

            async with aiofiles.open(metadata_path, "w", encoding="utf-8") as f:
                await f.write(json.dumps(metadata, indent=2))

            return {
                "success": True,
                "conversion_id": conversion_id,
                "markdown_path": worker_result["markdown_path"],
                "markdown_content": markdown_content,
                "metadata": metadata,
            }

        except Exception as e:
            conv_id = (
                conversion_id if "conversion_id" in locals() else str(uuid.uuid4())
            )
            error_metadata = {
                "conversion_id": conv_id,
                "source": str(source),
                "source_type": source_type,
                "conversion_time": datetime.now().isoformat(),
                "status": "error",
                "error_message": str(e),
                "conversion_dir": (
                    str(conversion_dir) if "conversion_dir" in locals() else None
                ),
                "log_path": (
                    str(conversion_dir / "conversion.log")
                    if "conversion_dir" in locals()
                    else None
                ),
            }

            try:
                if "metadata_path" in locals():
                    async with aiofiles.open(metadata_path, "w", encoding="utf-8") as f:
                        await f.write(json.dumps(error_metadata, indent=2))
            except Exception:
                pass

            return {
                "success": False,
                "error": str(e),
                "conversion_id": error_metadata["conversion_id"],
                "metadata": error_metadata,
            }

    async def start_conversion(
        self, source: Union[str, Path], source_type: str = "file"
    ) -> Dict[str, Any]:
        """
        Start a conversion in the background and return immediately with a conversion_id.
        The conversion runs in the process pool and writes logs and metadata
        to the conversion directory so the frontend can stream logs.
        """
        conversion_id = str(uuid.uuid4())

        # Create conversion-specific directory: output/docling/{conversion_id}/
        conversion_dir = self.output_base_dir / conversion_id
        conversion_dir.mkdir(parents=True, exist_ok=True)

        log_path = conversion_dir / "conversion.log"
        metadata_path = conversion_dir / "metadata.json"

        # initial metadata marking as running
        metadata = {
            "conversion_id": conversion_id,
            "source": str(source),
            "source_type": source_type,
            "processor": "docling",
            "conversion_dir": str(conversion_dir),
            "markdown_filename": None,
            "markdown_path": None,
            "log_path": str(log_path),
            "conversion_time": datetime.now().isoformat(),
            "content_length": 0,
            "status": "running",
        }
        # Save initial metadata to conversion directory
        async with aiofiles.open(metadata_path, "w", encoding="utf-8") as f:
            await f.write(json.dumps(metadata, indent=2))

        # Build task args for the subprocess worker
        task_args = {
            "source": str(source),
            "source_type": source_type,
            "conversion_dir": str(conversion_dir),
            "image_resolution_scale": self.image_resolution_scale,
        }

        # Schedule the background conversion
        output_base_dir = self.output_base_dir

        vram_guard = self.vram_guard  # capture before fire-and-forget

        async def _run_and_finalize():
            try:
                loop = asyncio.get_running_loop()
                async with vram_guard.acquire_slot() as slot:
                    worker_result = await loop.run_in_executor(
                        self.process_pool, _docling_worker_process, task_args
                    )

                # Feed the guard's EMA with the worker's actual peak VRAM
                peak = worker_result.get("peak_vram_mb", -1)
                if peak > 0:
                    vram_guard.report_worker_result(peak)
                if worker_result.get("is_oom"):
                    vram_guard.report_oom()

                conv_dir = output_base_dir / conversion_id
                meta_path = conv_dir / "metadata.json"

                if worker_result.get("success"):
                    final_meta = {
                        "conversion_id": conversion_id,
                        "source": str(source),
                        "source_type": source_type,
                        "processor": "docling",
                        "conversion_dir": str(conv_dir),
                        "markdown_filename": worker_result["markdown_filename"],
                        "markdown_path": worker_result["markdown_path"],
                        "log_path": str(conv_dir / "conversion.log"),
                        "conversion_time": datetime.now().isoformat(),
                        "parse_duration_seconds": worker_result["parse_duration"],
                        "content_length": len(
                            worker_result.get("markdown_content", "")
                        ),
                        "page_count": worker_result["page_count"],
                        "status": "success",
                        **worker_result["image_info"],
                    }
                else:
                    final_meta = {
                        "conversion_id": conversion_id,
                        "source": str(source),
                        "source_type": source_type,
                        "conversion_dir": str(conv_dir),
                        "conversion_time": datetime.now().isoformat(),
                        "status": "error",
                        "error_message": worker_result.get("error", "Unknown error"),
                        "log_path": str(conv_dir / "conversion.log"),
                    }

                try:
                    async with aiofiles.open(meta_path, "w", encoding="utf-8") as f:
                        await f.write(json.dumps(final_meta, indent=2))
                except Exception:
                    pass

            except Exception as e:
                try:
                    conv_dir = output_base_dir / conversion_id
                    meta_path = conv_dir / "metadata.json"
                    error_meta = {
                        "conversion_id": conversion_id,
                        "source": str(source),
                        "source_type": source_type,
                        "conversion_dir": str(conv_dir),
                        "conversion_time": datetime.now().isoformat(),
                        "status": "error",
                        "error_message": str(e),
                        "log_path": str(conv_dir / "conversion.log"),
                    }
                    async with aiofiles.open(meta_path, "w", encoding="utf-8") as f:
                        await f.write(json.dumps(error_meta, indent=2))
                except Exception:
                    pass

        # Fire and forget
        asyncio.ensure_future(_run_and_finalize())

        return {
            "success": True,
            "conversion_id": conversion_id,
            "markdown_path": None,
            "metadata": metadata,
        }

    async def get_conversion_by_id(
        self, conversion_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get conversion information by conversion ID

        Args:
            conversion_id: Unique conversion identifier

        Returns:
            Dict containing conversion information or None if not found
        """
        return await self._load_conversion_metadata(conversion_id)

    async def get_markdown_content(self, conversion_id: str) -> Optional[str]:
        """
        Get tagged markdown content by conversion ID for LLM entity extraction

        Returns tagged markdown with paragraph-level references (e.g., [PARA_001_P3])
        if available, otherwise falls back to regular markdown.

        Args:
            conversion_id: Unique conversion identifier

        Returns:
            Tagged markdown content as string or None if not found
        """
        conversion_dir = self.output_base_dir / conversion_id

        markdown_path = conversion_dir / "document.md"
        if not markdown_path.exists():
            return None

        try:
            async with aiofiles.open(markdown_path, "r", encoding="utf-8") as f:
                return await f.read()
        except (IOError, UnicodeDecodeError):
            return None

    async def list_conversions(self) -> list[Dict[str, Any]]:
        """
        List all document conversions

        Returns:
            List of conversion metadata dictionaries
        """
        conversions = []
        # Iterate through conversion directories
        for conv_dir in self.output_base_dir.iterdir():
            if conv_dir.is_dir():
                conversion_id = conv_dir.name
                metadata = await self._load_conversion_metadata(conversion_id)
                if metadata:
                    conversions.append(metadata)

        return sorted(conversions, key=lambda x: x["conversion_time"], reverse=True)

    async def delete_conversion(self, conversion_id: str) -> bool:
        """
        Delete a conversion and its associated files

        Args:
            conversion_id: Unique conversion identifier

        Returns:
            bool: True if conversion was deleted, False if not found
        """
        # Check if conversion directory exists
        conversion_dir = self.output_base_dir / conversion_id
        if not conversion_dir.exists():
            return False

        import shutil

        # Delete entire conversion directory (contains markdown, figures, metadata, and logs)
        try:
            shutil.rmtree(conversion_dir)
            return True
        except Exception:
            return False

    async def get_figures_for_conversion(
        self, conversion_id: str
    ) -> Optional[list[Dict[str, Any]]]:
        """
        Get all figures metadata for a specific conversion

        Args:
            conversion_id: The conversion ID

        Returns:
            List of figure metadata dictionaries or None if not found
        """
        metadata = await self._load_conversion_metadata(conversion_id)
        if metadata and "figures" in metadata:
            return metadata["figures"]
        return None

    async def get_raw_analysis_result(
        self, conversion_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get the complete raw analysis result with ALL bounding boxes from Docling

        This includes:
        - All pages with dimensions
        - All text items (paragraphs) with bounding regions and roles
        - All tables with cells and bounding boxes
        - All pictures/figures with bounding regions
        - Document structure (body, furniture, groups)

        Args:
            conversion_id: The conversion ID

        Returns:
            Complete analysis result dictionary or None if not found
        """
        raw_analysis_path = self.output_base_dir / conversion_id / "raw_analysis.json"

        if not raw_analysis_path.exists():
            return None

        try:
            async with aiofiles.open(raw_analysis_path, "r", encoding="utf-8") as f:
                content = await f.read()
                return json.loads(content)
        except (json.JSONDecodeError, IOError):
            return None

    async def _save_conversion_metadata(
        self, conversion_id: str, metadata: Dict[str, Any]
    ):
        """
        Save conversion metadata to JSON file in the conversion directory

        Args:
            conversion_id: Unique conversion identifier
            metadata: Metadata dictionary
        """
        metadata_path = self.output_base_dir / conversion_id / "metadata.json"
        async with aiofiles.open(metadata_path, "w", encoding="utf-8") as f:
            await f.write(json.dumps(metadata, indent=2))

    async def _load_conversion_metadata(
        self, conversion_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Load conversion metadata from JSON file in the conversion directory

        Args:
            conversion_id: Unique conversion identifier

        Returns:
            Metadata dictionary or None if not found
        """
        metadata_path = self.output_base_dir / conversion_id / "metadata.json"
        if not metadata_path.exists():
            return None

        try:
            async with aiofiles.open(metadata_path, "r", encoding="utf-8") as f:
                content = await f.read()
                return json.loads(content)
        except (json.JSONDecodeError, IOError):
            return None
