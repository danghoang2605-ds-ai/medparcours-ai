"""Truy vấn Supabase PostgREST dưới danh nghĩa bác sĩ đang đăng nhập.

Mọi request dùng anon key ở header apikey và JWT bác sĩ ở Authorization. Vì vậy
Postgres Row Level Security vẫn là lớp quyết định bác sĩ được đọc/ghi dòng nào.
"""

from __future__ import annotations

import copy
import hashlib
import hmac
import os
import uuid
from typing import Any

import requests

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY") or ""
PATIENT_HASH_SALT = os.environ.get("PATIENT_HASH_SALT") or ""


class SupabaseDataError(RuntimeError):
    pass


def _require_config() -> None:
    missing = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_ANON_KEY:
        missing.append("SUPABASE_ANON_KEY")
    if not PATIENT_HASH_SALT:
        missing.append("PATIENT_HASH_SALT")
    if missing:
        raise SupabaseDataError("Thiếu biến môi trường: " + ", ".join(missing))


class RLSClient:
    def __init__(self, token: str):
        _require_config()
        self.base_url = f"{SUPABASE_URL}/rest/v1"
        self.session = requests.Session()
        self.session.headers.update(
            {
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            }
        )

    def request(
        self,
        method: str,
        table: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any = None,
        prefer: str | None = None,
    ) -> Any:
        headers = {"Prefer": prefer} if prefer else None
        try:
            response = self.session.request(
                method,
                f"{self.base_url}/{table}",
                params=params,
                json=json_body,
                headers=headers,
                timeout=20,
            )
        except requests.RequestException as exc:
            raise SupabaseDataError("Không kết nối được Supabase Database") from exc

        if response.status_code >= 400:
            try:
                detail = response.json().get("message") or response.json().get("hint")
            except Exception:
                detail = response.text[:300]
            raise SupabaseDataError(
                f"Supabase Database trả HTTP {response.status_code}: {detail or 'không rõ lỗi'}"
            )

        if not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            return None


def _first(rows: Any, message: str) -> dict:
    if not isinstance(rows, list) or not rows:
        raise SupabaseDataError(message)
    return rows[0]


