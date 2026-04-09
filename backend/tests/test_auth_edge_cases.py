#!/usr/bin/env python3
"""
Auth Edge Case Tests — runs against the LIVE backend.

Tests token validation, expired/invalid tokens, missing headers,
and ensures every protected endpoint rejects unauthenticated requests.

Usage:
  export AUTH_TOKEN_A="<valid-token>"
  export BACKEND_URL="http://localhost:8001"
  python3 -m pytest tests/test_auth_edge_cases.py -v -s
"""

import os
import requests
import unittest

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
AUTH_TOKEN_A = os.environ.get("AUTH_TOKEN_A", "")
TIMEOUT = 10


def _authed(token: str = AUTH_TOKEN_A) -> requests.Session:
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    s.headers["Authorization"] = f"Bearer {token}"
    return s


def _unauthed() -> requests.Session:
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    return s


class TestNoAuthHeader(unittest.TestCase):
    """Every protected endpoint must return 401/403 without auth."""

    PROTECTED_ENDPOINTS = [
        ("GET", "/api/sessions"),
        ("POST", "/api/sessions"),
        ("GET", "/api/groups"),
        ("POST", "/api/groups"),
        ("GET", "/api/templates"),
        ("GET", "/api/sessions/shared/list"),
        ("GET", "/api/models"),
    ]

    def test_all_protected_endpoints_reject_no_auth(self):
        """Every protected endpoint must reject requests without Authorization header."""
        http = _unauthed()
        failures = []
        for method, path in self.PROTECTED_ENDPOINTS:
            url = f"{BACKEND_URL}{path}"
            if method == "GET":
                resp = http.get(url, timeout=TIMEOUT)
            else:
                resp = http.post(url, json={}, timeout=TIMEOUT)
            if resp.status_code not in (401, 403, 422):
                failures.append(f"{method} {path} → {resp.status_code} (expected 401/403)")
        self.assertEqual(failures, [], f"Unprotected endpoints found:\n" + "\n".join(failures))


class TestInvalidTokens(unittest.TestCase):
    """Various invalid token formats must be rejected."""

    def test_empty_bearer_token(self):
        """Bearer with empty token → 401."""
        http = _authed("")
        resp = http.get(f"{BACKEND_URL}/api/sessions", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (401, 403))

    def test_garbage_token(self):
        """Random garbage string → 401."""
        http = _authed("this-is-not-a-valid-token-at-all")
        resp = http.get(f"{BACKEND_URL}/api/sessions", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (401, 403))

    def test_truncated_token(self):
        """First 5 chars of a valid token → 401."""
        if not AUTH_TOKEN_A:
            self.skipTest("No AUTH_TOKEN_A set")
        http = _authed(AUTH_TOKEN_A[:5])
        resp = http.get(f"{BACKEND_URL}/api/sessions", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (401, 403))

    def test_token_with_spaces(self):
        """Token with embedded spaces → 401."""
        http = _authed("token with spaces in it")
        resp = http.get(f"{BACKEND_URL}/api/sessions", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (401, 403))

    def test_sql_injection_in_token(self):
        """SQL injection attempt in token → 401 (not 500)."""
        http = _authed("' OR 1=1 --")
        resp = http.get(f"{BACKEND_URL}/api/sessions", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (401, 403),
                      f"SQL injection token returned {resp.status_code}, expected 401/403")

    def test_very_long_token(self):
        """Extremely long token → 401 (not crash)."""
        http = _authed("A" * 10000)
        resp = http.get(f"{BACKEND_URL}/api/sessions", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (401, 403, 413, 431),
                      f"Very long token returned {resp.status_code}")


class TestValidTokenWorks(unittest.TestCase):
    """Sanity check: valid token works on all key endpoints."""

    @classmethod
    def setUpClass(cls):
        if not AUTH_TOKEN_A:
            raise unittest.SkipTest("AUTH_TOKEN_A not set")

    def test_sessions_list(self):
        resp = _authed().get(f"{BACKEND_URL}/api/sessions", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)

    def test_groups_list(self):
        resp = _authed().get(f"{BACKEND_URL}/api/groups", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)

    def test_templates_list(self):
        resp = _authed().get(f"{BACKEND_URL}/api/templates", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)

    def test_models_list(self):
        resp = _authed().get(f"{BACKEND_URL}/api/models", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (200, 503))  # 503 if no LLM configured


if __name__ == "__main__":
    unittest.main(verbosity=2)
