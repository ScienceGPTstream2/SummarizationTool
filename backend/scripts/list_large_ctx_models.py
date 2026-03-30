#!/usr/bin/env python3
"""
List MacBook Ollama models by context window size.

Queries /api/show for each model and exports two CSVs:
  <prefix>_above_32k.csv  — models with context window > 32k
  <prefix>_below_32k.csv  — models with context window <= 32k or unknown

Usage:
    python backend/scripts/list_large_ctx_models.py
    python backend/scripts/list_large_ctx_models.py --models macbookmodelnames.csv
    python backend/scripts/list_large_ctx_models.py --base-url http://macbook2.sciencegpt.ca --output-prefix results

Environment Variables:
    MACBOOK_LLM_BASE_URL: Override the default base URL
"""

import argparse
import csv
import json
import os
import re
import sys
from pathlib import Path
from typing import List, Optional, Tuple

import requests

# =============================================================================
# Constants
# =============================================================================

DEFAULT_BASE_URL = "http://macbook1.sciencegpt.ca"
CONTEXT_THRESHOLD = 32768  # 32k tokens

EXPECTED_MODELS: List[str] = [
    # 3B - 4B
    "llama3.2:3b-instruct-fp16",
    "llama3.2:3b-instruct-q4_K_M",
    "MedAIBase/MedGemma1.5:4b",
    "phi4-mini:3.8b",
    "phi3.5:3.8b",
    "nemotron-mini:4b-instruct-q4_K_M",
    "nemotron-mini:4b-instruct-fp16",
    "nemotron-mini:4b-instruct-q8_0",
    # 7B - 8B
    "llama3.1:8b",
    "llama3.1:8b-instruct-q4_K_M",
    "dolphin-llama3:8b",
    "openbiollm-llama-3:8b-q8_0",
    "openbiollm-llama-3:8b-q6_k",
    "Mistral-7B-Instruct-v0.3-Q4_K_M:latest",
    "qwen3:8b-q4_K_M",
    "rnj-1:8b",
    # 12B - 14B
    "ministral-3:14b-instruct-2512-q4_K_M",
    "mistral-nemo:12b",
    "mistral-nemo:12b-instruct-2407-q3_K_M",
    "gemma3:12b",
    "qwen3:14b-q4_K_M",
    "phi4-reasoning:14b",
    # 20B - 24B
    "mistral-small3.1:24b",
    "gpt-o3:20b",
    # 27B - 32B
    "gemma3:27b-it-qat",
    "gemma3:27b-it-q4_K_M",
    "gemma2:27b",
    "qwen3:30b-a3b-q4_K_M",
    "qwen2.5:32b",
    "nemotron-3-nano:30b",
    "olmo-2:32b-think-q4_K_M",
    # 70B+
    "llama3.3:70b-instruct-q2_K",
    "llama3.1:70b-instruct-q2_k",
    "llama3.1:70b",
    "openbiollm-llama-3:70b_q4_k_m",
    "mistral-large:123b",
    "nemotron:70b-instruct-q3_K_M",
    "nemotron:70b-instruct-q2_K",
]


# =============================================================================
# Model loading
# =============================================================================


def load_models(csv_path: Optional[str]) -> List[str]:
    """Load model list from CSV or fall back to EXPECTED_MODELS."""
    if csv_path and Path(csv_path).exists():
        try:
            csv_text = Path(csv_path).read_text(encoding="utf-8")

            def _norm(s: str) -> str:
                return s.lower().replace("-", "").replace(":", "").replace("_", "")

            csv_norm = _norm(csv_text)
            matched = [m for m in EXPECTED_MODELS if _norm(m) in csv_norm]
            if matched:
                print(f"Loaded {len(matched)} models from {csv_path}")
                return matched
        except Exception as exc:
            print(f"Warning: could not parse {csv_path}: {exc}")

    print(f"Using built-in EXPECTED_MODELS list ({len(EXPECTED_MODELS)} models)")
    return list(EXPECTED_MODELS)


# =============================================================================
# Ollama API helper
# =============================================================================