def hash_ma_benh_an(value: str) -> str:
    _require_config()
    normalized = (value or "").strip().lower()
    return hmac.new(
        PATIENT_HASH_SALT.encode("utf-8"),
        normalized.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def patient_fingerprint(report: dict) -> str:
    tt = report.get("thong_tin_benh_nhan") or {}
    explicit_id = tt.get("so_benh_an") or tt.get("ma_benh_an")
    if explicit_id:
        return str(explicit_id)

    # Chỉ băm tổ hợp định danh, tuyệt đối không lưu chuỗi gốc này xuống DB.
    fallback = "|".join(
        str(tt.get(k) or "").strip().lower()
        for k in ("ho_ten", "ngay_sinh", "gioi_tinh", "tuoi")
    )
    if fallback.replace("|", ""):
        return fallback

    # Không đủ định danh để nối dọc một cách đáng tin cậy: tạo bệnh nhân ẩn danh
    # mới, tránh gộp nhầm hai người chỉ vì report có cùng bộ field.
    return f"no-id:{uuid.uuid4().hex}"


def an_danh_hoa(report: dict) -> dict:
    safe = copy.deepcopy(report)
    tt = safe.get("thong_tin_benh_nhan")
    if isinstance(tt, dict):
        for key in (
            "ho_ten",
            "ngay_sinh",
            "ma_benh_an",
            "so_benh_an",
            "dia_chi",
            "so_dien_thoai",
            "email",
            "cccd",
        ):
            tt.pop(key, None)
        tt["ho_ten"] = "Bệnh nhân ẩn danh"
    return safe


def _doctor_hospital(client: RLSClient, doctor_id: str) -> str:
    rows = client.request(
        "GET",
        "bac_si",
        params={"select": "benh_vien_id", "id": f"eq.{doctor_id}", "limit": "1"},
    )
    doctor = _first(rows, "Không tìm thấy hồ sơ bác sĩ trong bảng bac_si")
    hospital_id = doctor.get("benh_vien_id")
    if not hospital_id:
        raise SupabaseDataError(
            "Tài khoản bác sĩ chưa được gán benh_vien_id. Hãy gán bệnh viện trong Supabase."
        )
    return hospital_id


def _safe_age(value: Any) -> int | None:
    try:
        age = int(value)
        return age if 0 <= age <= 130 else None
    except (TypeError, ValueError):
        return None


def _current_stage(report: dict) -> str:
    stage = report.get("giai_doan_hien_tai")
    if stage:
        return str(stage)
    tt = report.get("thong_tin_benh_nhan") or {}
    return "Ngoại trú - tái khám" if tt.get("ngay_ra_vien") else "Nội trú"


def save_analysis_result(
    *,
    token: str,
    doctor_id: str,
    report: dict,
    analysis: dict | None,
) -> str:
    client = RLSClient(token)
    hospital_id = _doctor_hospital(client, doctor_id)
    tt = report.get("thong_tin_benh_nhan") or {}
    patient_hash = hash_ma_benh_an(patient_fingerprint(report))

    patient_body = {
        "ma_benh_an_hash": patient_hash,
        "benh_vien_id": hospital_id,
    }
    age = _safe_age(tt.get("tuoi"))
    if age is not None:
        patient_body["tuoi"] = age
    if tt.get("gioi_tinh"):
        patient_body["gioi_tinh"] = tt.get("gioi_tinh")

    patients = client.request(
        "POST",
        "benh_nhan",
        params={
            "on_conflict": "benh_vien_id,ma_benh_an_hash",
            "select": "id,tuoi,gioi_tinh",
        },
        json_body=patient_body,
        prefer="resolution=merge-duplicates,return=representation",
    )
    patient = _first(patients, "Không tạo hoặc tìm được bệnh nhân ẩn danh")

    warnings = report.get("canh_bao_nguy_co") or report.get("canh_bao") or []
    stored_payload = {
        "version": 1,
        "report": an_danh_hoa(report),
        "analysis": analysis or None,
    }

    analyses = client.request(
        "POST",
        "phan_tich",
        params={"select": "id"},
        json_body={
            "benh_nhan_id": patient["id"],
            "bac_si_id": doctor_id,
            "benh_vien_id": hospital_id,
            "chan_doan_chinh": report.get("chan_doan_chinh"),
            "giai_doan": _current_stage(report),
            "so_canh_bao": len(warnings) if isinstance(warnings, list) else 0,
            "bao_cao_json": stored_payload,
        },
        prefer="return=representation",
    )
    analysis_row = _first(analyses, "Không lưu được kết quả phân tích")

    client.request(
        "POST",
        "nhat_ky_truy_cap",
        json_body={
            "bac_si_id": doctor_id,
            "phan_tich_id": analysis_row["id"],
            "hanh_dong": "tao",
        },
        prefer="return=minimal",
    )
    return analysis_row["id"]


def list_history(token: str, doctor_id: str, limit: int = 100) -> list[dict]:
    client = RLSClient(token)
    rows = client.request(
        "GET",
        "phan_tich",
        params={
            "select": (
                "id,ngay_phan_tich,chan_doan_chinh,giai_doan,so_canh_bao,"
                "bac_si_id,benh_nhan_id,benh_nhan(tuoi,gioi_tinh)"
            ),
            "order": "ngay_phan_tich.desc",
            "limit": str(max(1, min(limit, 200))),
        },
    ) or []

    result = []
    for row in rows:
        patient = row.pop("benh_nhan", None) or {}
        if isinstance(patient, list):
            patient = patient[0] if patient else {}
        patient_id = row.get("benh_nhan_id") or ""
        result.append(
            {
                **row,
                "tuoi": patient.get("tuoi") if isinstance(patient, dict) else None,
                "gioi_tinh": patient.get("gioi_tinh") if isinstance(patient, dict) else None,
                "ma_hien_thi": patient_id.replace("-", "")[:8].upper(),
                "co_the_xoa": row.get("bac_si_id") == doctor_id,
            }
        )
    return result


def get_analysis_detail(token: str, doctor_id: str, analysis_id: str) -> dict:
    client = RLSClient(token)
    rows = client.request(
        "GET",
        "phan_tich",
        params={
            "select": "id,benh_nhan_id,ngay_phan_tich,bao_cao_json",
            "id": f"eq.{analysis_id}",
            "limit": "1",
        },
    )
    row = _first(rows, "Không tìm thấy bản phân tích hoặc bạn không có quyền xem")

    payload = row.get("bao_cao_json") or {}
    if isinstance(payload, dict) and isinstance(payload.get("report"), dict):
        report = payload["report"]
        analysis = payload.get("analysis")
    else:
        # Tương thích dữ liệu đã lưu theo cấu trúc cũ trong PDF.
        report = payload
        analysis = None

    client.request(
        "POST",
        "nhat_ky_truy_cap",
        json_body={
            "bac_si_id": doctor_id,
            "phan_tich_id": analysis_id,
            "hanh_dong": "xem",
        },
        prefer="return=minimal",
    )

    return {
        "id": row["id"],
        "benh_nhan_id": row.get("benh_nhan_id"),
        "ngay_phan_tich": row.get("ngay_phan_tich"),
        "report": report,
        "analysis": analysis,
    }


def list_patient_history(token: str, patient_id: str) -> list[dict]:
    client = RLSClient(token)
    return client.request(
        "GET",
        "phan_tich",
        params={
            "select": "id,ngay_phan_tich,chan_doan_chinh,giai_doan,so_canh_bao",
            "benh_nhan_id": f"eq.{patient_id}",
            "order": "ngay_phan_tich.asc",
        },
    ) or []


def delete_analysis(token: str, doctor_id: str, analysis_id: str) -> None:
    client = RLSClient(token)

    rows = client.request(
        "GET",
        "phan_tich",
        params={"select": "id", "id": f"eq.{analysis_id}", "limit": "1"},
    )
    _first(rows, "Không tìm thấy bản phân tích hoặc bạn không có quyền xóa")

    # Ghi audit trước; FK sẽ tự chuyển phan_tich_id thành NULL sau khi xóa.
    client.request(
        "POST",
        "nhat_ky_truy_cap",
        json_body={
            "bac_si_id": doctor_id,
            "phan_tich_id": analysis_id,
            "hanh_dong": "xoa",
        },
        prefer="return=minimal",
    )
    client.request(
        "DELETE",
        "phan_tich",
        params={"id": f"eq.{analysis_id}"},
        prefer="return=minimal",
    )
