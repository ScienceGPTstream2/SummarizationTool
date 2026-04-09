#!/usr/bin/env python3
"""
Cross-User Isolation Tests — runs against the LIVE backend.

Verifies that User A's data is invisible/inaccessible to User B
EXCEPT when explicitly shared via groups.

Usage:
  export AUTH_TOKEN_A="<token>" AUTH_TOKEN_B="<token>"
  export BACKEND_URL="http://localhost:8001"
  python3 -m pytest tests/test_cross_user_isolation.py -v -s
"""

import os
import uuid
import requests
import unittest

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
AUTH_TOKEN_A = os.environ.get("AUTH_TOKEN_A", "")
AUTH_TOKEN_B = os.environ.get("AUTH_TOKEN_B", "")
KNOWN_FILE_HASH = "b1dc7a0cef34815586e6eb015b0c2583c2f920d05079457a1417662488907606"
TIMEOUT = 10

_http_a = None
_http_b = None
_user_a_id = ""
_user_b_id = ""


def _make_http(token):
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    s.headers["Authorization"] = f"Bearer {token}"
    return s


def _setup():
    global _http_a, _http_b, _user_a_id, _user_b_id
    if _http_a is not None:
        return
    if not AUTH_TOKEN_A or not AUTH_TOKEN_B:
        raise unittest.SkipTest("AUTH_TOKEN_A and AUTH_TOKEN_B required")
    _http_a = _make_http(AUTH_TOKEN_A)
    _http_b = _make_http(AUTH_TOKEN_B)

    # Get user IDs
    for label, http, setter in [("A", _http_a, "_user_a_id"), ("B", _http_b, "_user_b_id")]:
        resp = http.post(f"{BACKEND_URL}/api/sessions",
                         json={"name": f"_probe_{label}", "user_id": "probe"}, timeout=TIMEOUT)
        if resp.ok:
            data = resp.json()
            globals()[setter] = data.get("user_id", "")
            sid = data.get("session_id")
            if sid:
                http.delete(f"{BACKEND_URL}/api/sessions/{sid}", timeout=TIMEOUT)


class TestSessionIsolation(unittest.TestCase):
    """User A's sessions are invisible to User B."""

    @classmethod
    def setUpClass(cls):
        _setup()
        # User A creates a private session
        resp = _http_a.post(f"{BACKEND_URL}/api/sessions",
                            json={"name": "Private A Session", "user_id": _user_a_id},
                            timeout=TIMEOUT)
        resp.raise_for_status()
        cls.session_a_id = resp.json()["session_id"]

    @classmethod
    def tearDownClass(cls):
        _http_a.delete(f"{BACKEND_URL}/api/sessions/{cls.session_a_id}", timeout=TIMEOUT)

    def test_user_b_cannot_list_user_a_sessions(self):
        """User A's sessions should NOT appear in User B's session list."""
        resp = _http_b.get(f"{BACKEND_URL}/api/sessions", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)
        sessions = resp.json().get("sessions", [])
        session_ids = [s["session_id"] for s in sessions]
        self.assertNotIn(self.session_a_id, session_ids,
                         "User A's private session appeared in User B's list!")

    def test_user_b_cannot_get_user_a_session(self):
        """User B should get 404 when requesting User A's private session."""
        resp = _http_b.get(f"{BACKEND_URL}/api/sessions/{self.session_a_id}", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404))

    def test_user_b_cannot_patch_user_a_session(self):
        """User B cannot rename User A's session."""
        resp = _http_b.patch(f"{BACKEND_URL}/api/sessions/{self.session_a_id}",
                             json={"name": "Hacked!"}, timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404))

    def test_user_b_cannot_delete_user_a_session(self):
        """User B cannot delete User A's session."""
        resp = _http_b.delete(f"{BACKEND_URL}/api/sessions/{self.session_a_id}", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404))

    def test_user_b_cannot_add_extraction_to_user_a_session(self):
        """User B cannot inject extractions into User A's session."""
        resp = _http_b.post(f"{BACKEND_URL}/api/sessions/{self.session_a_id}/extractions",
                            json={
                                "user_id": _user_b_id,
                                "entity_name": "Injected",
                                "model_id": "gpt-4o",
                                "extracted_text": "INJECTED DATA",
                                "file_hash": KNOWN_FILE_HASH,
                                "status": "completed",
                            }, timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404),
                      f"Extraction injection succeeded! Got {resp.status_code}")

    def test_user_b_cannot_add_evaluation_to_user_a_session(self):
        """User B cannot inject evaluations into User A's session."""
        resp = _http_b.post(f"{BACKEND_URL}/api/sessions/{self.session_a_id}/evaluations",
                            json={
                                "user_id": _user_b_id,
                                "entity_name": "Injected",
                                "model_id": "gpt-4o",
                                "scores": {"correctness": 1.0},
                                "file_hash": KNOWN_FILE_HASH,
                            }, timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404, 422),
                      f"Evaluation injection succeeded! Got {resp.status_code}")


