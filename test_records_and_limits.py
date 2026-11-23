"""Stateless record merge, rate limiting, and the no-login/no-storage contract."""
import io
import time
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


# ─── Abuse limits and robustness (public API, no login) ────────────────────
def test_upload_size_cap(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 1000)
    r = client.post("/analyze", files={"file": ("big.docx", io.BytesIO(b"x" * 2000), "application/octet-stream")})
    assert r.status_code == 413


def test_corrupt_pdf_returns_400_not_500(client):
    r = client.post("/analyze", files={"file": ("broken.pdf", io.BytesIO(b"not a pdf at all"), "application/pdf")})
    assert r.status_code == 400


def test_question_length_cap(client):
    body = {"question": "x" * (main.MAX_QUESTION_CHARS + 1), "assistant_type": "system", "ho_so_text": "", "chat_history": []}
    assert client.post("/chat", json=body).status_code == 413


def test_merge_text_is_capped_before_reaching_the_model(client, mock_anthropic):
    huge = "Tái khám. INR 2.5. " * 50_000          # ~950k chars
    r = client.post("/records/merge", json={"existing_report": MOCK_REPORT, "ho_so_text": huge})
    assert r.status_code == 200
    sent = mock_anthropic[0]["messages"][0]["content"]
    sent = sent if isinstance(sent, str) else sent[0]["text"]
    assert len(sent) <= main.MAX_TEXT_CHARS + 200


def test_chat_history_is_normalised_for_the_messages_api():
    hist = [
        {"role": "assistant", "content": "Hello, I'm MedAmi"},   # greeting first
        {"role": "user", "content": "a"}, {"role": "user", "content": "b"},
        {"role": "assistant", "content": "c"},
        {"role": "user", "content": "question already appended by the UI"},
    ]
    out = main._normalise_claude_history(hist)
    assert out[0]["role"] == "user"
    assert all(out[i]["role"] != out[i + 1]["role"] for i in range(len(out) - 1))
    assert out[-1]["role"] == "assistant"   # caller adds the new user question
    assert out[0]["content"] == "a\n\nb"


def test_rate_limit_buckets_are_pruned(monkeypatch):
    main._rate_buckets.clear()
    old = time.monotonic() - 10_000
    for i in range(5001):
        main._rate_buckets[f"ai:10.0.{i // 256}.{i % 256}"].append(old)
    main._check_bucket("ai:1.2.3.4", 30, 600)
    assert len(main._rate_buckets) < 10
    main._rate_buckets.clear()


def test_oversized_request_rejected_before_parsing(client, monkeypatch):
    r = client.post("/analyze_text", content=b"{}", headers={"Content-Type": "application/json",
                                                              "Content-Length": str(main.MAX_REQUEST_BYTES + 1)})
    assert r.status_code == 413


@pytest.mark.parametrize("bpm", [0, -5, 5000])
def test_synthetic_ecg_rejects_impossible_heart_rates(client, bpm):
    assert client.get(f"/ecg/synthetic?heart_rate_bpm={bpm}").status_code == 422


def test_ecg_rejects_decompression_bomb(client):
    import base64, struct, zlib
    w, h = 10000, 5000   # 50 megapixels (> 40M cap) in a tiny PNG
    raw = b"".join(b"\x00" + b"\xff" * w for _ in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    r = client.post("/ecg", json={"image_base64": base64.b64encode(png).decode()})
    assert r.status_code == 400


def test_non_utf8_language_header_does_not_crash_any_endpoint():
    # Found by Schemathesis: the language middleware decoded headers as UTF-8.
    raw = TestClient(main.app, raise_server_exceptions=False)
    r = raw.get("/health", headers={"X-Lang": "st chênh".encode("latin-1")})
    assert r.status_code == 200
