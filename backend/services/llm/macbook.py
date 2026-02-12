import os
import asyncio
import time
import re
from typing import Dict, Any, Optional, List
from datetime import datetime
import requests
import toml
from pathlib import Path
import json
import fnmatch


class MacbookLLMClient:
    def __init__(self):
        self.base_url = os.environ.get("MACBOOK_LLM_BASE_URL", "").rstrip("/")
        if not self.base_url:
            self.base_url = self._load_base_url_from_secrets()
        self.base_url = (self.base_url or "").rstrip("/")
        self.disabled = not bool(self.base_url)

        # Default: suppress reasoning/thinking output from Ollama-compatible reasoning models.
        # Allow override with MACBOOK_DISABLE_REASONING=false if you explicitly want reasoning tokens.
        disable_reasoning_env = os.environ.get("MACBOOK_DISABLE_REASONING", "true").lower()
        self.disable_reasoning = disable_reasoning_env not in ["false", "0", "no", "off"]

        # Retry/backoff controls (tunable via env). Enforce minimum 600s timeouts.
        self.max_attempts = int(os.environ.get("MACBOOK_MAX_ATTEMPTS", 5))
        self.initial_backoff = float(os.environ.get("MACBOOK_INITIAL_BACKOFF", 1.0))
        self.max_backoff = float(os.environ.get("MACBOOK_MAX_BACKOFF", 8.0))
        self.per_attempt_timeout = max(
            600.0, float(os.environ.get("MACBOOK_PER_ATTEMPT_TIMEOUT", 30.0))
        )
        self.total_retry_cap = max(
            600.0, float(os.environ.get("MACBOOK_TOTAL_RETRY_CAP", 60.0))
        )

        if self.disabled:
            print("[MacbookLLM] MACBOOK_LLM_BASE_URL is not set; Macbook LLM disabled")
        else:
            print(f"[MacbookLLM] Using base URL: {self.base_url}")

        # Allow-all-except-deny: the model policy file controls exclusions. No hardcoded allowlist.

        # Caching & resilience
        self._tags_cache: List[Dict[str, Any]] = []
        self._tags_cache_ts: float = 0.0
        self._tags_cache_ttl_seconds = (
            120  # reuse tags for 2 minutes to avoid hammering
        )

        # Soft failure tracking (no hard circuit breaker to avoid eager aborts)
        self._fail_count: int = 0

    def _normalize_model_name(self, model: str) -> str:
        return (model or "").strip().lower()

    def _strip_quantization_suffix(self, model: str) -> str:
        normalized = self._normalize_model_name(model)
        if not normalized:
            return ""
        parts = normalized.split("-")
        for idx, part in enumerate(parts):
            if part.startswith("q") and "_" in part:
                return "-".join(parts[:idx])
            if part.startswith("fp"):
                return "-".join(parts[:idx])
        return normalized

    def _load_base_url_from_secrets(self) -> Optional[str]:
        try:
            secrets_path = Path(__file__).resolve().parents[2] / "core" / "secrets.toml"
            if not secrets_path.exists():
                return None
            data = toml.load(secrets_path)
            base_url = data.get("macbook_llm_base_url")
            if not base_url:
                macbook_section = data.get("Macbook") or {}
                if isinstance(macbook_section, dict):
                    base_url = macbook_section.get("macbook_llm_base_url")
            if base_url:
                os.environ.setdefault("MACBOOK_LLM_BASE_URL", base_url)
                print(f"[MacbookLLM] Loaded base URL from secrets.toml: {base_url}")
            return base_url
        except Exception as exc:
            print(f"[MacbookLLM] Failed to read secrets.toml for base URL: {exc}")
            return None

    def _load_model_policy(self) -> Dict[str, Any]:
        try:
            policy_path = (
                Path(__file__).resolve().parents[2]
                / "config"
                / "macbook_model_policy.json"
            )
            if not policy_path.exists():
                return {"deny": []}
            with open(policy_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            if not isinstance(payload, dict):
                return {"deny": []}
            deny = payload.get("deny", [])
            allow = payload.get("allow", [])
            if isinstance(deny, list):
                deny = [self._normalize_model_name(m) for m in deny if m]
            else:
                deny = []
            if isinstance(allow, list):
                allow = [self._normalize_model_name(m) for m in allow if m]
            else:
                allow = []
            return {"deny": deny, "allow": allow}
        except Exception as exc:
            print(f"[MacbookLLM] Failed to read model policy: {exc}")
            return {"deny": []}

    def _matches_policy(self, model_name: str, policy: Dict[str, Any]) -> bool:
        normalized = self._normalize_model_name(model_name)
        deny_patterns = policy.get("deny", [])
        allow_patterns = policy.get("allow", [])

        for pattern in deny_patterns:
            if fnmatch.fnmatch(normalized, pattern):
                return False
        if allow_patterns:
            return any(
                fnmatch.fnmatch(normalized, pattern) for pattern in allow_patterns
            )
        return True

    def _format_prompt(self, system_message: Optional[str], user_prompt: str) -> str:
        if system_message:
            return f"{system_message}\n\n{user_prompt}"
        return user_prompt

    def _build_request_payload(
        self,
        model: str,
        prompt: str,
        temperature: float,
        max_tokens: int,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        # For reasoning models (e.g., DeepSeek-R1 / GPT-OSS builds), ask for final answer only.
        if self.disable_reasoning:
            payload["options"] = {
                "reasoning": False,
                "thinking": False,
            }

        return payload

    async def fetch_available_models(self) -> List[Dict[str, Any]]:
        if self.disabled:
            print("[MacbookLLM] fetch_available_models skipped; client disabled")
            return []

        # Return cached tags if still fresh
        now = time.time()
        if (
            self._tags_cache
            and now - self._tags_cache_ts < self._tags_cache_ttl_seconds
        ):
            return self._tags_cache

        url = f"{self.base_url}/api/tags"
        try:
            # Allow up to 600s to accommodate slow /tags responses
            resp = await asyncio.to_thread(lambda: requests.get(url, timeout=600))
            if not resp.ok:
                print(
                    f"[MacbookLLM] /api/tags failed: status={resp.status_code} body={resp.text}"
                )
                return []
            payload = resp.json()
        except Exception:
            print("[MacbookLLM] Failed to fetch /api/tags")
            # Fallback to cached tags if available
            if self._tags_cache:
                print("[MacbookLLM] Using cached tags after fetch failure")
                return self._tags_cache
            return []

        models = payload.get("models", []) if isinstance(payload, dict) else []
        policy = self._load_model_policy()
        filtered = []
        skipped = []
        for model in models:
            raw_name = model.get("name") or model.get("model") or ""
            normalized = self._normalize_model_name(raw_name)
            base_name = self._strip_quantization_suffix(raw_name)

            # Enforce deny/allow policy only (allow-all-except-deny)
            if not self._matches_policy(normalized, policy) or not self._matches_policy(
                base_name, policy
            ):
                skipped.append(raw_name)
                continue

            filtered.append(
                {
                    "id": raw_name,
                    "name": raw_name,
                    "provider": "Macbook LLM",
                }
            )

        print(
            f"[MacbookLLM] /api/tags returned {len(models)} model(s); "
            f"filtered={len(filtered)} skipped={len(skipped)}"
        )
        if skipped:
            print(f"[MacbookLLM] Skipped models: {', '.join(skipped)}")

        # Update cache on success
        self._tags_cache = filtered
        self._tags_cache_ts = time.time()
        return filtered

    async def check_health(self) -> bool:
        """Lightweight health check for the Macbook LLM service.

        Uses /api/tags with a strict timeout to avoid blocking the UI. Returns
        False on any error or non-200 response.
        """
        if self.disabled:
            return False

        url = f"{self.base_url}/api/tags"
        try:
            resp = await asyncio.to_thread(lambda: requests.get(url, timeout=600))
            if not resp.ok:
                print(
                    f"[MacbookLLM] health check failed: status={resp.status_code} body={resp.text}"
                )
                return False
            return True
        except Exception as exc:
            print(f"[MacbookLLM] health check exception: {exc}")
            return False

    async def _call_macbook_api(
        self,
        model_id: str,
        prompt: str,
        max_tokens: int = 4096,
        temperature: float = 0.0,
    ) -> Dict[str, Any]:
        if self.disabled:
            return {"success": False, "error": "Macbook LLM is not configured."}

        url = f"{self.base_url}/api/generate"
        payload = self._build_request_payload(model_id, prompt, temperature, max_tokens)

        # Retry with bounded exponential backoff for transient 5xx/HTML gateway errors/non-JSON
        attempts = 0
        last_error: Optional[str] = None
        start_time = time.time()
        prompt_len = len(prompt or "")
        backoff = self.initial_backoff

        while attempts < self.max_attempts:
            attempts += 1
            try:
                start = time.time()
                resp = await asyncio.to_thread(
                    lambda: requests.post(
                        url, json=payload, timeout=self.per_attempt_timeout
                    )
                )
                elapsed = time.time() - start
                print(
                    f"[MacbookLLM] attempt={attempts}/{self.max_attempts} model={model_id} "
                    f"prompt_len={prompt_len} max_tokens={max_tokens} temp={temperature} "
                    f"status={resp.status_code} elapsed={elapsed:.2f}s"
                )
            except Exception as e:
                last_error = f"Macbook request failed: {str(e)}"
                self._fail_count += 1
                print(
                    f"[MacbookLLM] attempt={attempts}/{self.max_attempts} model={model_id} "
                    f"prompt_len={prompt_len} error={last_error}"
                )
            else:
                is_json = False
                raw = None
                if resp.ok:
                    try:
                        raw = resp.json()
                        is_json = True
                    except Exception:
                        last_error = "Invalid JSON response from Macbook LLM"
                        self._fail_count += 1
                    else:
                        # Reset breaker on success
                        self._fail_count = 0
                        content = (
                            raw.get("response")
                            or raw.get("content")
                            or raw.get("text")
                            or ""
                        )
                        content = self._sanitize_content(content)
                        duration = time.time() - start_time
                        return {
                            "success": True,
                            "content": content,
                            "raw": raw,
                            "meta": {
                                "timestamp": datetime.utcnow().isoformat(),
                                "model": model_id,
                                "duration": duration,
                                "prompt_tokens": raw.get("prompt_eval_count"),
                                "completion_tokens": raw.get("eval_count"),
                            },
                        }

                # Non-200 or non-JSON success: classify
                body_text = resp.text if hasattr(resp, "text") else ""
                status = resp.status_code
                is_retryable = False

                # Retry on gateway/5xx or non-JSON HTML bodies that look like Cloudflare/Nginx
                if 500 <= status < 600:
                    is_retryable = True
                elif not is_json:
                    if "<html" in body_text.lower() or "bad gateway" in body_text.lower():
                        is_retryable = True

                last_error = f"Macbook request failed ({status}): {body_text[:200]}"
                elapsed_total = time.time() - start_time
                print(
                    f"[MacbookLLM] non-success attempt={attempts}/{self.max_attempts} model={model_id} "
                    f"prompt_len={prompt_len} status={status} elapsed_total={elapsed_total:.2f}s retryable={is_retryable}"
                )
                if is_retryable:
                    self._fail_count += 1
                else:
                    return {"success": False, "error": last_error}

            # Backoff before retry with jitter; cap total elapsed
            elapsed_total = time.time() - start_time
            if elapsed_total >= self.total_retry_cap:
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, self.max_backoff)
        # After retries exhausted
        total_duration = time.time() - start_time
        print(
            f"[MacbookLLM] exhausted retries model={model_id} prompt_len={prompt_len} "
            f"attempts={attempts} last_error={last_error} total_elapsed={total_duration:.2f}s"
        )
        return {"success": False, "error": last_error or "Macbook request failed"}

    def _sanitize_content(self, content: str) -> str:
        """Remove think/analysis tags sometimes emitted by local models.

        Keeps user-facing text intact while stripping agent markup like
        </thinking>, </end_of_turn>, and paired <thinking>...</thinking> blocks.
        """

        if not content:
            return content

        # Remove closing tags and paired blocks
        patterns = [
            # Paired blocks (allow attributes in opening tag) — strip these first
            r"<thinking[^>]*>[\s\S]*?</thinking>",
            r"<analysis[^>]*>[\s\S]*?</analysis>",
            r"<reflection[^>]*>[\s\S]*?</reflection>",
            r"<think[^>]*>[\s\S]*?</think>",
            # Stray openings/closings
            r"</end_of_turn>",
            r"</thinking>",
            r"</analysis>",
            r"</reflection>",
            r"</think>",
            r"<thinking[^>]*>",
            r"<analysis[^>]*>",
            r"<reflection[^>]*>",
            r"<think[^>]*>",
        ]

        sanitized = content
        for pat in patterns:
            sanitized = re.sub(pat, "", sanitized, flags=re.IGNORECASE)

        # Collapse extra whitespace created by removals
        sanitized = re.sub(r"\n{3,}", "\n\n", sanitized)
        return sanitized.strip()

    async def extract_entities_with_macbook(
        self,
        markdown: str,
        extraction_prompt: str,
        model_id: Optional[str] = None,
        max_tokens: int = 4096,
        temperature: float = 0.0,
        system_message: Optional[str] = None,
    ) -> Dict[str, Any]:
        used_model = model_id or ""
        prompt = self._format_prompt(
            system_message,
            f"<markdown study>\n{markdown}\n</markdown study>\n\nPrompt:\n{extraction_prompt}",
        )

        return await self._call_macbook_api(
            model_id=used_model,
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=temperature,
        )

    async def generate_paragraph_with_macbook(
        self,
        user_prompt: str,
        model_id: Optional[str] = None,
        max_tokens: int = 4096,
        temperature: float = 0.0,
        system_message: Optional[str] = None,
    ) -> Dict[str, Any]:
        used_model = model_id or ""
        prompt = self._format_prompt(system_message, user_prompt)
        return await self._call_macbook_api(
            model_id=used_model,
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=temperature,
        )
