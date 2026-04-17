"""
Remote Docling client — calls the docling-service HTTP API instead of
running the Docling library in-process.

Activated when DOCLING_SERVICE_URL is set (e.g. http://docling-service:8000).
Falls back to the local DoclingService when unset.

The remote service exposes:
    POST /convert        — synchronous: upload PDF, wait, get markdown + metadata
    POST /convert/async  — fire-and-forget, returns job_id
    GET  /jobs/{id}      — poll job status
    GET  /jobs/{id}/result — fetch result once done
    GET  /readiness      — VRAM / worker health check
"""

import asyncio
import json
import logging
import os
import shutil
import tarfile
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Optional, Union

import httpx

_log = logging.getLogger(__name__)


class DoclingRemoteClient:
    """
    Drop-in replacement for DoclingService.convert_document_to_markdown().

    Sends the PDF to the remote docling-service's /convert endpoint and
    returns the same dict shape that the local DoclingService returns,
    so OrganizedDocumentProcessor doesn't need to change.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout: float = 600.0,
        poll_interval: float = 3.0,
    ):
        self.base_url = (base_url or os.environ.get("DOCLING_SERVICE_URL", "")).rstrip("/")
        self.timeout = timeout
        self.poll_interval = poll_interval

        if not self.base_url:
            raise ValueError(
                "DoclingRemoteClient requires DOCLING_SERVICE_URL env var or base_url parameter"
            )

        _log.info(f"DoclingRemoteClient initialised → {self.base_url}")

    # ------------------------------------------------------------------
    # Public API — same signature as DoclingService
    # ------------------------------------------------------------------

    async def convert_document_to_markdown(
        self,
        source: Union[str, Path],
        source_type: str = "file",
        output_dir: Optional[Path] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """
        Upload the PDF to the remote docling-service and return the result.

        Returns the same dict shape as DoclingService.convert_document_to_markdown():
            {
                "success": True/False,
                "conversion_id": "...",
                "markdown_content": "...",
                "metadata": { ... },
                "error": "..." (on failure),
            }

        Also writes document.md and metadata.json to output_dir when provided,
        so the caller can sync them to blob storage.
        """
        source_path = Path(source)
        if not source_path.exists():
            return {
                "success": False,
                "error": f"Source file not found: {source}",
                "conversion_id": "",
                "metadata": {},
            }

        try:
            result = await self._call_sync_convert(source_path)
        except Exception as exc:
            _log.error(f"DoclingRemoteClient error: {exc}")
            return {
                "success": False,
                "error": str(exc),
                "conversion_id": "",
                "metadata": {},
            }

        if not result.get("success"):
            return {
                "success": False,
                "error": result.get("error", "Remote conversion failed"),
                "conversion_id": result.get("conversion_id", ""),
                "metadata": result.get("metadata", {}),
            }

        conversion_id = result["conversion_id"]
        markdown_content = result.get("markdown_content", "")
        metadata = result.get("metadata", {})

        # Persist to local output_dir so the caller can sync to blob
        if output_dir is None:
            output_dir = Path(tempfile.gettempdir()) / "summarization" / "docling-remote" / conversion_id
        output_dir.mkdir(parents=True, exist_ok=True)

        md_path = output_dir / "document.md"
        md_path.write_text(markdown_content, encoding="utf-8")

        meta_path = output_dir / "metadata.json"
        meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

        try:
            await self._download_artifact_bundle(conversion_id, output_dir)
        except Exception as exc:
            _log.warning(
                "DoclingRemoteClient bundle download failed for %s: %s",
                conversion_id,
                exc,
            )

        return {
            "success": True,
            "conversion_id": conversion_id,
            "markdown_path": str(md_path),
            "markdown_content": markdown_content,
            "metadata": metadata,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _call_sync_convert(self, source_path: Path) -> Dict[str, Any]:
        """POST the PDF to /convert and return parsed JSON."""
        async with httpx.AsyncClient(timeout=httpx.Timeout(self.timeout), follow_redirects=True) as client:
            with open(source_path, "rb") as f:
                _log.info(f"Uploading {source_path.name} to {self.base_url}/convert ...")
                t0 = time.perf_counter()
                resp = await client.post(
                    f"{self.base_url}/convert",
                    files={"file": (source_path.name, f, "application/pdf")},
                )
            elapsed = time.perf_counter() - t0

        if resp.status_code != 200:
            _log.error(
                f"Remote docling-service returned {resp.status_code}: {resp.text[:500]}"
            )
            return {
                "success": False,
                "error": f"HTTP {resp.status_code}: {resp.text[:300]}",
            }

        data = resp.json()
        _log.info(
            f"Remote conversion complete in {elapsed:.1f}s — "
            f"pages={data.get('metadata', {}).get('page_count', '?')}"
        )
        return data

    async def _download_artifact_bundle(self, conversion_id: str, output_dir: Path) -> None:
        """Download and extract the full conversion artifact bundle into output_dir."""
        bundle_url = f"{self.base_url}/artifacts/{conversion_id}/bundle"
        output_dir.mkdir(parents=True, exist_ok=True)
        bundle_path = output_dir / f"{conversion_id}.tar.gz"
        extract_root = output_dir / "__bundle_extract__"

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(self.timeout), follow_redirects=True
        ) as client:
            _log.info("Downloading Docling artifact bundle %s", bundle_url)
            resp = await client.get(bundle_url)

        if resp.status_code != 200:
            raise RuntimeError(
                f"Artifact bundle download failed: HTTP {resp.status_code}: {resp.text[:300]}"
            )

        bundle_path.write_bytes(resp.content)
        if extract_root.exists():
            shutil.rmtree(extract_root)
        extract_root.mkdir(parents=True, exist_ok=True)

        with tarfile.open(bundle_path, "r:gz") as tar:
            tar.extractall(path=extract_root)

        extracted_dir = extract_root / conversion_id
        source_dir = extracted_dir if extracted_dir.exists() else extract_root

        for child in source_dir.iterdir():
            target = output_dir / child.name
            if target.exists():
                if target.is_dir():
                    shutil.rmtree(target)
                else:
                    target.unlink()
            shutil.move(str(child), str(target))

        shutil.rmtree(extract_root, ignore_errors=True)
        try:
            bundle_path.unlink(missing_ok=True)
        except Exception:
            pass


    async def convert_async(self, source_path: Path) -> Dict[str, Any]:
        """
        POST /convert/async — fire-and-forget, returns job_id.
        Then poll /jobs/{job_id} until done or error.
        """
        async with httpx.AsyncClient(timeout=httpx.Timeout(self.timeout)) as client:
            with open(source_path, "rb") as f:
                resp = await client.post(
                    f"{self.base_url}/convert/async",
                    files={"file": (source_path.name, f, "application/pdf")},
                )

            if resp.status_code != 200:
                return {
                    "success": False,
                    "error": f"HTTP {resp.status_code}: {resp.text[:300]}",
                }

            job_data = resp.json()
            job_id = job_data["job_id"]
            _log.info(f"Async job submitted: {job_id}")

            # Poll until done
            deadline = time.monotonic() + self.timeout
            while time.monotonic() < deadline:
                await asyncio.sleep(self.poll_interval)
                status_resp = await client.get(f"{self.base_url}/jobs/{job_id}")
                if status_resp.status_code != 200:
                    continue
                status = status_resp.json()
                if status["status"] == "done":
                    result_resp = await client.get(f"{self.base_url}/jobs/{job_id}/result")
                    return result_resp.json()
                if status["status"] == "error":
                    return {
                        "success": False,
                        "error": status.get("metadata", {}).get("error_message", "Unknown error"),
                        "conversion_id": job_id,
                    }

            return {"success": False, "error": "Timed out waiting for async job", "conversion_id": job_id}

    async def check_health(self) -> Dict[str, Any]:
        """Check if the remote docling-service is available."""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
                resp = await client.get(f"{self.base_url}/readiness")
                if resp.status_code == 200:
                    return {"healthy": True, **resp.json()}
                return {"healthy": False, "status_code": resp.status_code}
        except Exception as exc:
            return {"healthy": False, "error": str(exc)}