def fetch_context_window(
    session: requests.Session, base_url: str, model: str, timeout: int = 30
) -> Tuple[Optional[int], str, Optional[str]]:
    """Query /api/show and extract the model's reported context window.

    Returns (ctx_tokens, field_name_used, error_str).
    """
    url = f"{base_url}/api/show"
    try:
        resp = session.post(url, json={"name": model}, timeout=timeout)
        if not resp.ok:
            return None, "", f"HTTP {resp.status_code}: {resp.text[:200]}"
        data = resp.json()
    except requests.exceptions.RequestException as exc:
        return None, "", str(exc)
    except json.JSONDecodeError as exc:
        return None, "", f"JSON decode error: {exc}"

    model_info = data.get("model_info", {})

    # 1. llama.context_length (most common for GGUF Llama-family models)
    val = model_info.get("llama.context_length")
    if val is not None:
        try:
            return int(val), "model_info.llama.context_length", None
        except (ValueError, TypeError):
            pass

    # 2. generic context_length key in model_info
    val = model_info.get("context_length")
    if val is not None:
        try:
            return int(val), "model_info.context_length", None
        except (ValueError, TypeError):
            pass

    # 3. Scan all model_info keys that contain "context"
    for key, v in model_info.items():
        if "context" in key.lower() and v is not None:
            try:
                return int(v), f"model_info.{key}", None
            except (ValueError, TypeError):
                pass

    # 4. parameters block (dict or string)
    params = data.get("parameters")
    if isinstance(params, dict):
        val = params.get("num_ctx")
        if val is not None:
            try:
                return int(val), "parameters.num_ctx (dict)", None
            except (ValueError, TypeError):
                pass
    elif isinstance(params, str):
        match = re.search(r"num_ctx\s*=?\s*(\d+)", params, re.IGNORECASE)
        if match:
            return int(match.group(1)), "parameters num_ctx (string)", None

    # 5. modelfile parameters section
    modelfile = data.get("modelfile", "")
    if modelfile:
        match = re.search(r"PARAMETER\s+num_ctx\s+(\d+)", modelfile, re.IGNORECASE)
        if match:
            return int(match.group(1)), "modelfile PARAMETER num_ctx", None

    return None, "", "no context field found in /api/show response"


# =============================================================================
# Main
# =============================================================================


def main() -> None:
    parser = argparse.ArgumentParser(
        description="List Ollama models by context window size and export two CSVs."
    )
    parser.add_argument("--models", default=None, help="Path to macbookmodelnames.csv")
    parser.add_argument(
        "--base-url",
        default=None,
        help=f"Ollama base URL (default: {DEFAULT_BASE_URL})",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="Per-request timeout in seconds (default: 30)",
    )
    parser.add_argument(
        "--output-prefix",
        default="ctx_filter",
        help="Prefix for output CSV files (default: ctx_filter)",
    )
    args = parser.parse_args()

    base_url = (
        args.base_url or os.environ.get("MACBOOK_LLM_BASE_URL", DEFAULT_BASE_URL)
    ).rstrip("/")
    models = load_models(args.models)

    print(f"\nQuerying {len(models)} models at {base_url} ...\n")

    col_w = max(len(m) for m in models) + 2
    header = f"{'MODEL':<{col_w}}  {'CTX':>10}  {'FIELD':<40}  STATUS"
    print(header)
    print("-" * len(header))

    above: list = []
    below: list = []

    with requests.Session() as session:
        for model in models:
            ctx, field, error = fetch_context_window(
                session, base_url, model, args.timeout
            )
            if ctx is not None and ctx > CONTEXT_THRESHOLD:
                status = "PASS"
                above.append(
                    {"model": model, "context_window": ctx, "field_used": field}
                )
            else:
                status = "FAIL" if ctx is not None else "UNKNOWN"
                below.append(
                    {
                        "model": model,
                        "context_window": ctx,
                        "field_used": field,
                        "error": error or "",
                    }
                )

            ctx_str = str(ctx) if ctx is not None else "?"
            field_str = (field[:38] + "..") if len(field) > 40 else field
            print(f"{model:<{col_w}}  {ctx_str:>10}  {field_str:<40}  {status}")

    print()

    above_path = f"{args.output_prefix}_above_32k.csv"
    below_path = f"{args.output_prefix}_below_32k.csv"

    with open(above_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["model", "context_window", "field_used"])
        writer.writeheader()
        writer.writerows(above)

    with open(below_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["model", "context_window", "field_used", "error"]
        )
        writer.writeheader()
        writer.writerows(below)

    print(f"Wrote {len(above)} models  →  {above_path}")
    print(f"Wrote {len(below)} models  →  {below_path}")


if __name__ == "__main__":
    main()
