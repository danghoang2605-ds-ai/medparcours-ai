"""
test_database.py — Test cho database.py (lưu trữ hồ sơ lâu dài + tính năng
"cập nhật hồ sơ theo thời gian thực").

Dùng SQLite file LOCAL tạm thời (không phải Turso thật) — đúng nguyên tắc
test không phụ thuộc dịch vụ ngoài/mạng đã áp dụng xuyên suốt dự án (giống
mock_anthropic cho Claude API). database._get_db_url() tự rơi về file local
khi không có biến môi trường TURSO_DATABASE_URL — đây chính là cơ chế dùng
ở đây, mỗi test dùng 1 file DB riêng (tạo trong setup, xóa trong teardown)
để các test độc lập hoàn toàn với nhau.
"""
import sys
import os
import json
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pytest
import database as db


@pytest.fixture
def temp_db(monkeypatch):
    """Mỗi test dùng 1 file SQLite riêng trong thư mục tạm — độc lập hoàn
    toàn, không ảnh hưởng lẫn nhau, không để lại rác sau khi test xong."""
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


def _sample_report(so_benh_an="01.000001", ho_ten="Nguyễn Văn Test", **overrides):
    base = {
        "thong_tin_benh_nhan": {"ho_ten": ho_ten, "tuoi": 60, "gioi_tinh": "Nam", "so_benh_an": so_benh_an},
        "chan_doan_chinh": "Tăng huyết áp",
        "xet_nghiem_key": [{"key": "Creatinin", "rawVal": 90, "ngay": "01/01/2026"}],
        "thuoc_cuoi_ky": [],
    }
    base.update(overrides)
    return base


# ─── save_new_patient ─────────────────────────────────────────────────────
def test_luu_ho_so_moi_thanh_cong(temp_db):
    r = db.save_new_patient(_sample_report())
    assert r["success"] is True
    assert r["so_benh_an"] == "01.000001"
    assert r["so_lan_cap_nhat"] == 1


def test_luu_ho_so_thieu_so_benh_an_bao_loi_ro():
    report = _sample_report()
    report["thong_tin_benh_nhan"]["so_benh_an"] = ""
    # Không cần temp_db vì lỗi xảy ra TRƯỚC khi chạm database
    r = db.save_new_patient(report)
    assert r["success"] is False
    assert "số bệnh án" in r["error"].lower()


def test_luu_trung_so_benh_an_khong_ghi_de(temp_db):
    db.save_new_patient(_sample_report(chan_doan_chinh="Lần đầu"))
    r2 = db.save_new_patient(_sample_report(chan_doan_chinh="Lần hai — không được ghi đè"))
    assert r2["success"] is False
    assert r2["error"] == "da_ton_tai"
    # Xác nhận dữ liệu CŨ không bị ảnh hưởng
    got = db.get_patient("01.000001")
    assert got["report"]["chan_doan_chinh"] == "Lần đầu"


# ─── get_patient / list_patients ──────────────────────────────────────────
def test_lay_ho_so_chua_tung_luu_tra_none(temp_db):
    assert db.get_patient("00.999999") is None


def test_lay_ho_so_dung_du_lieu_da_luu(temp_db):
    db.save_new_patient(_sample_report())
    got = db.get_patient("01.000001")
    assert got is not None
    assert got["report"]["thong_tin_benh_nhan"]["ho_ten"] == "Nguyễn Văn Test"
    assert got["so_lan_cap_nhat"] == 1
    assert got["tao_luc"] is not None


def test_danh_sach_ho_so_moi_nhat_len_dau(temp_db):
    db.save_new_patient(_sample_report(so_benh_an="01.000001", ho_ten="Bệnh nhân A"))
    db.save_new_patient(_sample_report(so_benh_an="01.000002", ho_ten="Bệnh nhân B"))
    db.update_patient_with_new_document("01.000001", {"chan_doan_chinh": "Cập nhật"})
    patients = db.list_patients()
    assert patients[0]["so_benh_an"] == "01.000001"  # vừa cập nhật -> lên đầu


# ─── merge_reports (logic gộp) ────────────────────────────────────────────
def test_gop_truong_don_uu_tien_gia_tri_moi():
    old = _sample_report(chan_doan_chinh="Chẩn đoán cũ")
    new = {"chan_doan_chinh": "Chẩn đoán mới"}
    merged = db.merge_reports(old, new)
    assert merged["chan_doan_chinh"] == "Chẩn đoán mới"


def test_gop_truong_don_giu_cu_khi_moi_de_trong():
    old = _sample_report(chan_doan_chinh="Chẩn đoán cũ")
    new = {"chan_doan_chinh": ""}  # tài liệu mới không nhắc tới
    merged = db.merge_reports(old, new)
    assert merged["chan_doan_chinh"] == "Chẩn đoán cũ"


def test_gop_thong_tin_benh_nhan_theo_tung_truong_con():
    old = _sample_report()  # tuoi=60
    new = {"thong_tin_benh_nhan": {"tuoi": 61}}  # chỉ cập nhật tuổi
    merged = db.merge_reports(old, new)
    assert merged["thong_tin_benh_nhan"]["tuoi"] == 61
    assert merged["thong_tin_benh_nhan"]["ho_ten"] == "Nguyễn Văn Test"  # giữ nguyên


def test_gop_mang_xet_nghiem_noi_them_khong_ghi_de():
    old = _sample_report()  # đã có 1 Creatinin ngày 01/01/2026
    new = {"xet_nghiem_key": [{"key": "Creatinin", "rawVal": 110, "ngay": "15/06/2026"}]}
    merged = db.merge_reports(old, new)
    assert len(merged["xet_nghiem_key"]) == 2
    values = [x["rawVal"] for x in merged["xet_nghiem_key"]]
    assert 90 in values and 110 in values


