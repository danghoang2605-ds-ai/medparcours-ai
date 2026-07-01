"""
test_main_patient_endpoints.py — Test cho 4 endpoint mới
(/patient/save, /patient/{so_benh_an}, /patient, /patient/update) qua ĐÚNG
TẦNG HTTP (FastAPI TestClient), không chỉ gọi database.py trực tiếp — đúng
bài học đã rút ra trong dự án: test qua endpoint thật bắt được lỗi tích hợp
(field bị bỏ sót khi build response, sai thứ tự gọi...) mà test đơn vị
không bắt được.

Dùng file SQLite local tạm thời (không phải Turso thật) — giống cách
test_database.py đã làm, để CI không cần token Turso/kết nối mạng.
"""
import sys
import os
import io
import json
import tempfile
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-real")

import pytest
from fastapi.testclient import TestClient

import main
import database as db


@pytest.fixture
def temp_db(monkeypatch):
    tmp_dir = tempfile.mkdtemp()
    tmp_path = os.path.join(tmp_dir, "test.db")
    monkeypatch.setattr(db, "_get_db_url", lambda: "file:" + tmp_path)
    monkeypatch.setattr(db, "_get_auth_token", lambda: None)
    db.init_db()
    yield
    try:
        os.remove(tmp_path)
    except OSError:
        pass


@pytest.fixture
def client(temp_db):
    return TestClient(main.app)


@pytest.fixture
def mock_anthropic_patient_update():
    """Mock riêng cho test update: Bước 1 (extraction) trả report_moi nhỏ —
    không cần đầy đủ như mock_anthropic chính trong test_main.py vì chỉ cần
    test luồng gộp dữ liệu, không cần test chất lượng narrative."""
    fake_new_report = {
        "xet_nghiem_key": [{"key": "INR", "rawVal": 2.8, "trend": [2.4, 2.8], "ngay": "15/06/2026"}],
        "thuoc_cuoi_ky": [{"ten_thuoc": "Sintrom 4mg (liều mới)"}],
    }

    def _side_effect(*args, **kwargs):
        return json.dumps(fake_new_report, ensure_ascii=False)

    with patch("main.call_claude", side_effect=_side_effect):
        yield


def _sample_report(so_benh_an="02.000001", **overrides):
    base = {
        "thong_tin_benh_nhan": {"ho_ten": "Bệnh Nhân Test", "tuoi": 65, "gioi_tinh": "Nữ", "so_benh_an": so_benh_an},
        "chan_doan_chinh": "Rung nhĩ, tăng huyết áp",
        "xet_nghiem_key": [{"key": "INR", "rawVal": 2.4, "trend": [2.4], "ngay": "01/01/2026"}],
        "thuoc_cuoi_ky": [{"ten_thuoc": "Sintrom 4mg"}],
    }
    base.update(overrides)
    return base


# ─── POST /patient/save ───────────────────────────────────────────────────
def test_save_patient_thanh_cong(client):
    resp = client.post("/patient/save", json={"report": _sample_report()})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["so_benh_an"] == "02.000001"


def test_save_patient_trung_so_benh_an_tra_409(client):
    client.post("/patient/save", json={"report": _sample_report()})
    resp2 = client.post("/patient/save", json={"report": _sample_report()})
    assert resp2.status_code == 409


# ─── GET /patient/{so_benh_an} ────────────────────────────────────────────
def test_get_patient_chua_luu_tra_404(client):
    resp = client.get("/patient/00.999999")
    assert resp.status_code == 404


def test_get_patient_tra_dung_report_va_tinh_lai_analysis(client):
    client.post("/patient/save", json={"report": _sample_report()})
    resp = client.get("/patient/02.000001")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["report"]["thong_tin_benh_nhan"]["ho_ten"] == "Bệnh Nhân Test"
    assert "analysis" in data
    assert "active_profiles" in data["analysis"]
    profile_ids = [p["profile_id"] for p in data["analysis"]["active_profiles"]]
    assert "atrial_fibrillation" in profile_ids