class TestShareAndUnshare(unittest.TestCase):
    """Sharing grants read access; unsharing revokes it immediately."""

    @classmethod
    def setUpClass(cls):
        _setup()
        cls._cleanup = []

        # User A creates session
        resp = _http_a.post(f"{BACKEND_URL}/api/sessions",
                            json={"name": "Share Test Session", "user_id": _user_a_id,
                                  "documents": [{"file_hash": KNOWN_FILE_HASH, "filename": "test.pdf"}]},
                            timeout=TIMEOUT)
        resp.raise_for_status()
        cls.session_id = resp.json()["session_id"]

        # Create group and add User B
        resp = _http_a.post(f"{BACKEND_URL}/api/groups",
                            json={"name": f"Isolation Test Group {uuid.uuid4().hex[:6]}"},
                            timeout=TIMEOUT)
        if resp.ok:
            cls.group_id = resp.json().get("id") or resp.json().get("group_id")
            _http_a.post(f"{BACKEND_URL}/api/groups/{cls.group_id}/members",
                         json={"user_id": _user_b_id}, timeout=TIMEOUT)
        else:
            cls.group_id = None

    @classmethod
    def tearDownClass(cls):
        _http_a.delete(f"{BACKEND_URL}/api/sessions/{cls.session_id}", timeout=TIMEOUT)
        if cls.group_id:
            _http_a.delete(f"{BACKEND_URL}/api/groups/{cls.group_id}", timeout=TIMEOUT)

    def test_01_before_sharing_user_b_cannot_see(self):
        """Before sharing, User B cannot load User A's session."""
        # Unshare first in case previous test run left it shared
        _http_a.delete(f"{BACKEND_URL}/api/sessions/{self.session_id}/share", timeout=TIMEOUT)
        resp = _http_b.get(f"{BACKEND_URL}/api/sessions/{self.session_id}", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404),
                      f"User B saw unshared session! Status: {resp.status_code}")

    def test_02_after_sharing_user_b_can_read(self):
        """After sharing via group, User B can read the session."""
        if not self.group_id:
            self.skipTest("Group creation failed")
        # Share
        resp = _http_a.post(f"{BACKEND_URL}/api/sessions/{self.session_id}/share",
                            json={"group_id": self.group_id}, timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200, f"Share failed: {resp.text}")

        # User B reads
        resp = _http_b.get(f"{BACKEND_URL}/api/sessions/{self.session_id}", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200,
                         f"User B can't read shared session! Status: {resp.status_code}")

    def test_03_shared_session_user_b_still_cannot_modify(self):
        """Even after sharing, User B cannot modify the original session."""
        resp = _http_b.patch(f"{BACKEND_URL}/api/sessions/{self.session_id}",
                             json={"name": "Should Not Work"}, timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404),
                      f"User B modified shared session! Status: {resp.status_code}")

    def test_04_after_unshare_user_b_loses_access(self):
        """After unsharing, User B can no longer read the session."""
        resp = _http_a.delete(f"{BACKEND_URL}/api/sessions/{self.session_id}/share",
                              timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200, f"Unshare failed: {resp.text}")

        resp = _http_b.get(f"{BACKEND_URL}/api/sessions/{self.session_id}", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404),
                      f"User B still has access after unshare! Status: {resp.status_code}")

    def test_05_user_b_not_in_shared_list_after_unshare(self):
        """Unshared session should not appear in User B's shared sessions list."""
        resp = _http_b.get(f"{BACKEND_URL}/api/sessions/shared/list", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)
        shared = resp.json().get("sessions", [])
        shared_ids = [s["session_id"] for s in shared]
        self.assertNotIn(self.session_id, shared_ids,
                         "Unshared session still in User B's shared list!")


class TestGroupMembershipIsolation(unittest.TestCase):
    """Removing a user from a group revokes shared session access."""

    @classmethod
    def setUpClass(cls):
        _setup()
        # Create session
        resp = _http_a.post(f"{BACKEND_URL}/api/sessions",
                            json={"name": "Member Removal Test", "user_id": _user_a_id},
                            timeout=TIMEOUT)
        resp.raise_for_status()
        cls.session_id = resp.json()["session_id"]

        # Create group, add B, share session
        resp = _http_a.post(f"{BACKEND_URL}/api/groups",
                            json={"name": f"Member Test {uuid.uuid4().hex[:6]}"},
                            timeout=TIMEOUT)
        cls.group_id = None
        if resp.ok:
            cls.group_id = resp.json().get("id") or resp.json().get("group_id")
            _http_a.post(f"{BACKEND_URL}/api/groups/{cls.group_id}/members",
                         json={"user_id": _user_b_id}, timeout=TIMEOUT)
            _http_a.post(f"{BACKEND_URL}/api/sessions/{cls.session_id}/share",
                         json={"group_id": cls.group_id}, timeout=TIMEOUT)

    @classmethod
    def tearDownClass(cls):
        _http_a.delete(f"{BACKEND_URL}/api/sessions/{cls.session_id}", timeout=TIMEOUT)
        if cls.group_id:
            _http_a.delete(f"{BACKEND_URL}/api/groups/{cls.group_id}", timeout=TIMEOUT)

    def test_01_member_can_see_shared_session(self):
        """While a group member, User B can see the shared session."""
        if not self.group_id:
            self.skipTest("No group")
        resp = _http_b.get(f"{BACKEND_URL}/api/sessions/{self.session_id}", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)

    def test_02_after_removal_access_revoked(self):
        """After removing User B from group, they lose shared session access."""
        if not self.group_id:
            self.skipTest("No group")
        # Remove User B from group
        resp = _http_a.delete(
            f"{BACKEND_URL}/api/groups/{self.group_id}/members/{_user_b_id}",
            timeout=TIMEOUT)
        self.assertIn(resp.status_code, (200, 204),
                      f"Member removal failed: {resp.status_code}")

        # User B tries to read shared session
        resp = _http_b.get(f"{BACKEND_URL}/api/sessions/{self.session_id}", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404),
                      f"User B still has access after group removal! Status: {resp.status_code}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
