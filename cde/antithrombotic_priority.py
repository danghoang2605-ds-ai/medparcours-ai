"""
antithrombotic_priority.py — Quy tắc ưu tiên điều trị chống huyết khối khi
bệnh nhân thuộc NHIỀU nhóm bệnh cùng lúc (Vấn đề 2, mục 10 — anh Tấn cung cấp).

NGUYÊN TẮC CHUNG (trích nguyên văn ý chính từ anh Tấn):
  "KHÔNG ưu tiên theo nhóm ICD" — không nói nhóm van tim thắng nhóm mạch
  vành hay ngược lại. Ưu tiên theo CHỈ ĐỊNH ĐIỀU TRỊ CỤ THỂ, THỜI ĐIỂM BỆNH,
  và NGUY CƠ HIỆN TẠI.

  - Van cơ học -> VKA là "chỉ định bắt buộc" (mandatory), suốt đời. KHÔNG
    được thay bằng DOAC hoặc kháng kết tập tiểu cầu đơn độc.
  - PCI/stent -> kháng kết tập tiểu cầu là "chỉ định thêm có thời hạn"
    (time-limited), cần ngày đánh giá lại/ngày dừng dự kiến.
  - Khi cả 2 cùng có: phối hợp VKA + antiplatelet, đánh dấu nguy cơ cao;
    3 thuốc (VKA+aspirin+clopidogrel) = nguy cơ chảy máu rất cao, không nên
    kéo dài mặc định.

ĐÂY LÀ MODULE CROSS-CUTTING (không gắn vào 1 profile/nhóm ICD cụ thể) — đúng
nguyên tắc đã thống nhất trong SDS: tương tác thuốc xảy ra GIỮA các nhóm
bệnh khác nhau, không thuộc về riêng nhóm nào.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from clinical_rules import resolve_generic, GENERIC_GROUPS


VKA_GENERICS = {"acenocoumarol", "warfarin"}
DOAC_GENERICS = {"rivaroxaban", "apixaban", "dabigatran", "edoxaban"}
ANTIPLATELET_GENERICS = {"aspirin", "clopidogrel", "ticagrelor"}


def _classify_drug_roles(drugs: list) -> dict:
    """Phân loại từng thuốc trong đơn vào vai trò chống huyết khối (VKA/DOAC/
    antiplatelet/khác), dùng resolve_generic() có sẵn để chuẩn hóa tên."""
    vka, doac, antiplatelet, others = [], [], [], []
    for d in drugs or []:
        name = d.get("ten_thuoc") or d.get("ten_goc") or ""
        generic = resolve_generic(name)
        if generic in VKA_GENERICS:
            vka.append(name)
        elif generic in DOAC_GENERICS:
            doac.append(name)
        elif generic in ANTIPLATELET_GENERICS:
            antiplatelet.append(name)
        else:
            others.append(name)
    return {"vka": vka, "doac": doac, "antiplatelet": antiplatelet, "others": others}


def evaluate_antithrombotic_regimen(drugs: list, has_mechanical_valve: bool,
                                      has_recent_pci_or_acs: bool = False) -> dict:
    """
    Đánh giá phác đồ chống huyết khối hiện tại theo đúng nguyên tắc ưu tiên
    của anh Tấn — trả về cảnh báo/nhãn nguy cơ, KHÔNG tự đổi thuốc.

    has_mechanical_valve: từ active_profiles (valve_disease, subtype=mechanical)
    has_recent_pci_or_acs: từ active_groups (I20, có PCI/stent/ACS trong text)

    QUAN TRỌNG: hàm này CHỈ đánh giá phác đồ ĐANG CÓ trong đơn thuốc — không
    tự đề xuất kê thêm/bớt thuốc (đó là quyết định của bác sĩ).
    """
    roles = _classify_drug_roles(drugs)
    n_vka = len(roles["vka"])
    n_doac = len(roles["doac"])
    n_antiplatelet = len(roles["antiplatelet"])

    alerts = []
    flags = {}

    # ── Chỉ định bắt buộc: van cơ học PHẢI có VKA, KHÔNG được thay bằng DOAC
    # hoặc antiplatelet đơn độc (đúng nguyên văn "mandatory indication") ─────
    if has_mechanical_valve:
        flags["chi_dinh_bat_buoc"] = "VKA (van cơ học) — suốt đời, không thay thế"
        if n_vka == 0:
            if n_doac > 0:
                alerts.append({
                    "muc": "critical",
                    "tieu_de": "Van cơ học đang dùng DOAC thay vì VKA — KHÔNG ĐÚNG CHỈ ĐỊNH",
                    "noi_dung": (
                        f"Bệnh nhân van cơ học nhưng đơn thuốc chỉ có DOAC ({', '.join(roles['doac'])}), "
                        f"không có kháng vitamin K. DOAC KHÔNG phòng được huyết khối van cơ học — "
                        f"đây là chống chỉ định theo guideline, không phải lựa chọn thay thế hợp lệ."
                    ),
                    "nguon": "ESC/EACTS Valve Guidelines; AHA/ACC Valve Guidelines",
                })
            elif n_antiplatelet > 0:
                alerts.append({
                    "muc": "critical",
                    "tieu_de": "Van cơ học chỉ dùng kháng kết tập tiểu cầu — KHÔNG ĐÚNG CHỈ ĐỊNH",
                    "noi_dung": (
                        f"Bệnh nhân van cơ học nhưng đơn thuốc chỉ có kháng kết tập tiểu cầu "
                        f"({', '.join(roles['antiplatelet'])}), không có VKA. Aspirin/clopidogrel "
                        f"KHÔNG phòng được huyết khối van cơ học thay cho VKA."
                    ),
                    "nguon": "Anh Tấn (Vấn đề 2): 'Aspirin hoặc clopidogrel không phòng được "
                             "huyết khối van cơ học thay cho VKA'",
                })
            else:
                alerts.append({
                    "muc": "critical",
                    "tieu_de": "Van cơ học CHƯA thấy thuốc chống đông trong đơn",
                    "noi_dung": "Bệnh nhân van cơ học cần kháng vitamin K suốt đời — "
                                "không thấy VKA/DOAC/antiplatelet nào trong đơn thuốc hiện tại.",
                    "nguon": "ESC/EACTS 2021; AHA/ACC 2020",
                })

    # ── Phối hợp VKA + antiplatelet: đánh dấu nguy cơ theo SỐ THUỐC phối hợp ─
    if n_vka > 0 and n_antiplatelet > 0:
        if n_antiplatelet >= 2:
            flags["phoi_hop"] = "triple_antithrombotic"
            alerts.append({
                "muc": "critical",
                "tieu_de": "Điều trị BA thuốc chống huyết khối (VKA + 2 kháng kết tập tiểu cầu)",
                "noi_dung": (
                    f"Đang phối hợp VKA ({', '.join(roles['vka'])}) với {n_antiplatelet} thuốc "
                    f"kháng kết tập tiểu cầu ({', '.join(roles['antiplatelet'])}). Đây là tình huống "
                    f"NGUY CƠ CHẢY MÁU RẤT CAO — không nên kéo dài mặc định, cần ngày đánh giá lại rõ ràng."
                ),
                "nguon": "Anh Tấn (Vấn đề 2): 'Điều trị ba thuốc... rất cao, không nên kéo dài mặc định'",
            })
        else:
            flags["phoi_hop"] = "dual_antithrombotic"
            muc = "critical" if not has_recent_pci_or_acs else "warning"
            alerts.append({
                "muc": muc,
                "tieu_de": "Điều trị HAI thuốc chống huyết khối (VKA + kháng kết tập tiểu cầu)",
                "noi_dung": (
                    f"Đang phối hợp VKA ({', '.join(roles['vka'])}) với kháng kết tập tiểu cầu "
                    f"({', '.join(roles['antiplatelet'])}). Cần chỉ định rõ ràng (ví dụ PCI/stent/ACS gần đây)"
                    + (" — đã phát hiện có PCI/ACS trong hồ sơ, phù hợp chỉ định thêm có thời hạn."
                       if has_recent_pci_or_acs else
                       " — KHÔNG thấy PCI/stent/ACS gần đây trong hồ sơ, cần xem lại có còn chỉ định không.")
                ),
                "nguon": "Anh Tấn (Vấn đề 2): chỉ định thêm có thời hạn cần ngày đánh giá lại",
            })

    return {
        "vai_tro_thuoc": roles,
        "co_van_co_hoc": has_mechanical_valve,
        "co_pci_acs_gan_day": has_recent_pci_or_acs,
        "alerts": alerts,
        "flags": flags,
        "chi_so_can_theo_doi_uu_tien": (
            ["INR", "TTR", "Hemoglobin", "Hematocrit", "Số lượng tiểu cầu",
             "Dấu hiệu xuất huyết tiêu hóa/tiết niệu/dưới da"]
            if (n_vka > 0 and n_antiplatelet > 0) else []
        ),
    }
