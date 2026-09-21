"""
conftest.py — Shared pytest fixtures for the entire test suite.

The main fixture here overrides FastAPI's `get_current_user` dependency so
that every endpoint guarded by Supabase auth returns a fake user dict instead
of hitting the real Supabase Auth API.  This lets the full test suite run
offline without SUPABASE_URL / SUPABASE_ANON_KEY configured.
"""

import os

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-real")

import pytest
import main
from auth import get_current_user

FAKE_USER = {
    "id": "test-user-00000000-0000-0000-0000-000000000000",
    "email": "test-doctor@medparcours.test",
    "token": "fake-supabase-token-for-tests",
    "raw": {},
}


@pytest.fixture(autouse=True)
def _override_auth():
    """Automatically override Supabase auth for every test.

    autouse=True means no test file needs to import or request this fixture
    explicitly — it just works.  The override is cleaned up after each test
    so one test's auth state never leaks into the next.
    """
    main.app.dependency_overrides[get_current_user] = lambda: FAKE_USER
    yield
    main.app.dependency_overrides.clear()
