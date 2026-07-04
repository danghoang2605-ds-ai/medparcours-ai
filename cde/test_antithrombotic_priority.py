"""
test_antithrombotic_priority.py — Test quy tắc ưu tiên đa thuốc chống huyết
khối (Vấn đề 2, mục 10).

TEST HỒI QUY QUAN TRỌNG: bug nghiêm trọng trong clinical_rules.resolve_generic()
phát hiện qua việc viết test này — thuốc viết tên generic trực tiếp (không
qua brand, không có ngoặc, vd "Aspirin 81mg") trả về None, khiến MỌI rule
tương tác/ưu tiên thuốc liên quan các thuốc viết kiểu này không hoạt động.
Đã sửa trong clinical_rules.py — giữ test ở đây để không quay lại lỗi cũ.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from clinical_rules import resolve_generic
from antithrombotic_priority import evaluate_antithrombotic_regimen


# ─── TEST HỒI QUY: resolve_generic với tên thuốc viết generic trực tiếp ──────
def test_resolve_generic_aspirin_viet_truc_tiep():
    assert resolve_generic("Aspirin 81mg") == "aspirin"


def test_resolve_generic_clopidogrel_viet_truc_tiep():
    assert resolve_generic("Clopidogrel 75mg") == "clopidogrel"


def test_resolve_generic_van_dung_qua_brand():
    """Đảm bảo sửa bug không làm hỏng đường brand cũ vẫn đang chạy đúng."""
    assert resolve_generic("Plavix 75mg") == "clopidogrel"
    assert resolve_generic("Sintrom 4mg") == "acenocoumarol"


# ─── TEST: van cơ học — chỉ định bắt buộc VKA ────────────────────────────────
def test_van_co_hoc_dung_doac_thay_vka_bi_canh_bao_critical():
    r = evaluate_antithrombotic_regimen(
        [{"ten_thuoc": "Xarelto 20mg"}], has_mechanical_valve=True
    )
    assert any(a["muc"] == "critical" for a in r["alerts"])
    assert "DOAC" in r["alerts"][0]["tieu_de"]


def test_van_co_hoc_chi_dung_antiplatelet_bi_canh_bao():
    r = evaluate_antithrombotic_regimen(
        [{"ten_thuoc": "Aspirin 81mg"}], has_mechanical_valve=True
    )
    assert any(a["muc"] == "critical" for a in r["alerts"])


def test_van_co_hoc_khong_co_thuoc_chong_dong_nao_bi_canh_bao():
    r = evaluate_antithrombotic_regimen(
        [{"ten_thuoc": "Furosemide 40mg"}], has_mechanical_valve=True
    )
    assert any("CHƯA thấy thuốc chống đông" in a["tieu_de"] for a in r["alerts"])


def test_van_co_hoc_dung_dung_vka_don_doc_khong_canh_bao():
    r = evaluate_antithrombotic_regimen(
        [{"ten_thuoc": "Sintrom 4mg"}], has_mechanical_valve=True
    )
    assert r["alerts"] == []


# ─── TEST: phối hợp 2 thuốc / 3 thuốc ────────────────────────────────────────
def test_hai_thuoc_vka_va_1_antiplatelet_co_pci_la_warning_khong_critical():
    """Có PCI/ACS gần đây hợp lý hóa phối hợp 2 thuốc -> mức warning, không
    phải critical (đúng nguyên tắc 'chỉ định thêm có thời hạn')."""
    r = evaluate_antithrombotic_regimen(
        [{"ten_thuoc": "Sintrom 4mg"}, {"ten_thuoc": "Plavix 75mg"}],
        has_mechanical_valve=True, has_recent_pci_or_acs=True,
    )
    dual_alert = next(a for a in r["alerts"] if "HAI thuốc" in a["tieu_de"])
    assert dual_alert["muc"] == "warning"


def test_hai_thuoc_khong_co_pci_la_critical():
    """KHÔNG có PCI/ACS gần đây mà vẫn phối hợp 2 thuốc -> critical (thiếu
    chỉ định rõ ràng)."""
    r = evaluate_antithrombotic_regimen(
        [{"ten_thuoc": "Sintrom 4mg"}, {"ten_thuoc": "Plavix 75mg"}],
        has_mechanical_valve=True, has_recent_pci_or_acs=False,
    )
    dual_alert = next(a for a in r["alerts"] if "HAI thuốc" in a["tieu_de"])
    assert dual_alert["muc"] == "critical"


def test_ba_thuoc_luon_critical_va_co_flag_triple():
    r = evaluate_antithrombotic_regimen(
        [{"ten_thuoc": "Sintrom 4mg"}, {"ten_thuoc": "Aspirin 81mg"}, {"ten_thuoc": "Plavix 75mg"}],
        has_mechanical_valve=True, has_recent_pci_or_acs=True,
    )
    assert r["flags"]["phoi_hop"] == "triple_antithrombotic"
    triple_alert = next(a for a in r["alerts"] if "BA thuốc" in a["tieu_de"])
    assert triple_alert["muc"] == "critical"


def test_chi_so_can_theo_doi_uu_tien_xuat_hien_khi_co_phoi_hop():
    r = evaluate_antithrombotic_regimen(
        [{"ten_thuoc": "Sintrom 4mg"}, {"ten_thuoc": "Aspirin 81mg"}],
        has_mechanical_valve=True,
    )
    assert "INR" in r["chi_so_can_theo_doi_uu_tien"]
    assert "Hemoglobin" in r["chi_so_can_theo_doi_uu_tien"]


def test_khong_co_phoi_hop_thi_chi_so_theo_doi_rong():
    r = evaluate_antithrombotic_regimen(
        [{"ten_thuoc": "Sintrom 4mg"}], has_mechanical_valve=True,
    )
    assert r["chi_so_can_theo_doi_uu_tien"] == []


# ─── TEST: không có van cơ học thì không bắt buộc gì ─────────────────────────
def test_khong_co_van_co_hoc_khong_bi_ep_phai_co_vka():
    r = evaluate_antithrombotic_regimen(
        [{"ten_thuoc": "Aspirin 81mg"}], has_mechanical_valve=False,
    )
    assert "chi_dinh_bat_buoc" not in r["flags"]
    assert r["alerts"] == []


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
