"""Optional cloud sync: workspace isolation, CRUD, disabled mode, Turso HTTP format."""
import io
import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import cloud_store
import main

KEY_A = "a" * 40
KEY_B = "b" * 40


def _rec(id_, name="Patient", n=1, ts="2026-10-01T00:00:00Z"):
    return {"so_benh_an": id_, "ho_ten": name, "ten_hien_thi": None, "nhom_benh": "AF",
            "so_lan_cap_nhat": n, "tao_luc": ts, "cap_nhat_luc": ts,
            "report": {"thong_tin_benh_nhan": {"so_benh_an": id_}}, "history": [], "chat": []}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TURSO_DATABASE_URL", f"file:{tmp_path / 'cloud.db'}")
    monkeypatch.delenv("TURSO_AUTH_TOKEN", raising=False)
    return TestClient(main.app)


def test_status_reports_enabled(client):
    assert client.get("/cloud/status").json() == {"enabled": True}


def test_status_reports_disabled_without_database(monkeypatch):
    monkeypatch.delenv("TURSO_DATABASE_URL", raising=False)
    c = TestClient(main.app)
    assert c.get("/cloud/status").json() == {"enabled": False}
    assert c.get("/cloud/records", headers={"X-Workspace": KEY_A}).status_code == 503


def test_put_get_list_delete_roundtrip(client):
    h = {"X-Workspace": KEY_A}
    assert client.put("/cloud/records/BA-1", json=_rec("BA-1", "Jane"), headers=h).status_code == 200
    assert client.get("/cloud/records/BA-1", headers=h).json()["record"]["ho_ten"] == "Jane"
    rows = client.get("/cloud/records", headers=h).json()["records"]
    assert [r["so_benh_an"] for r in rows] == ["BA-1"]
    assert client.delete("/cloud/records/BA-1", headers=h).status_code == 200
    assert client.get("/cloud/records/BA-1", headers=h).status_code == 404


def test_upsert_keeps_one_row_and_latest_data(client):
    h = {"X-Workspace": KEY_A}
    client.put("/cloud/records/BA-1", json=_rec("BA-1", n=1), headers=h)
    client.put("/cloud/records/BA-1", json=_rec("BA-1", n=3, ts="2026-10-05T00:00:00Z"), headers=h)
    rows = client.get("/cloud/records", headers=h).json()["records"]
    assert len(rows) == 1 and rows[0]["so_lan_cap_nhat"] == 3


def test_workspaces_are_isolated(client):
    client.put("/cloud/records/BA-1", json=_rec("BA-1"), headers={"X-Workspace": KEY_A})
    assert client.get("/cloud/records", headers={"X-Workspace": KEY_B}).json()["records"] == []
    assert client.get("/cloud/records/BA-1", headers={"X-Workspace": KEY_B}).status_code == 404


def test_sync_key_is_never_stored(client, tmp_path):
    client.put("/cloud/records/BA-1", json=_rec("BA-1"), headers={"X-Workspace": KEY_A})
    raw = (tmp_path / "cloud.db").read_bytes()
    assert KEY_A.encode() not in raw


@pytest.mark.parametrize("key", [None, "short", "has spaces " * 5, "x" * 200])
def test_invalid_sync_key_rejected(client, key):
    headers = {"X-Workspace": key} if key else {}
    assert client.get("/cloud/records", headers=headers).status_code == 401


def test_body_must_match_url(client):
    r = client.put("/cloud/records/BA-2", json=_rec("BA-1"), headers={"X-Workspace": KEY_A})
    assert r.status_code == 400


def test_turso_http_request_and_response_format(monkeypatch):
    sent = {}

    class Resp(io.BytesIO):
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def fake_urlopen(req, timeout):
        sent["url"], sent["auth"], sent["body"] = req.full_url, req.headers["Authorization"], json.loads(req.data)
        payload = {"results": [{"type": "ok", "response": {"type": "execute", "result": {
            "cols": [{"name": "so_benh_an"}, {"name": "so_lan_cap_nhat"}, {"name": "ho_ten"}],
            "rows": [[{"type": "text", "value": "BA-1"}, {"type": "integer", "value": "2"}, {"type": "null"}]]}}},
            {"type": "ok", "response": {"type": "close"}}]}
        return Resp(json.dumps(payload).encode())

    with patch("cloud_store.urllib.request.urlopen", fake_urlopen):
        rows = cloud_store._TursoHttp("libsql://db-user.turso.io", "tok").execute("SELECT 1 WHERE x = ?", ("v",))
    assert sent["url"] == "https://db-user.turso.io/v2/pipeline"
    assert sent["auth"] == "Bearer tok"
    assert sent["body"]["requests"][0]["stmt"]["args"] == [{"type": "text", "value": "v"}]
    assert rows == [{"so_benh_an": "BA-1", "so_lan_cap_nhat": 2, "ho_ten": None}]


def test_record_numbers_with_slashes(client):
    h = {"X-Workspace": KEY_A}
    assert client.put("/cloud/records/25%2F0196", json=_rec("25/0196"), headers=h).status_code == 200
    assert client.get("/cloud/records/25%2F0196", headers=h).json()["record"]["so_benh_an"] == "25/0196"
    assert client.delete("/cloud/records/25%2F0196", headers=h).status_code == 200
