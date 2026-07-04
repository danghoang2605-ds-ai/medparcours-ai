"""
test_icd_groups.py — Test cho module phân loại 10 nhóm ICD-10 (Vấn đề 2).

2 TEST HỒI QUY QUAN TRỌNG cho bug đã phát hiện khi viết module này:
  1. Keyword viết tắt "tha" (tăng huyết áp) khớp nhầm substring của "THAy van"
     -> giả dương I10 cho mọi bệnh nhân có chữ "thay van". Đã bỏ viết tắt
     ngắn nguy hiểm này.
  2. Subtype có cả default=True VÀ keywords riêng (vd valve_disease_non_
     rheumatic) bị "continue" ngay khi thấy default=True, KHÔNG BAO GIỜ
     được kiểm tra keyword thật -> luôn bị bỏ sót dù khớp. Đã sửa thứ tự
     kiểm tra: keyword luôn được check trước, default chỉ là phương án cuối.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from clinical_rules import _strip_accents
from icd_groups import classify_icd_groups, has_icd_group, ICD_GROUPS


def _classify(text_co_dau):
    """Helper: bỏ dấu trước khi classify, đúng cách dùng thật của module."""
    return classify_icd_groups(_strip_accents(text_co_dau))


# ─── TEST HỒI QUY 1: keyword "tha" giả dương với "thay van" ──────────────────
def test_thay_van_khong_bi_nham_thanh_tang_huyet_ap():
    groups = _classify("Thay van động mạch chủ cơ học On-X.")
    assert not has_icd_group(groups, "I10_tang_huyet_ap")


def test_tang_huyet_ap_thuc_su_van_nhan_dien_dung():
    """Đảm bảo việc sửa bug không làm mất khả năng nhận diện THA thật."""
    groups = _classify("Tăng huyết áp độ 2, đang điều trị.")
    assert has_icd_group(groups, "I10_tang_huyet_ap")


# ─── TEST HỒI QUY 2: subtype default=True che mất keyword thật của chính nó ──
def test_van_co_hoc_van_duoc_nhan_dien_du_la_subtype_default():
    """valve_disease_non_rheumatic vừa là default vừa có keyword riêng — PHẢI
    được nhận diện qua keyword thật, không chỉ qua default fallback."""
    groups = _classify("Thay van động mạch chủ cơ học On-X.")
    assert has_icd_group(groups, "I30_the_khac_benh_tim", "valve_disease_non_rheumatic")


def test_benh_nhan_da_benh_canh_tra_ve_nhieu_subtype_cung_luc():
    """Case gốc phát hiện bug: van + rung nhĩ + mạch vành cùng lúc -> phải
    có ĐỦ 3 bệnh cảnh, không chỉ 1."""
    groups = _classify(
        "Thay van động mạch chủ cơ học On-X. Rung nhĩ mạn tính. Đặt stent mạch vành."
    )
    assert has_icd_group(groups, "I20_tim_thieu_mau_cuc_bo")
    assert has_icd_group(groups, "I30_the_khac_benh_tim", "atrial_fibrillation")
    assert has_icd_group(groups, "I30_the_khac_benh_tim", "valve_disease_non_rheumatic")
    # Đếm đúng 2 entry riêng cho I30 (không gộp thành 1, không chọn 1 bỏ 1)
    i30_entries = [g for g in groups if g["icd_group"] == "I30_the_khac_benh_tim"]
    assert len(i30_entries) == 2


def test_default_subtype_dung_khi_khong_co_subtype_cu_the_nao_khop():
    """Nếu I30 active nhưng không khớp suy tim/AF/IE/pericarditis cụ thể nào
    -> rơi về default (valve_disease_non_rheumatic), đúng hành vi fallback."""
    groups = _classify("Hẹp van hai lá nhẹ, theo dõi định kỳ.")
    assert has_icd_group(groups, "I30_the_khac_benh_tim", "valve_disease_non_rheumatic")


# ─── TEST: 10 nhóm đều có đủ field cần thiết ─────────────────────────────────
def test_tat_ca_10_nhom_icd_co_du_field():
    assert len(ICD_GROUPS) == 10
    for group_id, group_def in ICD_GROUPS.items():
        assert "ten_hien_thi" in group_def
        assert "icd_range" in group_def
        assert "keywords" in group_def
        assert "nguon" in group_def


# ─── TEST: từng nhóm nhận diện đúng case điển hình ───────────────────────────
def test_i00_thap_tim_cap():
    groups = _classify("Sốt thấp khớp, viêm họng liên cầu tuần trước.")
    assert has_icd_group(groups, "I00_thap_tim_cap")


def test_i60_mach_mau_nao():
    groups = _classify("Nhồi máu não cấp, NIHSS 8 điểm lúc nhập viện.")
    assert has_icd_group(groups, "I60_mach_mau_nao")


def test_i70_dong_mach():
    groups = _classify("Bệnh động mạch chi dưới, ABI giảm.")
    assert has_icd_group(groups, "I70_dong_mach")


def test_i80_tinh_mach():
    groups = _classify("Huyết khối tĩnh mạch sâu chân trái, đã làm Doppler.")
    assert has_icd_group(groups, "I80_tinh_mach")


def test_i95_khong_nham_voi_nhom_khac():
    """Sốc nhiễm khuẩn không nên bị nhận thêm vào nhóm tim mạch khác không
    liên quan."""
    groups = _classify("Sốc nhiễm khuẩn, huyết áp tụt.")
    assert has_icd_group(groups, "I95_roi_loan_khac")
    assert not has_icd_group(groups, "I20_tim_thieu_mau_cuc_bo")


def test_benh_nhan_khong_co_benh_tim_mach_khong_active_nhom_nao():
    groups = _classify("Viêm phổi cộng đồng, không có tiền sử bệnh tim mạch.")
    assert len(groups) == 0


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
