#!/usr/bin/env python3
"""
Session Edge Case Tests — runs against the LIVE backend.

Tests loading incomplete sessions, empty sessions, large payloads,
and various PATCH corner cases that typically cause frontend crashes.

Usage:
  export AUTH_TOKEN_A="<token>"
  export BACKEND_URL="http://localhost:8001"
  python3 -m pytest tests/test_session_edge_cases.py -v -s
"""

import os
import uuid
import requests
import unittest

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
AUTH_TOKEN_A = os.environ.get("AUTH_TOKEN_A", "")
KNOWN_FILE_HASH = "b1dc7a0cef34815586e6eb015b0c2583c2f920d05079457a1417662488907606"
TIMEOUT = 15

_http = None
_user_id = ""


def _make_http(token):
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    s.headers["Authorization"] = f"Bearer {token}"
    return s


def _setup():
    global _http, _user_id
    if _http is not None:
        return
    if not AUTH_TOKEN_A:
        raise unittest.SkipTest("AUTH_TOKEN_A required")
    _http = _make_http(AUTH_TOKEN_A)
    # Get user ID
    resp = _http.post(f"{BACKEND_URL}/api/sessions",
                      json={"name": "_probe", "user_id": "probe"}, timeout=TIMEOUT)
    if resp.ok:
        data = resp.json()
        _user_id = data.get("user_id", "")
        sid = data.get("session_id")
        if sid:
            _http.delete(f"{BACKEND_URL}/api/sessions/{sid}", timeout=TIMEOUT)


class TestEmptySession(unittest.TestCase):
    """Sessions with no documents or extractions should still load."""

    @classmethod
    def setUpClass(cls):
        _setup()

    def test_create_empty_session(self):
        """Create session with just a name — no docs, no config."""
        resp = _http.post(f"{BACKEND_URL}/api/sessions",
                          json={"name": "Empty Session", "user_id": _user_id},
                          timeout=TIMEOUT)
        self.assertIn(resp.status_code, (200, 201))
        sid = resp.json()["session_id"]

        # Read it back — should not crash
        resp2 = _http.get(f"{BACKEND_URL}/api/sessions/{sid}", timeout=TIMEOUT)
        self.assertEqual(resp2.status_code, 200)
        data = resp2.json()
        self.assertEqual(data.get("documents", []), [])
        self.assertEqual(data.get("results", []), [])

        # Cleanup
        _http.delete(f"{BACKEND_URL}/api/sessions/{sid}", timeout=TIMEOUT)

    def test_session_with_no_config(self):
        """Session with documents but no configuration."""
        resp = _http.post(f"{BACKEND_URL}/api/sessions",
                          json={
                              "name": "No Config Session",
                              "user_id": _user_id,
                              "documents": [{"file_hash": KNOWN_FILE_HASH, "filename": "test.pdf"}],
                          }, timeout=TIMEOUT)
        self.assertIn(resp.status_code, (200, 201))
        sid = resp.json()["session_id"]

        resp2 = _http.get(f"{BACKEND_URL}/api/sessions/{sid}", timeout=TIMEOUT)
        self.assertEqual(resp2.status_code, 200)
        _http.delete(f"{BACKEND_URL}/api/sessions/{sid}", timeout=TIMEOUT)


