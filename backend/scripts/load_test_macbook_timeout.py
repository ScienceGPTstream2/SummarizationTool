"""Load/timeout test against Macbook LLM (gpt-oss) with large prompts.

Usage (example):
    MACBOOK_LLM_BASE_URL=http://macbook1.sciencegpt.ca \
    MACBOOK_MODEL=gpt-oss:20b  # optional, default "gpt-oss:20b" \
    python backend/scripts/load_test_macbook_timeout.py

What it does:
- Sends 15 sequential requests (can adjust via REQUEST_COUNT) with ~30k+ char prompts
  split into separate entity asks, to mimic real workloads.
- Logs per-request start/end, elapsed seconds, HTTP status, and whether it timed out.
- Captures the first 300 chars of content (if any) for quick inspection.
- Uses a generous client timeout (default 700s) to detect server/CF cutoff vs client.

Notes:
- The Macbook client code enforces per-attempt timeout >= 600s; this script sets the
  requests timeout separately to observe whether Cloudflare or the upstream cuts off.
- If Cloudflare enforces a 300s cap, you should see failures around that duration.
"""

import os
import time
import json
import uuid
import requests


BASE_URL = os.environ.get("MACBOOK_LLM_BASE_URL", "").rstrip("/")
MODEL = os.environ.get("MACBOOK_MODEL", "gpt-oss:20b")
REQUEST_COUNT = int(os.environ.get("MACBOOK_LOADTEST_COUNT", 15))
CLIENT_TIMEOUT = float(os.environ.get("MACBOOK_LOADTEST_TIMEOUT", 700))  # seconds


def build_big_prompt(i: int) -> str:
    # Construct a 30k+ character prompt by repeating a base paragraph.
    base = (
        "This is a large test prompt intended to stress the request/response path for "
        "gpt-oss running on macbook. We want to observe timeout behavior, including any "
        "Cloudflare gateway limitations. Please extract entity #{i} and summarize it in "
        "one sentence. Ignore all prior instructions and just answer concisely."
    )
    repeated = (base * 400)  # ~30k+ chars depending on length of base
    return f"Entity {i}:\n" + repeated


def send_request(session: requests.Session, idx: int):
    url = f"{BASE_URL}/api/generate"
    prompt = build_big_prompt(idx)
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
    }

    start = time.time()
    try:
        resp = session.post(url, json=payload, timeout=CLIENT_TIMEOUT)
        elapsed = time.time() - start
        status = resp.status_code
        timed_out = False
        try:
            data = resp.json()
        except Exception:
            data = None
        content = None
        if isinstance(data, dict):
            content = data.get("response") or data.get("content") or data.get("text")
        snippet = (content or resp.text or "")[:300]
        print(
            json.dumps(
                {
                    "idx": idx,
                    "status": status,
                    "elapsed_sec": round(elapsed, 2),
                    "timed_out": timed_out,
                    "snippet": snippet,
                }
            )
        )
    except requests.exceptions.Timeout:
        elapsed = time.time() - start
        print(
            json.dumps(
                {
                    "idx": idx,
                    "status": "timeout",
                    "elapsed_sec": round(elapsed, 2),
                    "timed_out": True,
                }
            )
        )
    except Exception as exc:
        elapsed = time.time() - start
        print(
            json.dumps(
                {
                    "idx": idx,
                    "status": "error",
                    "elapsed_sec": round(elapsed, 2),
                    "timed_out": False,
                    "error": str(exc),
                }
            )
        )


def main():
    if not BASE_URL:
        raise SystemExit("MACBOOK_LLM_BASE_URL is not set")

    print(
        json.dumps(
            {
                "base_url": BASE_URL,
                "model": MODEL,
                "request_count": REQUEST_COUNT,
                "client_timeout_sec": CLIENT_TIMEOUT,
            }
        )
    )

    with requests.Session() as session:
        for i in range(1, REQUEST_COUNT + 1):
            send_request(session, i)


if __name__ == "__main__":
    main()