"""Stateless record merge, rate limiting, and the no-login/no-storage contract."""
import io
import json

import pytest
from fastapi.testclient import TestClient

import main
import report_merge
from test_main import MOCK_REPORT, mock_anthropic  # noqa: F401  (fixture re-export)


@pytest.fixture
def client():
    return TestClient(main.app)


# ─── merge_reports (pure) ──────────────────────────────────────────────────
def test_merge_appends_timeline_and_dedupes():
    old = {"xet_nghiem_key": [{"ngay": "01/01", "ten": "INR", "gia_tri": 2.1}]}
    new = {"xet_nghiem_key": [{"ngay": "01/01", "ten": "INR", "gia_tri": 2.1},
                              {"ngay": "02/02", "ten": "INR", "gia_tri": 3.4}]}
    merged = report_merge.merge_reports(old, new)
    assert len(merged["xet_nghiem_key"]) == 2


def test_merge_does_not_mutate_inputs():
    old = {"chan_doan_chinh": "A", "xet_nghiem_key": []}
    snapshot = json.dumps(old)
    report_merge.merge_reports(old, {"chan_doan_chinh": "B", "xet_nghiem_key": [{"x": 1}]})
    assert json.dumps(old) == snapshot


def test_merge_keeps_old_value_when_new_is_empty():
    merged = report_merge.merge_reports({"chan_doan_chinh": "A"}, {"chan_doan_chinh": ""})
    assert merged["chan_doan_chinh"] == "A"


def test_latest_prescription_wins():
    merged = report_merge.merge_reports({"thuoc_cuoi_ky": ["old"]}, {"thuoc_cuoi_ky": ["new"]})
    assert merged["thuoc_cuoi_ky"] == ["new"]


# ─── /records/merge endpoints ──────────────────────────────────────────────
def test_merge_text_endpoint_returns_merged_report_and_analysis(client, mock_anthropic):
    resp = client.post("/records/merge", json={
        "existing_report": MOCK_REPORT,
        "ho_so_text": "Tái khám: INR 2.5, tiếp tục Acenocoumarol.",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "report" in data and "analysis" in data


def test_merge_text_rejects_empty_document(client):
    resp = client.post("/records/merge", json={"existing_report": MOCK_REPORT, "ho_so_text": "  "})
    assert resp.status_code == 400


def test_merge_file_rejects_invalid_existing_report(client):
    resp = client.post("/records/merge-file",
                       data={"existing_report": "not json"},
                       files={"file": ("a.docx", io.BytesIO(b"x"), "application/octet-stream")})
    assert resp.status_code == 400


# ─── No login, no server-side storage ──────────────────────────────────────
def test_endpoints_need_no_auth_header(client, mock_anthropic):
    resp = client.post("/analyze_text", json={"ho_so_text": "x" * 500})
    assert resp.status_code == 200


@pytest.mark.parametrize("method,path", [
    ("get", "/me"), ("get", "/lich-su"), ("get", "/patient"),
    ("post", "/patient/save"), ("post", "/patient/update"), ("post", "/feedback"),
])
def test_storage_and_account_endpoints_are_gone(client, method, path):
    assert getattr(client, method)(path).status_code in (404, 405)


# ─── Rate limiting ─────────────────────────────────────────────────────────
def test_rate_limit_returns_429_with_retry_after(client, monkeypatch, mock_anthropic):
    monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 2)
    main._rate_buckets.clear()
    body = {"question": "hi", "assistant_type": "system", "ho_so_text": "", "chat_history": []}
    assert client.post("/chat", json=body).status_code == 200
    assert client.post("/chat", json=body).status_code == 200
    blocked = client.post("/chat", json=body)
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) > 0
    main._rate_buckets.clear()


def test_rate_limit_is_per_client_ip(client, monkeypatch, mock_anthropic):
    monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 1)
    main._rate_buckets.clear()
    body = {"question": "hi", "assistant_type": "system", "ho_so_text": "", "chat_history": []}
    assert client.post("/chat", json=body, headers={"x-forwarded-for": "1.1.1.1"}).status_code == 200
    assert client.post("/chat", json=body, headers={"x-forwarded-for": "2.2.2.2"}).status_code == 200
    main._rate_buckets.clear()


def test_health_is_not_rate_limited(client, monkeypatch):
    monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 1)
    main._rate_buckets.clear()
    for _ in range(5):
        assert client.get("/health").status_code == 200


# ─── Language ──────────────────────────────────────────────────────────────
def _last_system_text(log):
    system = log[-1]["system"]
    return system[0]["text"] if isinstance(system, list) else system


def test_chat_answers_in_english_when_ui_is_english(client, mock_anthropic):
    body = {"question": "INR?", "ho_so_text": "INR 2.5", "chat_history": []}
    assert client.post("/chat", json=body, headers={"X-Lang": "en"}).status_code == 200
    assert "Always answer in English" in _last_system_text(mock_anthropic)


def test_chat_defaults_to_vietnamese(client, mock_anthropic):
    body = {"question": "INR?", "ho_so_text": "INR 2.5", "chat_history": []}
    client.post("/chat", json=body)
    assert "tiếng Việt" in _last_system_text(mock_anthropic)


# ─── Report extraction follows the selected language ───────────────────────
def test_report_extraction_in_english_when_ui_is_english(client, mock_anthropic):
    resp = client.post("/analyze_text", json={"ho_so_text": "x" * 500}, headers={"X-Lang": "en"})
    assert resp.status_code == 200
    assert "OUTPUT LANGUAGE: ENGLISH" in _last_system_text(mock_anthropic[:1])


def test_report_extraction_in_vietnamese_by_default(client, mock_anthropic):
    client.post("/analyze_text", json={"ho_so_text": "x" * 500})
    assert all("OUTPUT LANGUAGE: ENGLISH" not in _last_system_text([c]) for c in mock_anthropic)


def test_language_does_not_leak_between_requests(client, mock_anthropic):
    client.post("/analyze_text", json={"ho_so_text": "x" * 500}, headers={"X-Lang": "en"})
    mock_anthropic.clear()
    client.post("/analyze_text", json={"ho_so_text": "x" * 500})
    assert all("OUTPUT LANGUAGE: ENGLISH" not in _last_system_text([c]) for c in mock_anthropic)


def test_spoofed_forwarded_for_does_not_bypass_limit(client, monkeypatch, mock_anthropic):
    monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 1)
    main._rate_buckets.clear()
    body = {"question": "hi", "assistant_type": "system", "ho_so_text": "", "chat_history": []}
    # Same real client (last hop) with different fake first entries.
    assert client.post("/chat", json=body, headers={"x-forwarded-for": "1.1.1.1, 9.9.9.9"}).status_code == 200
    assert client.post("/chat", json=body, headers={"x-forwarded-for": "2.2.2.2, 9.9.9.9"}).status_code == 429
    main._rate_buckets.clear()
