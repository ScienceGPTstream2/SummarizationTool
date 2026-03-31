#!/usr/bin/env python3
"""
test_ollama_extraction.py
=========================
Quick benchmark: send a sample extraction prompt to each Ollama model
and measure response time + output quality.

Usage:
    python backend/scripts/test_ollama_extraction.py
    python backend/scripts/test_ollama_extraction.py --model qwen2.5:14b-instruct-q4_K_M
    python backend/scripts/test_ollama_extraction.py --base-url https://ollama-gpu.victoriousground-76a2ccdc.eastus.azurecontainerapps.io
"""

import argparse
import json
import sys
import time
import requests
from pathlib import Path

# ── Defaults ─────────────────────────────────────────────────────────────────

DEFAULT_BASE_URL = "https://ollama-gpu.victoriousground-76a2ccdc.eastus.azurecontainerapps.io"

SAMPLE_MARKDOWN = """
## Study Summary

This was a two-generation reproductive toxicity study in Sprague-Dawley rats.
Tebuconazole was administered in the diet at concentrations of 0, 100, 300,
and 1000 ppm (approximately 0, 7, 21, and 70 mg/kg bw/day) for 10 weeks
prior to mating and through two generations.

**Parental toxicity:** At 1000 ppm, decreased body weight gain (12-15%) and
food consumption were observed in both sexes. Liver weights were increased
at ≥300 ppm. NOAEL for parental toxicity: 100 ppm (7 mg/kg bw/day).

**Reproductive toxicity:** At 1000 ppm, fertility index was reduced (82% vs 95%
in controls), and pup weights at PND 21 were decreased by 18%. Pup survival
index (PND 0-4) was 89% at 1000 ppm vs 97% in controls.
NOAEL for reproductive toxicity: 300 ppm (21 mg/kg bw/day).

**Offspring toxicity:** Decreased pup body weights observed at ≥300 ppm during
lactation. Delayed vaginal opening noted at 1000 ppm (PND 35 vs PND 32 in
controls). NOAEL for offspring toxicity: 100 ppm (7 mg/kg bw/day).
"""

EXTRACTION_PROMPT = """Extract the following entity from the study text provided.
Return ONLY the extracted value, no explanation.

Entity: NOAEL for parental toxicity
Instructions: Extract the No Observed Adverse Effect Level (NOAEL) for parental
toxicity. Include the dose value and units (mg/kg bw/day)."""


# ── Helpers ──────────────────────────────────────────────────────────────────

def fetch_models(base_url: str, timeout: int = 15) -> list:
    """Fetch available models from /api/tags."""
    url = f"{base_url}/api/tags"
    try:
        resp = requests.get(url, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        return [m.get("name") or m.get("model") for m in data.get("models", [])]
    except Exception as e:
        print(f"❌ Failed to fetch models from {url}: {e}")
        return []


def run_extraction(base_url: str, model: str, prompt: str, timeout: int = 300) -> dict:
    """Send extraction prompt to Ollama and return result + timing."""
    url = f"{base_url}/api/generate"
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "temperature": 0.0,
    }

    start = time.time()
    try:
        resp = requests.post(url, json=payload, timeout=timeout)
        elapsed = time.time() - start

        if not resp.ok:
            return {
                "model": model,
                "success": False,
                "error": f"HTTP {resp.status_code}: {resp.text[:200]}",
                "elapsed": elapsed,
            }

        data = resp.json()
        content = data.get("response", "").strip()
        prompt_tokens = data.get("prompt_eval_count", 0)
        completion_tokens = data.get("eval_count", 0)
        total_duration_ns = data.get("total_duration", 0)
        eval_duration_ns = data.get("eval_duration", 0)

        return {
            "model": model,
            "success": True,
            "content": content,
            "elapsed": elapsed,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_duration_s": total_duration_ns / 1e9 if total_duration_ns else None,
            "eval_duration_s": eval_duration_ns / 1e9 if eval_duration_ns else None,
            "tokens_per_sec": (
                completion_tokens / (eval_duration_ns / 1e9)
                if eval_duration_ns
                else None
            ),
        }
    except Exception as e:
        elapsed = time.time() - start
        return {
            "model": model,
            "success": False,
            "error": str(e),
            "elapsed": elapsed,
        }


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Benchmark Ollama extraction")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Ollama base URL")
    parser.add_argument("--model", default=None, help="Specific model to test (default: all)")
    parser.add_argument("--timeout", type=int, default=300, help="Request timeout in seconds")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")

    # Health check
    print(f"🔍 Checking Ollama at {base_url} ...")
    try:
        resp = requests.get(base_url, timeout=10)
        print(f"   ✅ {resp.text.strip()}")
    except Exception as e:
        print(f"   ❌ Not reachable: {e}")
        sys.exit(1)

    # Get models
    if args.model:
        models = [args.model]
    else:
        models = fetch_models(base_url)
        if not models:
            print("❌ No models found. Is the service running?")
            sys.exit(1)

    print(f"\n📋 Models to test: {', '.join(models)}")

    # Build full prompt
    full_prompt = (
        f"<markdown study>\n{SAMPLE_MARKDOWN.strip()}\n</markdown study>\n\n"
        f"Prompt:\n{EXTRACTION_PROMPT.strip()}"
    )

    # Run tests
    results = []
    for model in models:
        print(f"\n{'='*60}")
        print(f"🧪 Testing: {model}")
        print(f"{'='*60}")

        result = run_extraction(base_url, model, full_prompt, timeout=args.timeout)
        results.append(result)

        if result["success"]:
            print(f"   ✅ Response ({result['elapsed']:.1f}s):")
            print(f"   📝 {result['content'][:200]}")
            if result.get("tokens_per_sec"):
                print(f"   ⚡ {result['tokens_per_sec']:.1f} tok/s")
            print(f"   📊 Prompt tokens: {result.get('prompt_tokens', '?')}, "
                  f"Completion tokens: {result.get('completion_tokens', '?')}")
        else:
            print(f"   ❌ Failed ({result['elapsed']:.1f}s): {result.get('error', 'unknown')}")

    # Summary
    print(f"\n{'='*60}")
    print("📊 SUMMARY")
    print(f"{'='*60}")
    print(f"{'Model':<40} {'Time':>8} {'Tok/s':>8} {'Status':>8}")
    print("-" * 68)
    for r in results:
        status = "✅" if r["success"] else "❌"
        tok_s = f"{r['tokens_per_sec']:.1f}" if r.get("tokens_per_sec") else "N/A"
        print(f"{r['model']:<40} {r['elapsed']:>7.1f}s {tok_s:>8} {status:>8}")

    # Expected answer check
    print(f"\n🎯 Expected answer: '100 ppm (7 mg/kg bw/day)' or similar")
    for r in results:
        if r["success"]:
            content_lower = r["content"].lower()
            has_value = "100" in content_lower and ("7" in content_lower or "ppm" in content_lower)
            quality = "✅ CORRECT" if has_value else "⚠️ CHECK"
            print(f"   {r['model']}: {quality} → {r['content'][:100]}")


if __name__ == "__main__":
    main()
