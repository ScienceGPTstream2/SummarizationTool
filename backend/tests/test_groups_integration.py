#!/usr/bin/env python3
"""
Groups Integration Tests — runs against the LIVE backend.

Tests group CRUD, membership management, and group-based sharing.

Usage:
  export AUTH_TOKEN_A="<token>" AUTH_TOKEN_B="<token>"
  export BACKEND_URL="http://localhost:8001"
  python3 -m pytest tests/test_groups_integration.py -v -s
"""

import os
import uuid
import requests
import unittest

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
AUTH_TOKEN_A = os.environ.get("AUTH_TOKEN_A", "")
AUTH_TOKEN_B = os.environ.get("AUTH_TOKEN_B", "")
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
    for label, http, var in [("A", _http_a, "_user_a_id"), ("B", _http_b, "_user_b_id")]:
        resp = http.post(f"{BACKEND_URL}/api/sessions",
                         json={"name": f"_probe_{label}", "user_id": "probe"}, timeout=TIMEOUT)
        if resp.ok:
            data = resp.json()
            globals()[var] = data.get("user_id", "")
            sid = data.get("session_id")
            if sid:
                http.delete(f"{BACKEND_URL}/api/sessions/{sid}", timeout=TIMEOUT)


class TestGroupCRUD(unittest.TestCase):
    """Basic group create, read, update, delete."""

    @classmethod
    def setUpClass(cls):
        _setup()

    def test_01_create_group(self):
        name = f"Test Group {uuid.uuid4().hex[:6]}"
        resp = _http_a.post(f"{BACKEND_URL}/api/groups",
                            json={"name": name}, timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 201, f"Create group failed: {resp.text}")
        data = resp.json()
        self.__class__.group_id = data.get("id") or data.get("group_id")
        self.assertTrue(self.group_id)

    def test_02_list_groups_contains_new_group(self):
        resp = _http_a.get(f"{BACKEND_URL}/api/groups", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)
        group_ids = [g.get("id") or g.get("group_id") for g in resp.json()]
        self.assertIn(self.group_id, group_ids)

    def test_03_get_group_by_id(self):
        resp = _http_a.get(f"{BACKEND_URL}/api/groups/{self.group_id}", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)

    def test_04_update_group_name(self):
        resp = _http_a.put(f"{BACKEND_URL}/api/groups/{self.group_id}",
                           json={"name": "Updated Name"}, timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)

    def test_05_delete_group(self):
        resp = _http_a.delete(f"{BACKEND_URL}/api/groups/{self.group_id}", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (200, 204))
        # Verify gone
        resp2 = _http_a.get(f"{BACKEND_URL}/api/groups/{self.group_id}", timeout=TIMEOUT)
        self.assertIn(resp2.status_code, (403, 404))


class TestGroupMembership(unittest.TestCase):
    """Add, update, remove members."""

    @classmethod
    def setUpClass(cls):
        _setup()
        resp = _http_a.post(f"{BACKEND_URL}/api/groups",
                            json={"name": f"Membership Test {uuid.uuid4().hex[:6]}"},
                            timeout=TIMEOUT)
        resp.raise_for_status()
        cls.group_id = resp.json().get("id") or resp.json().get("group_id")

    @classmethod
    def tearDownClass(cls):
        _http_a.delete(f"{BACKEND_URL}/api/groups/{cls.group_id}", timeout=TIMEOUT)

    def test_01_add_member(self):
        resp = _http_a.post(f"{BACKEND_URL}/api/groups/{self.group_id}/members",
                            json={"user_id": _user_b_id}, timeout=TIMEOUT)
        self.assertIn(resp.status_code, (200, 201), f"Add member failed: {resp.text}")

    def test_02_list_members(self):
        resp = _http_a.get(f"{BACKEND_URL}/api/groups/{self.group_id}/members",
                           timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)
        members = resp.json()
        member_ids = [m.get("user_id") for m in members]
        self.assertIn(_user_b_id, member_ids)

    def test_03_member_can_see_group(self):
        resp = _http_b.get(f"{BACKEND_URL}/api/groups", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)
        group_ids = [g.get("id") or g.get("group_id") for g in resp.json()]
        self.assertIn(self.group_id, group_ids)

    def test_04_add_duplicate_member(self):
        """Adding same member again should be idempotent or return error, not crash."""
        resp = _http_a.post(f"{BACKEND_URL}/api/groups/{self.group_id}/members",
                            json={"user_id": _user_b_id}, timeout=TIMEOUT)
        self.assertNotEqual(resp.status_code, 500,
                            f"Duplicate member caused 500: {resp.text}")

    def test_05_non_owner_cannot_delete_group(self):
        """Member (User B) cannot delete the group."""
        resp = _http_b.delete(f"{BACKEND_URL}/api/groups/{self.group_id}", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404),
                      f"Non-owner deleted group! Status: {resp.status_code}")

    def test_06_remove_member(self):
        resp = _http_a.delete(
            f"{BACKEND_URL}/api/groups/{self.group_id}/members/{_user_b_id}",
            timeout=TIMEOUT)
        self.assertIn(resp.status_code, (200, 204))

    def test_07_removed_member_cannot_see_group(self):
        resp = _http_b.get(f"{BACKEND_URL}/api/groups/{self.group_id}", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404))


