"""test_universal_indicators.py — Test cho chỉ số chung mọi bệnh nhân tim mạch."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from clinical_rules import _strip_accents
from universal_indicators import (
    assess_vital_signs, detect_risk_factors, check_baseline_labs_completeness,
    compute_score2_applicability,
)


# ─── Sinh hiệu ────────────────────────────────────────────────────────────────
def test_phan_loai_tang_huyet_ap_dung_esc_2024():
    r = assess_vital_signs({"ha_tt": 145, "ha_ttr": 92, "mach": 78})
    assert r["phan_loai_ha"] == "hypertension"


def test_phan_loai_elevated_dung_esc_2024():
    r = assess_vital_signs({"ha_tt": 125, "ha_ttr": 75, "mach": 70})
    assert r["phan_loai_ha"] == "elevated"


def test_phan_loai_non_elevated():
    r = assess_vital_signs({"ha_tt": 110, "ha_ttr": 65, "mach": 65})
    assert r["phan_loai_ha"] == "non_elevated"


def test_thieu_ha_va_mach_bao_ro():
    r = assess_vital_signs({"spo2": 98})
    assert "Huyết áp (tâm thu/tâm trương)" in r["thieu_du_lieu"]
    assert "Mạch" in r["thieu_du_lieu"]


def test_khong_phan_loai_ha_khi_thieu_du_lieu():
    r = assess_vital_signs({})
    assert "phan_loai_ha" not in r


# ─── Risk factors ─────────────────────────────────────────────────────────────
def test_phat_hien_dung_3_yeu_to_nguy_co():
    text = _strip_accents("Tăng huyết áp, đái tháo đường type 2, hút thuốc lá.")
    r = detect_risk_factors(text)
    assert r["yeu_to_nguy_co"]["hut_thuoc"] is True
    assert r["yeu_to_nguy_co"]["dtd"] is True
    assert r["yeu_to_nguy_co"]["tha"] is True
    assert r["so_yeu_to_nguy_co"] == 3


def test_khong_co_yeu_to_nguy_co_nao():
    text = _strip_accents("Khỏe mạnh, không có tiền sử bệnh lý.")
    r = detect_risk_factors(text)
    assert r["so_yeu_to_nguy_co"] == 0


# ─── Baseline labs ────────────────────────────────────────────────────────────
def test_nhom_thieu_dung():
    labs = [{"key": "Creatinin"}, {"key": "INR"}]
    r = check_baseline_labs_completeness(labs)
    assert "cong_thuc_mau" in r["nhom_con_thieu"]
    assert "creatinin_egfr" not in r["nhom_con_thieu"]
    assert "dong_mau" not in r["nhom_con_thieu"]


def test_du_het_cac_nhom():
    labs = [{"key": k} for k in ["HGB", "Creatinin", "Na+", "Glucose", "LDL", "AST", "INR"]]
    r = check_baseline_labs_completeness(labs)
    assert r["nhom_con_thieu"] == []


# ─── SCORE2 ───────────────────────────────────────────────────────────────────
def test_score2_du_du_lieu():
    r = compute_score2_applicability(55, "Nam", False, 130, 200, 50)
    assert r["du_du_lieu_de_tinh"] is True
    assert r["thang_diem_phu_hop"] == "SCORE2"


def test_score2_op_cho_tren_70_tuoi():
    r = compute_score2_applicability(75, "Nu", False, 130, 200, 50)
    assert r["thang_diem_phu_hop"] == "SCORE2-OP"


def test_score2_khong_ap_dung_duoi_40_tuoi():
    r = compute_score2_applicability(30, "Nam", False, 120, 180, 55)
    assert r["thang_diem_phu_hop"] is None


def test_score2_thieu_cholesterol_khong_tinh_duoc():
    r = compute_score2_applicability(60, "Nam", True, 140, None, None)
    assert r["du_du_lieu_de_tinh"] is False
    assert "Cholesterol toàn phần" in r["thieu_du_lieu"]
    assert "HDL-Cholesterol" in r["thieu_du_lieu"]


def test_score2_khong_tu_tinh_diem_thuc_chi_kiem_tra_du_lieu():
    """Đảm bảo hàm KHÔNG trả điểm SCORE2 thật (chưa code công thức) — chỉ
    kiểm tra applicability, đúng nguyên tắc không tự suy diễn hệ số y khoa."""
    r = compute_score2_applicability(55, "Nam", False, 130, 200, 50)
    assert "diem_so" not in r
    assert "score2_value" not in r


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