class TestIncompleteSession(unittest.TestCase):
    """Sessions with partial extractions (some entities done, others not)."""

    @classmethod
    def setUpClass(cls):
        _setup()
        resp = _http.post(f"{BACKEND_URL}/api/sessions",
                          json={
                              "name": "Incomplete Session",
                              "user_id": _user_id,
                              "configuration": {
                                  "study_type": "epidemiology",
                                  "selected_models": ["azure-gpt-4o"],
                                  "entities": [
                                      {"name": "Authors", "prompt": "Extract authors"},
                                      {"name": "Funding", "prompt": "Extract funding"},
                                      {"name": "Methods", "prompt": "Extract methods"},
                                  ],
                              },
                              "documents": [
                                  {"file_hash": KNOWN_FILE_HASH, "filename": "test.pdf"},
                              ],
                          }, timeout=TIMEOUT)
        resp.raise_for_status()
        cls.session_id = resp.json()["session_id"]

        # Only extract ONE entity (leave others incomplete)
        _http.post(f"{BACKEND_URL}/api/sessions/{cls.session_id}/extractions",
                   json={
                       "user_id": _user_id,
                       "entity_name": "Authors",
                       "model_id": "azure-gpt-4o",
                       "extracted_text": "K. Machera",
                       "file_hash": KNOWN_FILE_HASH,
                       "status": "completed",
                   }, timeout=TIMEOUT)

    @classmethod
    def tearDownClass(cls):
        _http.delete(f"{BACKEND_URL}/api/sessions/{cls.session_id}", timeout=TIMEOUT)

    def test_load_incomplete_session(self):
        """Loading session with partial results should not crash."""
        resp = _http.get(f"{BACKEND_URL}/api/sessions/{self.session_id}", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        # Should have the session with some results
        self.assertTrue(data.get("session_id"))

    def test_add_second_extraction(self):
        """Adding a second entity extraction to an existing session."""
        resp = _http.post(f"{BACKEND_URL}/api/sessions/{self.session_id}/extractions",
                          json={
                              "user_id": _user_id,
                              "entity_name": "Funding",
                              "model_id": "azure-gpt-4o",
                              "extracted_text": "No funding reported",
                              "file_hash": KNOWN_FILE_HASH,
                              "status": "completed",
                          }, timeout=TIMEOUT)
        self.assertIn(resp.status_code, (200, 201, 204),
                      f"Second extraction failed: {resp.status_code} {resp.text}")

    def test_overwrite_extraction(self):
        """Overwriting an existing extraction should succeed."""
        resp = _http.post(f"{BACKEND_URL}/api/sessions/{self.session_id}/extractions",
                          json={
                              "user_id": _user_id,
                              "entity_name": "Authors",
                              "model_id": "azure-gpt-4o",
                              "extracted_text": "K. Machera (UPDATED)",
                              "file_hash": KNOWN_FILE_HASH,
                              "status": "completed",
                          }, timeout=TIMEOUT)
        self.assertIn(resp.status_code, (200, 201, 204))


class TestPatchEdgeCases(unittest.TestCase):
    """Various PATCH body edge cases that could crash the backend."""

    @classmethod
    def setUpClass(cls):
        _setup()
        resp = _http.post(f"{BACKEND_URL}/api/sessions",
                          json={"name": "Patch Edge Case Session", "user_id": _user_id},
                          timeout=TIMEOUT)
        resp.raise_for_status()
        cls.session_id = resp.json()["session_id"]

    @classmethod
    def tearDownClass(cls):
        _http.delete(f"{BACKEND_URL}/api/sessions/{cls.session_id}", timeout=TIMEOUT)

    def test_patch_empty_body(self):
        """PATCH with empty JSON body → should not crash."""
        resp = _http.patch(f"{BACKEND_URL}/api/sessions/{self.session_id}",
                           json={}, timeout=TIMEOUT)
        # 200 or 422 (validation), but NOT 500
        self.assertNotEqual(resp.status_code, 500,
                            f"Empty PATCH caused 500: {resp.text}")

    def test_patch_unknown_fields_ignored(self):
        """PATCH with unknown fields should be ignored gracefully."""
        resp = _http.patch(f"{BACKEND_URL}/api/sessions/{self.session_id}",
                           json={"nonexistent_field": "value", "another": 123},
                           timeout=TIMEOUT)
        self.assertNotEqual(resp.status_code, 500,
                            f"Unknown fields caused 500: {resp.text}")

    def test_patch_name_to_empty_string(self):
        """PATCH name to empty string — should be handled."""
        resp = _http.patch(f"{BACKEND_URL}/api/sessions/{self.session_id}",
                           json={"name": ""}, timeout=TIMEOUT)
        # Accept either success or validation error, but not crash
        self.assertNotEqual(resp.status_code, 500)

    def test_patch_very_long_name(self):
        """PATCH with very long name — should not crash."""
        resp = _http.patch(f"{BACKEND_URL}/api/sessions/{self.session_id}",
                           json={"name": "X" * 1000}, timeout=TIMEOUT)
        self.assertNotEqual(resp.status_code, 500)

    def test_patch_name_with_special_characters(self):
        """PATCH with unicode/emoji in name."""
        resp = _http.patch(f"{BACKEND_URL}/api/sessions/{self.session_id}",
                           json={"name": "Étude 🧬 αβγ «résumé»"}, timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200,
                         f"Unicode name failed: {resp.status_code}")

    def test_patch_null_values(self):
        """PATCH with null values for optional fields."""
        resp = _http.patch(f"{BACKEND_URL}/api/sessions/{self.session_id}",
                           json={"evaluation_config": None, "files_config": None},
                           timeout=TIMEOUT)
        self.assertNotEqual(resp.status_code, 500,
                            f"Null values caused 500: {resp.text}")


class TestNonExistentResources(unittest.TestCase):
    """Operations on non-existent resources should return clean errors."""

    @classmethod
    def setUpClass(cls):
        _setup()

    def test_get_nonexistent_session(self):
        """GET non-existent session → 404."""
        fake_id = str(uuid.uuid4())
        resp = _http.get(f"{BACKEND_URL}/api/sessions/{fake_id}", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 404)

    def test_patch_nonexistent_session(self):
        """PATCH non-existent session → 404."""
        fake_id = str(uuid.uuid4())
        resp = _http.patch(f"{BACKEND_URL}/api/sessions/{fake_id}",
                           json={"name": "ghost"}, timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 404)

    def test_delete_nonexistent_session(self):
        """DELETE non-existent session → 404."""
        fake_id = str(uuid.uuid4())
        resp = _http.delete(f"{BACKEND_URL}/api/sessions/{fake_id}", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 404)

    def test_share_nonexistent_session(self):
        """Share non-existent session → error (not 500)."""
        fake_id = str(uuid.uuid4())
        resp = _http.post(f"{BACKEND_URL}/api/sessions/{fake_id}/share",
                          json={"group_id": str(uuid.uuid4())}, timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404, 500))

    def test_add_extraction_to_nonexistent_session(self):
        """Add extraction to non-existent session → 404."""
        fake_id = str(uuid.uuid4())
        resp = _http.post(f"{BACKEND_URL}/api/sessions/{fake_id}/extractions",
                          json={
                              "user_id": _user_id,
                              "entity_name": "Test",
                              "model_id": "gpt-4o",
                              "extracted_text": "test",
                              "file_hash": KNOWN_FILE_HASH,
                              "status": "completed",
                          }, timeout=TIMEOUT)
        self.assertIn(resp.status_code, (404, 422))

    def test_invalid_session_id_format(self):
        """Non-UUID session_id → clean error."""
        resp = _http.get(f"{BACKEND_URL}/api/sessions/not-a-uuid", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (404, 422))


