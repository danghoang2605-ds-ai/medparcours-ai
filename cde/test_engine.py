"""
test_engine.py — Test cho Clinical Decision Engine v2 (Layer 1-5).

Bao gồm test HỒI QUY cho bug đã phát hiện qua chính việc viết engine này:
bệnh nhân sửa van bị phân loại nhầm subtype "mechanical" do NEGATION_PHRASES
thiếu cụm "khong phai" — đã sửa trong clinical_rules.py, giữ test ở đây để
không bị quay lại lỗi cũ.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from disease_classifier import classify_profiles, has_profile, identify_patient
from indicators import is_applicable
from engine import evaluate_v2


def _report(chan_doan, tien_su="", labs=None, drugs=None, tuoi=62, gioi="Nam"):
    return {
        "thong_tin_benh_nhan": {"tuoi": tuoi, "gioi_tinh": gioi},
        "chan_doan_chinh": chan_doan,
        "tien_su_benh": tien_su,
        "dau_hieu_sinh_ton": {},
        "xet_nghiem_key": labs or [],
        "thuoc_cuoi_ky": drugs or [],
    }


# ─── TEST HỒI QUY: subtype không bị nhầm khi có phủ định ─────────────────────
def test_valve_repair_khong_bi_nham_thanh_mechanical():
    """Bug đã phát hiện: 'đã sửa van. Không phải van cơ học.' từng bị phân
    loại subtype=mechanical. Phải là subtype=repair."""
    r = _report("Hở van hai lá nhiều, đã sửa van. Không phải van cơ học.")
    profiles = classify_profiles(r)
    assert has_profile(profiles, "valve_disease")
    assert has_profile(profiles, "valve_disease", "repair")
    assert not has_profile(profiles, "valve_disease", "mechanical")


def test_valve_mechanical_dung_phan_loai():
    r = _report("Sau phẫu thuật thay van động mạch chủ cơ học On-X.")
    profiles = classify_profiles(r)
    assert has_profile(profiles, "valve_disease", "mechanical")


def test_van_sinh_hoc_st_jude_khong_bi_nham_thanh_co_hoc():
    """Bug thật đã sửa (báo cáo từ chuyên gia y tế): 'St Jude' là tên hãng
    sản xuất CẢ van cơ học (St Jude Regent/Master) VÀ van sinh học (St Jude
    Epic) — trước đây thứ tự kiểm tra 'mechanical' TRƯỚC 'bioprosthetic'
    khiến 1 hồ sơ ghi rõ 'van sinh học St Jude Epic' bị phân loại NHẦM
    thành van cơ học, áp sai ngưỡng INR (2.5-3.5/3.0-4.0 thay vì không cần
    chống đông suốt đời) — rủi ro lâm sàng thật."""
    r = _report("Thay van sinh học St Jude Epic vị trí động mạch chủ.")
    profiles = classify_profiles(r)
    assert has_profile(profiles, "valve_disease", "bioprosthetic")
    assert not has_profile(profiles, "valve_disease", "mechanical")


def test_valve_mechanical_theo_ten_van_khong_kem_chu_van_co_hoc():
    """Bug đã phát hiện: hồ sơ chỉ ghi tên van cụ thể (CarboMedics/ATS/
    Medtronic Open Pivot/Sorin BiCarbon) mà KHÔNG kèm cụm "van cơ học" bị
    phân loại SAI subtype (không nhận ra là mechanical) — vì
    anticoagulation_targets.py đã xử lý logic riêng cho các tên van này
    (VALVE_GENERATION_LOW_RISK/MEDIUM_RISK) nhưng disease_classifier.py lại
    thiếu chính các từ khóa đó ở bước phân loại subtype đầu tiên."""
    for ten_van in ["CarboMedics", "ATS", "Medtronic Open Pivot", "Sorin BiCarbon"]:
        r = _report(f"Sau phẫu thuật thay van hai lá {ten_van} số 27.")
        profiles = classify_profiles(r)
        assert has_profile(profiles, "valve_disease", "mechanical"), f"Van '{ten_van}' phải được nhận diện là mechanical"


def test_benh_nhan_khong_co_benh_van_khong_active_valve_profile():
    r = _report("Nhiễm trùng tiểu. Viêm phổi.")
    profiles = classify_profiles(r)
    assert not has_profile(profiles, "valve_disease")


# ─── TEST: 1 bệnh nhân thuộc nhiều profile cùng lúc ───────────────────────────
def test_benh_nhan_co_ca_van_co_hoc_va_rung_nhi():
    r = _report("Sau thay van cơ học On-X. Rung nhĩ mạn tính.")
    profiles = classify_profiles(r)
    assert has_profile(profiles, "valve_disease", "mechanical")
    assert has_profile(profiles, "atrial_fibrillation")
    assert len(profiles) == 2


def test_ckd_active_tu_egfr_thap_khong_can_keyword():
    """CKD phải active dù hồ sơ không có chữ 'suy thận' — chỉ cần eGFR thấp
    qua tính toán (calculated_trigger), đúng góp ý Tấn về việc profile có
    thể kích hoạt từ kết quả tính toán, không chỉ từ keyword."""
    r = _report("Sau mổ tim.", labs=[
        {"key": "Creatinin", "rawVal": 250, "trend": [250]},
    ], tuoi=70)
    egfr = 25  # giả lập eGFR thấp (không gọi compute_egfr thật ở đây để test độc lập)
    profiles = classify_profiles(r, egfr=egfr)
    assert has_profile(profiles, "ckd")


# ─── TEST: Indicator applicability (Layer 3) ──────────────────────────────────
def test_inr_target_mechanical_chi_applicable_khi_dung_subtype():
    profiles_mechanical = [{"profile_id": "valve_disease", "subtype": "mechanical", "ten_hien_thi": "x", "confidence": "x"}]
    profiles_repair = [{"profile_id": "valve_disease", "subtype": "repair", "ten_hien_thi": "x", "confidence": "x"}]
    assert is_applicable("inr_target_mechanical", profiles_mechanical) is True
    assert is_applicable("inr_target_mechanical", profiles_repair) is False


def test_valve_gradient_applicable_cho_moi_subtype_van():
    profiles_repair = [{"profile_id": "valve_disease", "subtype": "repair", "ten_hien_thi": "x", "confidence": "x"}]
    assert is_applicable("valve_gradient", profiles_repair) is True


def test_valve_gradient_khong_applicable_khi_khong_co_benh_van():
    assert is_applicable("valve_gradient", []) is False


def test_ttr_applicable_cho_ca_valve_va_af_khong_chi_rieng_valve():
    """Sửa đúng Vấn đề 1: TTR không còn ngầm định 'có INR = van cơ học'."""
    profiles_af_only = [{"profile_id": "atrial_fibrillation", "subtype": None, "ten_hien_thi": "x", "confidence": "x"}]
    assert is_applicable("ttr", profiles_af_only) is True


def test_ttr_canh_bao_hau_phau_khi_da_mo_chua_ra_vien():
    """Đã mổ (có phau_thuat.ngay) nhưng CHƯA ra viện -> TTR phải kèm cảnh
    báo rõ 'chỉ mang tính tham khảo do liều chống đông chưa ổn định' -
    tránh bác sĩ hiểu nhầm TTR hậu phẫu có ý nghĩa như TTR ổn định lâu dài.

    Dùng kịch bản "sửa van" (không phải van cơ học On-X không yếu tố nguy
    cơ) — case đó rơi vào nhánh "chỉ 1 điểm mục tiêu, không tính khoảng"
    của chính rule engine van cơ học (đúng thiết kế, không liên quan is_
    postop). Lưu ý định dạng labs: engine.py đọc field "trend" (mảng số)
    của MỘT entry duy nhất, không phải nhiều entry riêng mỗi cái 1 rawVal.
    """
    r = _report("Sau phẫu thuật sửa van hai lá.",
                labs=[{"key": "INR", "rawVal": 3.2, "trend": [2.1, 2.8, 3.2]}],
                drugs=[{"ten_thuoc": "Acenocoumarol"}])
    r["phau_thuat"] = {"ngay": "01/01/2026", "phuong_phap": "Sửa van hai lá"}
    r["ngay_ra_vien"] = ""  # chưa ra viện
    result = evaluate_v2(r)
    ttr = result.get("ttr")
    assert ttr is not None
    assert ttr["canh_bao_hau_phau"] is True
    assert "tham khảo" in ttr["canh_bao_hau_phau_noi_dung"]


def test_ttr_khong_canh_bao_hau_phau_khi_da_ra_vien():
    """Đã ra viện (ngoại trú tái khám) -> KHÔNG gắn cảnh báo hậu phẫu,
    chống đông giai đoạn này coi như đã ổn định hơn."""
    r = _report("Sau phẫu thuật sửa van hai lá.",
                labs=[{"key": "INR", "rawVal": 3.2, "trend": [2.1, 2.8, 3.2]}],
                drugs=[{"ten_thuoc": "Acenocoumarol"}])
    r["phau_thuat"] = {"ngay": "01/01/2026", "phuong_phap": "Sửa van hai lá"}
    r["ngay_ra_vien"] = "10/01/2026"
    result = evaluate_v2(r)
    ttr = result.get("ttr")
    assert ttr is not None
    assert ttr["canh_bao_hau_phau"] is False
    assert "canh_bao_hau_phau_noi_dung" not in ttr


def test_egfr_luon_applicable_khong_can_profile():
    assert is_applicable("egfr", []) is True


# ─── TEST: engine.py end-to-end (Layer 1-5 tích hợp) ──────────────────────────
def test_evaluate_v2_tra_active_profiles():
    r = _report("Thay van cơ học On-X. Rung nhĩ.", labs=[
        {"key": "INR", "rawVal": 2.5, "trend": [2.0, 2.5, 3.0]},
    ])
    out = evaluate_v2(r)
    assert "active_profiles" in out
    profile_ids = [p["profile_id"] for p in out["active_profiles"]]
    assert "valve_disease" in profile_ids
    assert "atrial_fibrillation" in profile_ids
    # Tương thích ngược: field cũ vẫn còn
    assert "risk_scores" in out
    assert "egfr" in out


def test_evaluate_v2_khong_tinh_cha2ds2vasc_khi_khong_co_af_profile():
    r = _report("Viêm phổi. Không có bệnh tim mạch.")
    out = evaluate_v2(r)
    assert out["risk_scores"]["cha2ds2_vasc"] is None
    assert out["risk_scores"]["has_bled"] is None


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