def test_gop_mang_xet_nghiem_loai_trung_neu_giong_het():
    old = _sample_report()
    # Gộp đúng dữ liệu CŨ (giống hệt) -> không được nhân đôi
    new = {"xet_nghiem_key": [{"key": "Creatinin", "rawVal": 90, "ngay": "01/01/2026"}]}
    merged = db.merge_reports(old, new)
    assert len(merged["xet_nghiem_key"]) == 1


def test_gop_thuoc_cuoi_ky_ghi_de_khong_noi_them():
    """Khác xét nghiệm (tích lũy lịch sử), thuốc CUỐI KỲ phản ánh TRẠNG THÁI
    HIỆN TẠI -> tài liệu mới hơn THẮNG, không nối thêm thuốc cũ đã ngừng."""
    old = _sample_report(thuoc_cuoi_ky=[{"ten_thuoc": "Thuốc cũ đã ngừng"}])
    new = {"thuoc_cuoi_ky": [{"ten_thuoc": "Thuốc mới đang dùng"}]}
    merged = db.merge_reports(old, new)
    assert len(merged["thuoc_cuoi_ky"]) == 1
    assert merged["thuoc_cuoi_ky"][0]["ten_thuoc"] == "Thuốc mới đang dùng"


def test_gop_sieu_am_tim_noi_them_lan_kham_moi():
    old = _sample_report(sieu_am_tim={"lan_kham": [{"ngay": "01/01/2026", "ef": 60}]})
    new = {"sieu_am_tim": {"lan_kham": [{"ngay": "15/06/2026", "ef": 55}]}}
    merged = db.merge_reports(old, new)
    assert len(merged["sieu_am_tim"]["lan_kham"]) == 2


def test_gop_khong_sua_report_cu_goc():
    """merge_reports KHÔNG được sửa report_cu tại chỗ (immutable) — quan
    trọng để patient_history giữ đúng bản 'trước khi gộp'."""
    old = _sample_report()
    old_snapshot = json.loads(json.dumps(old))
    db.merge_reports(old, {"chan_doan_chinh": "Thay đổi"})
    assert old == old_snapshot, "merge_reports đã sửa report_cu gốc — vi phạm immutability"


# ─── update_patient_with_new_document (luồng đầy đủ) ──────────────────────
def test_cap_nhat_ho_so_chua_ton_tai_bao_loi_ro(temp_db):
    r = db.update_patient_with_new_document("00.999999", {"chan_doan_chinh": "X"})
    assert r["success"] is False
    assert r["error"] == "chua_co_ho_so"


def test_cap_nhat_ho_so_thanh_cong_tang_so_lan(temp_db):
    db.save_new_patient(_sample_report())
    r = db.update_patient_with_new_document("01.000001", {"chan_doan_chinh": "Cập nhật lần 1"})
    assert r["success"] is True
    assert r["so_lan_cap_nhat"] == 2
    r2 = db.update_patient_with_new_document("01.000001", {"chan_doan_chinh": "Cập nhật lần 2"})
    assert r2["so_lan_cap_nhat"] == 3


def test_cap_nhat_luu_lai_lich_su_truoc_khi_gop(temp_db):
    """patient_history phải lưu lại bản report TRƯỚC khi gộp — an toàn dữ
    liệu y tế, có thể xem lại/khôi phục nếu gộp sai."""
    db.save_new_patient(_sample_report(chan_doan_chinh="Bản gốc"))
    db.update_patient_with_new_document("01.000001", {"chan_doan_chinh": "Bản đã cập nhật"},
                                          nguon_tai_lieu="tai_kham.pdf")
    client = db.get_client()
    try:
        rs = client.execute(
            "SELECT report_json_truoc_khi_gop, nguon_tai_lieu_moi FROM patient_history WHERE so_benh_an = ?",
            ["01.000001"],
        )
        assert len(rs.rows) == 1
        history_report = json.loads(rs.rows[0][0])
        assert history_report["chan_doan_chinh"] == "Bản gốc"
        assert rs.rows[0][1] == "tai_kham.pdf"
    finally:
        client.close()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


# ─── Regression: bug thật đã gặp trên Hugging Face Space ──────────────────
# "Forbidden control character detected in headers. Potential header
# injection attack." — do TURSO_DATABASE_URL/TURSO_AUTH_TOKEN dính ký tự
# xuống dòng/khoảng trắng ẩn khi copy-paste vào Secrets. Test này KHÔNG dùng
# fixture temp_db (không được monkeypatch _get_db_url/_get_auth_token) —
# mục đích là test đúng 2 hàm đọc biến môi trường thật.
def test_get_db_url_tu_dong_bo_ky_tu_dieu_khien_thua(monkeypatch):
    monkeypatch.setenv("TURSO_DATABASE_URL", "libsql://medparcours-test.aws-us-east-2.turso.io\n")
    url = db._get_db_url()
    assert url == "libsql://medparcours-test.aws-us-east-2.turso.io"
    assert "\n" not in url


def test_get_auth_token_tu_dong_bo_ky_tu_dieu_khien_thua(monkeypatch):
    monkeypatch.setenv("TURSO_AUTH_TOKEN", "  eyJhbGc.fake.token  \n")
    token = db._get_auth_token()
    assert token == "eyJhbGc.fake.token"


def test_get_auth_token_khong_co_bien_moi_truong_tra_none(monkeypatch):
    monkeypatch.delenv("TURSO_AUTH_TOKEN", raising=False)
    assert db._get_auth_token() is None
