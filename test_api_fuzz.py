"""Schemathesis: generate requests for every endpoint from the OpenAPI schema and
fail on any 5xx. Catches crashes on inputs nobody thinks to write by hand
(it found a UTF-8 header crash and a divide-by-zero in /ecg/synthetic).

The model calls are mocked; MP_FUZZ_EXAMPLES raises the depth for local runs.
"""
import json
import os
from unittest.mock import patch

import pytest
import schemathesis
from hypothesis import HealthCheck, settings
from schemathesis.checks import not_a_server_error

import main
from test_main import MOCK_REPORT

schema = schemathesis.openapi.from_asgi("/openapi.json", main.app)


@pytest.fixture(autouse=True)
def _offline(tmp_path, monkeypatch):
    monkeypatch.setenv("TURSO_DATABASE_URL", f"file:{tmp_path / 'fuzz.db'}")
    with patch("main.call_claude", lambda system, user_message, **k: json.dumps(MOCK_REPORT) if system == main.REPORT_SYSTEM else "ok"), \
         patch("main.call_claude_with_image", lambda *a, **k: json.dumps(MOCK_REPORT)), \
         patch("main._chat_via_claude", lambda system, messages: ("answer", 1)):
        yield


@schema.parametrize()
@settings(max_examples=int(os.environ.get("MP_FUZZ_EXAMPLES", 25)), deadline=None,
          suppress_health_check=list(HealthCheck))
def test_no_endpoint_returns_a_server_error(case):
    case.call_and_validate(checks=[not_a_server_error])