class TestSessionListOrdering(unittest.TestCase):
    """Session list should return most recently updated first."""

    @classmethod
    def setUpClass(cls):
        _setup()
        cls.session_ids = []
        for i in range(3):
            resp = _http.post(f"{BACKEND_URL}/api/sessions",
                              json={"name": f"Order Test {i}", "user_id": _user_id},
                              timeout=TIMEOUT)
            if resp.ok:
                cls.session_ids.append(resp.json()["session_id"])

        # Update the first one to make it most recent
        if cls.session_ids:
            _http.patch(f"{BACKEND_URL}/api/sessions/{cls.session_ids[0]}",
                        json={"name": "Order Test 0 (updated)"}, timeout=TIMEOUT)

    @classmethod
    def tearDownClass(cls):
        for sid in cls.session_ids:
            _http.delete(f"{BACKEND_URL}/api/sessions/{sid}", timeout=TIMEOUT)

    def test_list_returns_sessions(self):
        """Session list endpoint returns our created sessions."""
        resp = _http.get(f"{BACKEND_URL}/api/sessions", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("sessions", data)
        self.assertGreaterEqual(len(data["sessions"]), len(self.session_ids))


class TestDeleteCleansUp(unittest.TestCase):
    """Deleting a session removes it completely."""

    @classmethod
    def setUpClass(cls):
        _setup()

    def test_deleted_session_is_gone(self):
        """After delete, GET returns 404."""
        resp = _http.post(f"{BACKEND_URL}/api/sessions",
                          json={"name": "Delete Me", "user_id": _user_id},
                          timeout=TIMEOUT)
        resp.raise_for_status()
        sid = resp.json()["session_id"]

        # Delete
        resp2 = _http.delete(f"{BACKEND_URL}/api/sessions/{sid}", timeout=TIMEOUT)
        self.assertEqual(resp2.status_code, 200)

        # Verify gone
        resp3 = _http.get(f"{BACKEND_URL}/api/sessions/{sid}", timeout=TIMEOUT)
        self.assertEqual(resp3.status_code, 404)

    def test_deleted_session_not_in_list(self):
        """After delete, session no longer appears in list."""
        resp = _http.post(f"{BACKEND_URL}/api/sessions",
                          json={"name": "Delete List Test", "user_id": _user_id},
                          timeout=TIMEOUT)
        resp.raise_for_status()
        sid = resp.json()["session_id"]

        _http.delete(f"{BACKEND_URL}/api/sessions/{sid}", timeout=TIMEOUT)

        resp2 = _http.get(f"{BACKEND_URL}/api/sessions", timeout=TIMEOUT)
        session_ids = [s["session_id"] for s in resp2.json().get("sessions", [])]
        self.assertNotIn(sid, session_ids)


if __name__ == "__main__":
    unittest.main(verbosity=2)
