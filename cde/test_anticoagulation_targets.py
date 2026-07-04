"""
test_anticoagulation_targets.py — Test cho module ngưỡng INR theo guideline
ESC/EACTS 2021 + AHA/ACC 2020 (dữ liệu anh Tấn cung cấp cho Vấn đề 1).

QUAN TRỌNG: file này chứa test HỒI QUY cho 1 bug nghiêm trọng đã phát hiện
khi viết module: toàn bộ hàm nhận diện vị trí van/yếu tố nguy cơ dùng
text.lower() thay vì _strip_accents() — khiến MỌI văn bản tiếng Việt có dấu
("động mạch chủ", "rung nhĩ"...) không bao giờ khớp được với keyword không
dấu, làm hệ thống luôn báo "thiếu dữ liệu" dù hồ sơ ghi đầy đủ thông tin.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from anticoagulation_targets import (
    SIMPLE_TARGETS, get_mechanical_valve_target, classify_anticoagulant,
    _detect_valve_position, _detect_valve_generation_risk, _detect_risk_factors,
)


# ─── TEST HỒI QUY: nhận diện đúng văn bản tiếng Việt CÓ DẤU ──────────────────
def test_nhan_dien_vi_tri_van_dmc_co_dau():
    """Bug đã phát hiện: text có dấu 'động mạch chủ' không khớp được keyword
    không dấu 'dong mach chu' do thiếu strip_accents."""
    assert _detect_valve_position("Thay van động mạch chủ cơ học On-X") == "aortic"


def test_nhan_dien_vi_tri_van_hai_la_co_dau():
    assert _detect_valve_position("Hở van hai lá nhiều, đã sửa van") == "mitral"


def test_nhan_dien_yeu_to_nguy_co_rung_nhi_co_dau():
    factors = _detect_risk_factors("Rung nhĩ mạn tính, đã thay van.")
    assert "Rung nhĩ" in factors


def test_nhan_dien_yeu_to_nguy_co_tien_su_dot_quy_co_dau():
    factors = _detect_risk_factors("Tiền sử đột quỵ não cách đây 2 năm.")
    assert "Tiền sử thuyên tắc (huyết khối/đột quỵ)" in factors


def test_nhan_dien_ef_giam_duoi_35():
    factors = _detect_risk_factors("Suy tim.", ef_percent=30)
    assert "LVEF < 35%" in factors


def test_khong_nham_ef_binh_thuong_thanh_yeu_to_nguy_co():
    factors = _detect_risk_factors("Chức năng tim tốt.", ef_percent=60)
    assert "LVEF < 35%" not in factors


# ─── TEST: ngưỡng đơn giản (sửa van / sinh học / không liên quan van) ────────
def test_simple_targets_repair_dung_bang_esc():
    t = SIMPLE_TARGETS["repair"]
    assert t["target_min"] == 2.0 and t["target_max"] == 3.0
    assert "ESC/EACTS" in t["nguon"]


def test_simple_targets_bioprosthetic_co_luu_y_khac_biet_my_chau_au():
    t = SIMPLE_TARGETS["bioprosthetic"]
    assert "luu_y" in t
    assert "Aspirin" in t["luu_y"]


def test_simple_targets_native_disease_uu_tien_doac():
    t = SIMPLE_TARGETS["native_disease"]
    assert "NOAC" in t["nguon"] or "DOAC" in t["nguon"]


# ─── TEST: van cơ học — đầy đủ dữ liệu (vị trí + thế hệ van + yếu tố nguy cơ) ─
def test_van_dmc_onx_co_yeu_to_nguy_co_du_lieu_day_du():
    """Case đầy đủ thông tin nhất: van ĐMC, On-X, có rung nhĩ (yếu tố nguy cơ)."""
    result = get_mechanical_valve_target("Thay van động mạch chủ cơ học On-X. Rung nhĩ mạn.")
    assert result["day_du_du_lieu"] is True
    assert result["vi_tri_van"] == "aortic"
    assert result["the_he_van_nguy_co"] == "low"
    assert "Rung nhĩ" in result["yeu_to_nguy_co_phat_hien"]
    # ESC/EACTS: van nguy cơ thấp + có yếu tố nguy cơ -> 3.0-3.5
    assert result["esc_eacts_2021"]["target_min"] == 3.0
    assert result["esc_eacts_2021"]["target_max"] == 3.5
    # AHA/ACC: ngoại lệ On-X -> 1.5-2.0 (khác hẳn ESC, đây là điểm mấu chốt)
    assert result["ahaacc_2020"]["target_min"] == 1.5
    assert result["ahaacc_2020"]["target_max"] == 2.0


def test_van_dmc_onx_khong_yeu_to_nguy_co_chi_co_diem_don_khong_tu_suy_dien_khoang():
    """Van nguy cơ thấp, KHÔNG có yếu tố nguy cơ -> ESC/EACTS chỉ ghi 1 điểm
    (2.5), KHÔNG có khoảng -> hệ thống phải báo rõ, không tự bịa khoảng."""
    result = get_mechanical_valve_target("Thay van động mạch chủ cơ học On-X.")
    assert result["esc_eacts_2021"]["chi_la_diem_don"] is True
    assert result["esc_eacts_2021"]["target_min"] is None


def test_van_hai_la_co_hoc_dung_nhanh_ahaacc():
    """Van hai lá cơ học -> AHA/ACC mức 1, ngưỡng 2.5-3.5 (không phải nhánh
    On-X vì On-X chỉ áp dụng cho van ĐMC theo đúng bảng anh Tấn)."""
    result = get_mechanical_valve_target("Thay van hai lá cơ học St Jude.")
    assert result["vi_tri_van"] == "mitral"
    assert result["ahaacc_2020"]["target_min"] == 2.5
    assert result["ahaacc_2020"]["target_max"] == 3.5


def test_van_ba_la_nguong_cao_nhat():
    result = get_mechanical_valve_target("Thay van ba lá cơ học.")
    assert result["esc_eacts_2021"]["target_min"] == 3.0
    assert result["esc_eacts_2021"]["target_max"] == 4.0


# ─── TEST: thiếu dữ liệu — KHÔNG tự suy diễn ─────────────────────────────────
def test_van_co_hoc_khong_ro_vi_tri_bao_thieu_du_lieu():
    """Chỉ ghi 'van cơ học' chung, không rõ vị trí/thế hệ -> phải báo thiếu,
    KHÔNG tự đoán ngưỡng."""
    result = get_mechanical_valve_target("Thay van cơ học.")
    assert result["day_du_du_lieu"] is False
    assert len(result["thieu_du_lieu"]) > 0


# ─── TEST: DOAC vs VKA — ẩn/hiện INR/TTR ─────────────────────────────────────
def test_doac_an_hoan_toan_inr_ttr():
    status = classify_anticoagulant([{"ten_thuoc": "Rivaroxaban (Xarelto) 15mg"}])
    assert status["nhom"] == "doac"
    assert status["an_inr_ttr"] is True
    assert "eGFR" in status["thong_bao_doac"] or "CrCl" in status["thong_bao_doac"]


def test_vka_hien_day_du_inr_ttr():
    status = classify_anticoagulant([{"ten_thuoc": "Acenocoumarol (Sintrom) 4mg"}])
    assert status["nhom"] == "vka"
    assert status["an_inr_ttr"] is False


def test_khong_dung_thuoc_chong_dong():
    status = classify_anticoagulant([{"ten_thuoc": "Furosemide 40mg"}])
    assert status["nhom"] == "none"
    assert status["an_inr_ttr"] is False


def test_doac_nhan_dien_ca_apixaban():
    status = classify_anticoagulant([{"ten_thuoc": "Apixaban (Eliquis) 5mg"}])
    assert status["nhom"] == "doac"


# ─── TEST: bug thật đã sửa — phân biệt vị trí van (ĐMC vs hai lá) ─────────
def test_van_hai_la_nguy_co_thap_co_yeu_to_nguy_co_nguong_cao_hon_dmc():
    """Bug thật: trước đây ma trận ESC/EACTS áp CÙNG ngưỡng cho van ĐMC và
    van hai lá cùng thế hệ + yếu tố nguy cơ — thực tế van hai lá luôn cần
    ngưỡng CAO HƠN. On-X + hai lá + rung nhĩ (yếu tố nguy cơ) -> 3.0-4.0,
    KHÔNG PHẢI 3.0-3.5 như van ĐMC cùng điều kiện."""
    mitral = get_mechanical_valve_target("Thay van hai lá cơ học On-X. Rung nhĩ.")
    aortic = get_mechanical_valve_target("Thay van động mạch chủ cơ học On-X. Rung nhĩ.")
    assert mitral["esc_eacts_2021"]["target_min"] == 3.0
    assert mitral["esc_eacts_2021"]["target_max"] == 4.0
    assert aortic["esc_eacts_2021"]["target_min"] == 3.0
    assert aortic["esc_eacts_2021"]["target_max"] == 3.5
    assert mitral["esc_eacts_2021"]["target_max"] > aortic["esc_eacts_2021"]["target_max"]


def test_van_hai_la_nguy_co_thap_khong_yeu_to_nguy_co_diem_don_cao_hon_dmc():
    mitral = get_mechanical_valve_target("Thay van hai lá cơ học On-X.")
    aortic = get_mechanical_valve_target("Thay van động mạch chủ cơ học On-X.")
    assert mitral["esc_eacts_2021"]["target_mid"] == 3.0
    assert aortic["esc_eacts_2021"]["target_mid"] == 2.5


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