# ─── GET /patient (danh sách) ──────────────────────────────────────────────
def test_list_patients_rong_khi_chua_co_ho_so(client):
    resp = client.get("/patient")
    assert resp.status_code == 200
    assert resp.json()["patients"] == []


def test_list_patients_tra_dung_ho_so_da_luu(client):
    client.post("/patient/save", json={"report": _sample_report(so_benh_an="02.000001")})
    client.post("/patient/save", json={"report": _sample_report(so_benh_an="02.000002")})
    resp = client.get("/patient")
    data = resp.json()
    assert len(data["patients"]) == 2


# ─── POST /patient/update — tính năng "cập nhật theo thời gian thực" ──────
def test_update_patient_chua_co_ho_so_tra_404(client):
    resp = client.post("/patient/update", json={
        "so_benh_an": "00.999999",
        "ho_so_text": "noi dung tai lieu dai it nhat vai chuc ky tu de qua kiem tra",
    })
    assert resp.status_code == 404


def test_update_patient_thanh_cong_gop_dung_du_lieu(client, mock_anthropic_patient_update):
    client.post("/patient/save", json={"report": _sample_report()})
    resp = client.post("/patient/update", json={
        "so_benh_an": "02.000001",
        "ho_so_text": "noi dung tai lieu tai kham moi dai it nhat vai chuc ky tu de qua kiem tra do dai",
        "nguon_tai_lieu": "tai_kham_2.pdf",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["so_lan_cap_nhat"] == 2
    inr_values = [x["rawVal"] for x in data["report"]["xet_nghiem_key"] if x["key"] == "INR"]
    assert 2.4 in inr_values
    assert 2.8 in inr_values
    assert "analysis" in data
    assert "active_profiles" in data["analysis"]


def test_update_patient_loi_json_tra_loi_ro(client):
    """Nếu Claude trả về text không parse được JSON, phải báo lỗi rõ ràng
    (status 200, success=False) — KHÔNG crash 500."""
    client.post("/patient/save", json={"report": _sample_report()})
    with patch("main.call_claude") as mock_call:
        mock_call.return_value = "đây không phải JSON hợp lệ chút nào"
        resp = client.post("/patient/update", json={
            "so_benh_an": "02.000001",
            "ho_so_text": "noi dung tai lieu dai it nhat vai chuc ky tu de qua kiem tra do dai toi thieu",
        })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False


# ─── DELETE /patient/{so_benh_an} ─────────────────────────────────────────
def test_delete_patient_chua_ton_tai_tra_404(client):
    resp = client.delete("/patient/00.999999")
    assert resp.status_code == 404


def test_delete_patient_thanh_cong(client):
    client.post("/patient/save", json={"report": _sample_report()})
    resp = client.delete("/patient/02.000001")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["so_benh_an"] == "02.000001"
    # Xác nhận đã xóa thật — GET lại phải 404
    resp2 = client.get("/patient/02.000001")
    assert resp2.status_code == 404


def test_delete_patient_khong_anh_huong_ho_so_khac(client):
    client.post("/patient/save", json={"report": _sample_report(so_benh_an="02.000001")})
    client.post("/patient/save", json={"report": _sample_report(so_benh_an="02.000002")})
    client.delete("/patient/02.000001")
    resp = client.get("/patient")
    ids = [p["so_benh_an"] for p in resp.json()["patients"]]
    assert ids == ["02.000002"]


# ─── POST /patient/update_file — cập nhật hồ sơ đa định dạng (multipart) ──
def test_update_patient_file_chua_co_ho_so_tra_404(client):
    resp = client.post("/patient/update_file",
                        data={"so_benh_an": "00.999999"},
                        files={"file": ("taikham.docx", io.BytesIO(b"noi dung gia"),
                                         "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    assert resp.status_code == 404


def test_update_patient_file_docx_thanh_cong(client, mock_anthropic_patient_update):
    from docx import Document
    client.post("/patient/save", json={"report": _sample_report()})
    doc = Document()
    doc.add_paragraph("Ket qua tai kham moi, INR do lai 2.8, dai it nhat vai chuc ky tu de qua kiem tra.")
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    resp = client.post("/patient/update_file",
                        data={"so_benh_an": "02.000001", "nguon_tai_lieu": "tai_kham.docx"},
                        files={"file": ("tai_kham.docx", buf,
                                         "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["so_lan_cap_nhat"] == 2
    inr_values = [x["rawVal"] for x in data["report"]["xet_nghiem_key"] if x["key"] == "INR"]
    assert 2.4 in inr_values
    assert 2.8 in inr_values


def test_update_patient_file_dinh_dang_khong_ho_tro_tra_loi_ro(client):
    client.post("/patient/save", json={"report": _sample_report()})
    resp = client.post("/patient/update_file",
                        data={"so_benh_an": "02.000001"},
                        files={"file": ("ghi_am.mp3", io.BytesIO(b"gia lap file am thanh"), "audio/mpeg")})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert "định dạng" in data["error"].lower() or "dinh dang" in data["error"].lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


# ─── PATCH /patient/{so_benh_an}/ten — đổi tên hiển thị (Part 3) ──────────
def test_rename_patient_thanh_cong(client):
    client.post("/patient/save", json={"report": _sample_report()})
    resp = client.patch("/patient/02.000001/ten", json={"ten_moi": "Ông A - phòng 302"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["ten_hien_thi"] == "Ông A - phòng 302"
    # Xác nhận list_patients() trả đúng tên MỚI làm tên hiển thị chính
    listed = client.get("/patient").json()["patients"]
    p = next(x for x in listed if x["so_benh_an"] == "02.000001")
    assert p["ho_ten"] == "Ông A - phòng 302"
    assert p["ten_hien_thi"] == "Ông A - phòng 302"
    assert p["ho_ten_goc"] != "Ông A - phòng 302"  # tên gốc AI trích xuất không đổi


def test_rename_patient_khong_ton_tai_tra_ve_404(client):
    resp = client.patch("/patient/00.999999/ten", json={"ten_moi": "Tên bất kỳ"})
    assert resp.status_code == 404


def test_rename_patient_chuoi_rong_quay_ve_ten_goc(client):
    """Gửi tên rỗng = bỏ tên tùy chỉnh, quay về hiển thị ho_ten gốc do AI
    trích xuất (không phải lỗi, đây là hành vi 'reset' có chủ đích)."""
    client.post("/patient/save", json={"report": _sample_report()})
    client.patch("/patient/02.000001/ten", json={"ten_moi": "Tên tạm"})
    resp = client.patch("/patient/02.000001/ten", json={"ten_moi": "   "})
    assert resp.status_code == 200
    assert resp.json()["ten_hien_thi"] is None
    listed = client.get("/patient").json()["patients"]
    p = next(x for x in listed if x["so_benh_an"] == "02.000001")
    assert p["ho_ten"] == p["ho_ten_goc"]  # quay lại đúng tên gốc


def test_rename_patient_khong_bi_ghi_de_khi_cap_nhat_ho_so(client, mock_anthropic_patient_update):
    """Bug đã lường trước khi thiết kế: cập nhật hồ sơ (gộp tài liệu mới)
    KHÔNG được phép âm thầm xóa tên tùy chỉnh bác sĩ đã đặt, vì update chỉ
    ghi vào cột ho_ten (AI trích xuất), không đụng ten_hien_thi."""
    client.post("/patient/save", json={"report": _sample_report()})
    client.patch("/patient/02.000001/ten", json={"ten_moi": "Tên tùy chỉnh của bác sĩ"})
    client.post("/patient/update", json={
        "so_benh_an": "02.000001",
        "ho_so_text": "Kết quả tái khám mới, INR đo lại 2.8, dài ít nhất vài chục ký tự để qua kiểm tra.",
        "nguon_tai_lieu": "tai_kham_moi",
    })
    listed = client.get("/patient").json()["patients"]
    p = next(x for x in listed if x["so_benh_an"] == "02.000001")
    assert p["ten_hien_thi"] == "Tên tùy chỉnh của bác sĩ"
    assert p["ho_ten"] == "Tên tùy chỉnh của bác sĩ"