class TestGroupNonExistent(unittest.TestCase):
    """Operations on non-existent groups should return clean errors."""

    @classmethod
    def setUpClass(cls):
        _setup()

    def test_get_nonexistent_group(self):
        fake = str(uuid.uuid4())
        resp = _http_a.get(f"{BACKEND_URL}/api/groups/{fake}", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404))

    def test_delete_nonexistent_group(self):
        fake = str(uuid.uuid4())
        resp = _http_a.delete(f"{BACKEND_URL}/api/groups/{fake}", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404))

    def test_add_member_to_nonexistent_group(self):
        fake = str(uuid.uuid4())
        resp = _http_a.post(f"{BACKEND_URL}/api/groups/{fake}/members",
                            json={"user_id": _user_b_id}, timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404))


class TestGroupSharing(unittest.TestCase):
    """End-to-end: create group → share session → member can see it."""

    @classmethod
    def setUpClass(cls):
        _setup()
        # Create group
        resp = _http_a.post(f"{BACKEND_URL}/api/groups",
                            json={"name": f"Share E2E {uuid.uuid4().hex[:6]}"},
                            timeout=TIMEOUT)
        resp.raise_for_status()
        cls.group_id = resp.json().get("id") or resp.json().get("group_id")

        # Add user B
        _http_a.post(f"{BACKEND_URL}/api/groups/{cls.group_id}/members",
                     json={"user_id": _user_b_id}, timeout=TIMEOUT)

        # Create session
        resp = _http_a.post(f"{BACKEND_URL}/api/sessions",
                            json={"name": "Group Share E2E", "user_id": _user_a_id},
                            timeout=TIMEOUT)
        resp.raise_for_status()
        cls.session_id = resp.json()["session_id"]

    @classmethod
    def tearDownClass(cls):
        _http_a.delete(f"{BACKEND_URL}/api/sessions/{cls.session_id}/share", timeout=TIMEOUT)
        _http_a.delete(f"{BACKEND_URL}/api/sessions/{cls.session_id}", timeout=TIMEOUT)
        _http_a.delete(f"{BACKEND_URL}/api/groups/{cls.group_id}", timeout=TIMEOUT)

    def test_01_share_session_with_group(self):
        resp = _http_a.post(f"{BACKEND_URL}/api/sessions/{self.session_id}/share",
                            json={"group_id": self.group_id}, timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200, f"Share failed: {resp.text}")

    def test_02_member_sees_in_shared_list(self):
        resp = _http_b.get(f"{BACKEND_URL}/api/sessions/shared/list", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)
        shared = resp.json().get("sessions", [])
        shared_ids = [s["session_id"] for s in shared]
        self.assertIn(self.session_id, shared_ids,
                      f"Shared session not in member's shared list")

    def test_03_member_can_load_shared_session(self):
        resp = _http_b.get(f"{BACKEND_URL}/api/sessions/{self.session_id}", timeout=TIMEOUT)
        self.assertEqual(resp.status_code, 200)

    def test_04_unshare_removes_access(self):
        _http_a.delete(f"{BACKEND_URL}/api/sessions/{self.session_id}/share", timeout=TIMEOUT)
        resp = _http_b.get(f"{BACKEND_URL}/api/sessions/{self.session_id}", timeout=TIMEOUT)
        self.assertIn(resp.status_code, (403, 404))


if __name__ == "__main__":
    unittest.main(verbosity=2)
