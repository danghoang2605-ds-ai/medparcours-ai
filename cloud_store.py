"""Optional cloud storage for patient records (Turso / libSQL, or local SQLite).

The app has no accounts. Each browser generates a random *sync key* and sends
it as the X-Workspace header; records are stored under SHA-256(sync key), so
the key itself is never stored and nobody can list another workspace without
it. Copying the key to another device opens the same records there.

Configuration (environment):
  TURSO_DATABASE_URL  libsql://<db>.turso.io  (or file:local.db for local dev)
  TURSO_AUTH_TOKEN    database token (not needed for file:)
If TURSO_DATABASE_URL is empty, cloud storage is disabled and the app keeps
records in the browser only.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import threading
import urllib.error
import urllib.request

WORKSPACE_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
MAX_RECORD_BYTES = 5 * 1024 * 1024

SCHEMA = """
CREATE TABLE IF NOT EXISTS mp_records (
  workspace      TEXT NOT NULL,
  so_benh_an     TEXT NOT NULL,
  ho_ten         TEXT,
  nhom_benh      TEXT,
  so_lan_cap_nhat INTEGER,
  tao_luc        TEXT,
  cap_nhat_luc   TEXT,
  data           TEXT NOT NULL,
  PRIMARY KEY (workspace, so_benh_an)
)
"""


class CloudError(RuntimeError):
    pass


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def workspace_id(sync_key: str) -> str:
    if not sync_key or not WORKSPACE_RE.match(sync_key):
        raise ValueError("Invalid or missing X-Workspace sync key.")
    return hashlib.sha256(sync_key.encode()).hexdigest()


# ─── transports ────────────────────────────────────────────────────────────
class _TursoHttp:
    """Minimal client for Turso's HTTP API (v2 pipeline). No native deps;
    libsql:// is rewritten to https:// because WebSockets are unreliable on
    Hugging Face Space containers."""

    def __init__(self, url: str, token: str):
        self.base = re.sub(r"^libsql://", "https://", url).rstrip("/")
        self.token = token

    @staticmethod
    def _arg(v):
        if v is None:
            return {"type": "null"}
        if isinstance(v, bool):
            v = int(v)
        if isinstance(v, int):
            return {"type": "integer", "value": str(v)}
        return {"type": "text", "value": str(v)}

    @staticmethod
    def _val(cell):
        t = cell.get("type")
        if t == "null":
            return None
        if t == "integer":
            return int(cell["value"])
        if t == "float":
            return float(cell["value"])
        return cell.get("value")

    def execute(self, sql: str, args=()):
        body = {"requests": [
            {"type": "execute", "stmt": {"sql": sql, "args": [self._arg(a) for a in args]}},
            {"type": "close"},
        ]}
        req = urllib.request.Request(
            self.base + "/v2/pipeline", data=json.dumps(body).encode(), method="POST",
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            raise CloudError(f"Turso HTTP {e.code}") from e
        except urllib.error.URLError as e:
            raise CloudError(f"Turso unreachable: {e.reason}") from e
        first = (data.get("results") or [{}])[0]
        if first.get("type") != "ok":
            raise CloudError((first.get("error") or {}).get("message", "Turso error"))
        result = first["response"]["result"]
        cols = [c["name"] for c in result.get("cols", [])]
        return [dict(zip(cols, (self._val(c) for c in row))) for row in result.get("rows", [])]


class _Sqlite:
    """file:path transport for local development and tests."""

    def __init__(self, path: str):
        self.path = path
        self.lock = threading.Lock()

    def execute(self, sql: str, args=()):
        with self.lock, sqlite3.connect(self.path) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.execute(sql, tuple(args))
            return [dict(r) for r in cur.fetchall()]


_client = None
_client_key = None
_schema_ready = False


def _get_client():
    global _client, _client_key, _schema_ready
    url, token = _env("TURSO_DATABASE_URL"), _env("TURSO_AUTH_TOKEN")
    if not url:
        return None
    if _client is None or _client_key != (url, token):
        _client = _Sqlite(url[len("file:"):]) if url.startswith("file:") else _TursoHttp(url, token)
        _client_key, _schema_ready = (url, token), False
    if not _schema_ready:
        _client.execute(SCHEMA)
        _schema_ready = True
    return _client


def enabled() -> bool:
    return bool(_env("TURSO_DATABASE_URL"))


def _require():
    c = _get_client()
    if c is None:
        raise CloudError("Cloud storage is not configured on this server.")
    return c


# ─── operations ────────────────────────────────────────────────────────────
def list_records(ws: str) -> list[dict]:
    return _require().execute(
        "SELECT so_benh_an, ho_ten, nhom_benh, so_lan_cap_nhat, tao_luc, cap_nhat_luc "
        "FROM mp_records WHERE workspace = ? ORDER BY cap_nhat_luc DESC LIMIT 500", (ws,))


def get_record(ws: str, so_benh_an: str) -> dict | None:
    rows = _require().execute(
        "SELECT data FROM mp_records WHERE workspace = ? AND so_benh_an = ?", (ws, so_benh_an))
    return json.loads(rows[0]["data"]) if rows else None


def put_record(ws: str, so_benh_an: str, record: dict) -> None:
    data = json.dumps(record, ensure_ascii=False)
    if len(data.encode()) > MAX_RECORD_BYTES:
        raise ValueError("Record is too large to sync (limit 5 MB).")
    _require().execute(
        "INSERT INTO mp_records (workspace, so_benh_an, ho_ten, nhom_benh, so_lan_cap_nhat, tao_luc, cap_nhat_luc, data) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(workspace, so_benh_an) DO UPDATE SET ho_ten=excluded.ho_ten, nhom_benh=excluded.nhom_benh, "
        "so_lan_cap_nhat=excluded.so_lan_cap_nhat, cap_nhat_luc=excluded.cap_nhat_luc, data=excluded.data",
        (ws, so_benh_an, record.get("ten_hien_thi") or record.get("ho_ten") or "", record.get("nhom_benh") or "",
         int(record.get("so_lan_cap_nhat") or 1), record.get("tao_luc") or "", record.get("cap_nhat_luc") or "", data))


def delete_record(ws: str, so_benh_an: str) -> None:
    _require().execute("DELETE FROM mp_records WHERE workspace = ? AND so_benh_an = ?", (ws, so_benh_an))
