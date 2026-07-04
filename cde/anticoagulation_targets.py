"""
anticoagulation_targets.py — Ngưỡng INR mục tiêu theo subtype van + xử lý DOAC.

NGUỒN: Bảng khuyến cáo ESC/EACTS 2021 và AHA/ACC 2020 do anh Tấn cung cấp
(xem tài liệu gửi kèm, đã trích nguyên văn từng mức khuyến cáo bên dưới).
Đây là module DUY NHẤT chứa ngưỡng INR — Layer 4 (engine.py) chỉ gọi hàm ở
đây, KHÔNG tự tính ngưỡng ở nơi khác (đúng nguyên tắc "guideline không viết
trong Prompt, không rải rác nhiều nơi").

NGUYÊN TẮC MINH BẠCH: khi dữ liệu hồ sơ KHÔNG đủ để xác định chính xác phân
nhóm (ví dụ van cơ học nhưng không rõ vị trí van/thế hệ van/yếu tố nguy cơ),
hàm trả "khong_xac_dinh_day_du" kèm lý do cụ thể, KHÔNG tự đoán để có vẻ đầy
đủ — đúng tinh thần toàn hệ thống.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from clinical_rules import _strip_accents

# ─── 1. NGƯỠNG THEO SUBTYPE (sửa van / sinh học / không liên quan van) ───────
# Đây là 3 nhóm ĐƠN GIẢN — chỉ 1 mức ngưỡng, không phân tầng thêm.
SIMPLE_TARGETS = {
    "repair": {
        "ten_hien_thi": "Sửa van tim (mitral/tricuspid repair)",
        "target_min": 2.0, "target_max": 3.0, "target_mid": 2.5,
        "thoi_gian": "3 tháng đầu sau mổ (không phải suốt đời)",
        "nguon": "ESC/EACTS 2021 (mức IIa cho sửa van hai lá/ba lá); "
                 "AHA/ACC 2020 (mức 2a cho sửa van hai lá, nếu nguy cơ chảy máu thấp)",
    },
    "bioprosthetic": {
        "ten_hien_thi": "Thay van sinh học (bioprosthetic)",
        "target_min": 2.0, "target_max": 3.0, "target_mid": 2.5,
        "thoi_gian": "3 tháng đầu sau mổ (không phải suốt đời)",
        "nguon": "ESC/EACTS 2021 (mức IIa, cả van ĐMC và van hai lá sinh học); "
                 "AHA/ACC 2020 (mức 2a cho van hai lá sinh học — với van ĐMC sinh học, "
                 "AHA/ACC ưu tiên Aspirin 75-100mg hơn VKA, mức 2a; VKA vẫn là lựa chọn mức 2b)",
        "luu_y": "AHA/ACC và ESC/EACTS KHÁC NHAU cho van ĐMC sinh học: Mỹ ưu tiên Aspirin, "
                 "Châu Âu ưu tiên VKA 3 tháng đầu. Hệ thống hiển thị ngưỡng VKA (nếu bác sĩ "
                 "đã kê VKA) — KHÔNG tự khuyến nghị đổi sang Aspirin.",
    },
    "native_disease": {
        # Không liên quan van cơ học/sinh học (hẹp/hở van chưa can thiệp, hoặc rung nhĩ
        # không do van) — về bản chất đây là "Vấn đề 1" gốc: nhóm này CHỈ áp ngưỡng VKA
        # khi có chỉ định chống đông thật (ví dụ AF kèm theo), không phải mọi bệnh nhân
        # có bệnh van đều cần ngưỡng này.
        "ten_hien_thi": "Không liên quan thay van (native/rung nhĩ không do van)",
        "target_min": 2.0, "target_max": 3.0, "target_mid": 2.5,
        "thoi_gian": "Suốt đời (nếu có chỉ định chống đông, ví dụ CHA2DS2-VASc ≥1 nam/≥2 nữ)",
        "nguon": "ESC 2024 (Atrial Fibrillation Guidelines): NOAC/DOAC là lựa chọn hàng đầu "
                 "(mức I). VKA chỉ dùng khi NOAC không dung nạp/chống chỉ định, mục tiêu "
                 "TTR phải >70%. AHA/ACC/ACCP/HRS 2023: ưu tiên NOAC hơn VKA (mức 1).",
    },
}

# ─── 2. NGƯỠNG VAN CƠ HỌC — PHÂN TẦNG (phức tạp nhất, 2 hệ khuyến cáo khác) ──
# ESC/EACTS: ma trận "thế hệ van" (nguy cơ sinh huyết khối) x "yếu tố nguy cơ
# bệnh nhân". AHA/ACC: đơn giản hơn nhưng có ngoại lệ riêng cho van On-X.
#
# Vì 1 bệnh án thường KHÔNG ghi đủ "thế hệ van" (vd CarboMedics vs St Jude) và
# "yếu tố nguy cơ" (AF, tiền sử thuyên tắc, LVEF<35%, hẹp hai lá kèm theo) một
# cách tường minh, module này CHỈ tự tính khi đủ dữ liệu — thiếu thì trả rõ
# "khong_xac_dinh_day_du" với checklist cụ thể còn thiếu, KHÔNG đoán.

MECHANICAL_VALVE_RISK_KEYWORDS = {
    # Yếu tố nguy cơ theo ESC/EACTS — nếu CÓ bất kỳ keyword nào trong hồ sơ,
    # tính là "có yếu tố nguy cơ" -> ngưỡng cao hơn trong cùng nhóm vị trí van.
    "rung nhi": "Rung nhĩ",
    "tien su thuyen tac": "Tiền sử thuyên tắc (huyết khối/đột quỵ)",
    "tien su dot quy": "Tiền sử thuyên tắc (huyết khối/đột quỵ)",
    "ef giam": "LVEF < 35%",  # cần đối chiếu thêm số EF thật trong report, xem hàm dưới
    "hep hai la": "Hẹp van hai lá kèm theo",
}

# Một số tên van phổ biến để gợi ý phân loại "thế hệ van" (nguy cơ sinh huyết
# khối thấp/vừa theo ESC/EACTS) — DANH SÁCH CHƯA ĐẦY ĐỦ, chỉ các tên Tấn liệt
# kê. Van không khớp tên nào dưới đây -> "khong_xac_dinh" (không tự đoán).
VALVE_GENERATION_LOW_RISK = ["on-x", "on x", "ats", "medtronic open pivot", "st jude", "st. jude"]
VALVE_GENERATION_MEDIUM_RISK = ["carbomedics", "sorin bicarbon"]


def _has_any_keyword(text: str, keywords) -> bool:
    t = _strip_accents(text)
    return any(k in t for k in keywords)


def _detect_valve_position(text: str) -> str:
    """Trả 'aortic' / 'mitral' / 'tricuspid' / 'multiple' / 'unknown' theo từ
    khóa hồ sơ. Vị trí van quyết định nhánh khuyến cáo nào áp dụng (AHA/ACC
    chia rõ theo vị trí: ĐMC nguy cơ thấp khác hẳn van hai lá/ba lá)."""
    t = _strip_accents(text)
    has_aortic = any(k in t for k in ["dong mach chu", "dmc", "aortic"])
    has_mitral = any(k in t for k in ["hai la", "mitral"])
    has_tricuspid = any(k in t for k in ["ba la", "tricuspid"])
    count = sum([has_aortic, has_mitral, has_tricuspid])
    if count >= 2:
        return "multiple"
    if has_aortic:
        return "aortic"
    if has_mitral:
        return "mitral"
    if has_tricuspid:
        return "tricuspid"
    return "unknown"


def _detect_valve_generation_risk(text: str) -> str:
    """Trả 'low' / 'medium' / 'unknown' theo tên van nhận diện được trong hồ sơ."""
    if _has_any_keyword(text, VALVE_GENERATION_LOW_RISK):
        return "low"
    if _has_any_keyword(text, VALVE_GENERATION_MEDIUM_RISK):
        return "medium"
    return "unknown"


def _detect_risk_factors(text: str, ef_percent=None) -> list:
    """Trả list các yếu tố nguy cơ ESC/EACTS tìm thấy trong hồ sơ (keyword +
    đối chiếu số EF thật nếu có, vì 'ef giam' chỉ là gợi ý chữ, số EF<35 mới
    là tiêu chí chính xác)."""
    found = []
    t = _strip_accents(text)
    for kw, label in MECHANICAL_VALVE_RISK_KEYWORDS.items():
        if kw == "ef giam":
            continue  # xử lý riêng bằng số, không bằng keyword chữ
        if kw in t and label not in found:
            found.append(label)
    if ef_percent is not None and ef_percent < 35 and "LVEF < 35%" not in found:
        found.append("LVEF < 35%")
    return found


def get_mechanical_valve_target(text: str, ef_percent=None) -> dict:
    """
    Tính ngưỡng INR cho van cơ học theo ESC/EACTS 2021 (mặc định) — vì đây là
    bộ khuyến cáo phân tầng kỹ hơn AHA/ACC và an toàn hơn khi áp dụng chung
    (ngưỡng ESC luôn >= ngưỡng AHA/ACC tương ứng, trừ ngoại lệ On-X bên dưới).

    Trả về CẢ 2 khuyến cáo (ESC/EACTS và AHA/ACC) để bác sĩ tự đối chiếu —
    KHÔNG ép 1 khuyến cáo duy nhất, vì đây là khác biệt thật giữa 2 hệ thống
    y khoa, không phải lỗi hệ thống.
    """
    position = _detect_valve_position(text)
    generation_risk = _detect_valve_generation_risk(text)
    risk_factors = _detect_risk_factors(text, ef_percent)
    has_risk_factor = len(risk_factors) > 0
    is_on_x = "on-x" in _strip_accents(text) or "on x" in _strip_accents(text)

    missing = []
    if position == "unknown":
        missing.append("Vị trí van (động mạch chủ / hai lá / ba lá) — không xác định được từ hồ sơ")
    if generation_risk == "unknown":
        missing.append("Tên/thế hệ van cụ thể (ví dụ On-X, CarboMedics...) — không xác định được từ hồ sơ")

    # ── ESC/EACTS: ma trận vị trí + thế hệ van + yếu tố nguy cơ ─────────────
    # BẢNG THẬT ESC/EACTS 2021 (đã sửa lỗi thiếu phân biệt vị trí — trước
    # đây áp CÙNG 1 ngưỡng cho van động mạch chủ và van hai lá cùng thế hệ,
    # trong khi guideline gốc quy định van HAI LÁ luôn cần ngưỡng CAO HƠN
    # van ĐỘNG MẠCH CHỦ ở cùng mức thế hệ van + yếu tố nguy cơ):
    #   Nguy cơ thấp, KHÔNG y.t.n.c:  ĐMC 2.5 | Hai lá 3.0
    #   Nguy cơ thấp, CÓ y.t.n.c:     ĐMC 3.0 | Hai lá 3.5
    #   Nguy cơ trung bình, KHÔNG y.t.n.c: ĐMC 3.0 | Hai lá 3.5
    #   Nguy cơ trung bình, CÓ y.t.n.c:    ĐMC 3.5 | Hai lá 4.0
    esc_result = None
    if position == "tricuspid":
        esc_result = {"target_min": 3.0, "target_max": 4.0, "target_mid": 3.5,
                       "ghi_chu": "Van ba lá / phối hợp nhiều van — ngưỡng cao nhất theo ESC/EACTS"}
    elif position == "multiple":
        esc_result = {"target_min": 3.0, "target_max": 4.0, "target_mid": 3.5,
                       "ghi_chu": "Phối hợp nhiều van — ngưỡng cao nhất theo ESC/EACTS"}
    elif position in ("aortic", "mitral") and generation_risk != "unknown":
        is_mitral = position == "mitral"
        pos_label = "van hai lá" if is_mitral else "van động mạch chủ"
        if generation_risk == "low":
            if has_risk_factor:
                esc_result = ({"target_min": 3.0, "target_max": 4.0, "target_mid": 3.5,
                                "ghi_chu": f"Van nguy cơ thấp (On-X/ATS/Medtronic Open Pivot/St Jude), {pos_label}, có yếu tố nguy cơ"}
                              if is_mitral else
                              {"target_min": 3.0, "target_max": 3.5, "target_mid": 3.0,
                                "ghi_chu": f"Van nguy cơ thấp (On-X/ATS/Medtronic Open Pivot/St Jude), {pos_label}, có yếu tố nguy cơ"})
            else:
                esc_result = ({"target_min": None, "target_max": None, "target_mid": 3.0, "chi_la_diem_don": True,
                                "ghi_chu": f"Van nguy cơ thấp, {pos_label}, không yếu tố nguy cơ — ESC/EACTS CHỈ ghi 1 điểm "
                                           f"mục tiêu (3.0), KHÔNG ghi khoảng dao động. Hệ thống KHÔNG tự suy diễn khoảng — "
                                           f"cần Tấn/Ngân xác nhận khoảng dao động hợp lý trước khi tính TTR."}
                              if is_mitral else
                              {"target_min": None, "target_max": None, "target_mid": 2.5, "chi_la_diem_don": True,
                                "ghi_chu": f"Van nguy cơ thấp, {pos_label}, không yếu tố nguy cơ — ESC/EACTS CHỈ ghi 1 điểm "
                                           f"mục tiêu (2.5), KHÔNG ghi khoảng dao động. Hệ thống KHÔNG tự suy diễn khoảng — "
                                           f"cần Tấn/Ngân xác nhận khoảng dao động hợp lý trước khi tính TTR."})
        else:  # medium
            if has_risk_factor:
                esc_result = ({"target_min": 3.5, "target_max": 4.5, "target_mid": 4.0,
                                "ghi_chu": f"Van nguy cơ trung bình (CarboMedics/Sorin BiCarbon), {pos_label}, có yếu tố nguy cơ"}
                              if is_mitral else
                              {"target_min": 3.0, "target_max": 3.5, "target_mid": 3.5,
                                "ghi_chu": f"Van nguy cơ trung bình (CarboMedics/Sorin BiCarbon), {pos_label}, có yếu tố nguy cơ"})
            else:
                esc_result = ({"target_min": None, "target_max": None, "target_mid": 3.5, "chi_la_diem_don": True,
                                "ghi_chu": f"Van nguy cơ trung bình, {pos_label}, không yếu tố nguy cơ — ESC/EACTS CHỈ ghi 1 "
                                           f"điểm mục tiêu (3.5), KHÔNG ghi khoảng dao động. Hệ thống KHÔNG tự suy diễn "
                                           f"khoảng — cần Tấn/Ngân xác nhận khoảng dao động hợp lý trước khi tính TTR."}
                              if is_mitral else
                              {"target_min": None, "target_max": None, "target_mid": 3.0, "chi_la_diem_don": True,
                                "ghi_chu": f"Van nguy cơ trung bình, {pos_label}, không yếu tố nguy cơ — ESC/EACTS CHỈ ghi 1 "
                                           f"điểm mục tiêu (3.0), KHÔNG ghi khoảng dao động. Hệ thống KHÔNG tự suy diễn "
                                           f"khoảng — cần Tấn/Ngân xác nhận khoảng dao động hợp lý trước khi tính TTR."})

    # ── AHA/ACC: đơn giản hơn, có ngoại lệ On-X sau 3 tháng ─────────────────
    ahaacc_result = None
    if position == "aortic" and is_on_x:
        ahaacc_result = {"target_min": 1.5, "target_max": 2.0, "target_mid": 1.75,
                          "ghi_chu": "Van ĐMC On-X, SAU 3 THÁNG ĐẦU, kèm Aspirin 81mg "
                                     "(khuyến cáo mức 2b — KHÁC ESC/EACTS, cần bác sĩ quyết định "
                                     "theo phác đồ đang theo, không tự chuyển đổi)"}
    elif position == "aortic" and not has_risk_factor:
        ahaacc_result = {"target_min": 2.0, "target_max": 3.0, "target_mid": 2.5,
                          "ghi_chu": "Van ĐMC kinh điển, nguy cơ thấp (mức 1)"}
    elif position in ("mitral",) or has_risk_factor:
        ahaacc_result = {"target_min": 2.5, "target_max": 3.5, "target_mid": 3.0,
                          "ghi_chu": "Van hai lá cơ học, hoặc van ĐMC có yếu tố nguy cơ (mức 1)"}

    return {
        "vi_tri_van": position,
        "the_he_van_nguy_co": generation_risk,
        "yeu_to_nguy_co_phat_hien": risk_factors,
        "esc_eacts_2021": esc_result,
        "ahaacc_2020": ahaacc_result,
        "thieu_du_lieu": missing,
        "day_du_du_lieu": len(missing) == 0,
        "nguon": "ESC/EACTS 2021 (phân tầng theo thế hệ van + yếu tố nguy cơ); "
                 "AHA/ACC 2020 (đơn giản hơn, ngoại lệ riêng cho van ĐMC On-X sau 3 tháng)",
    }


# ─── 3. DOAC vs VKA — quyết định ẩn/hiện hoàn toàn INR/TTR ───────────────────
DOAC_DRUG_NAMES = [
    "rivaroxaban", "xarelto", "apixaban", "eliquis", "dabigatran", "pradaxa",
    "edoxaban", "lixiana",
]
VKA_DRUG_NAMES = [
    "acenocoumarol", "sintrom", "syntrom", "warfarin", "coumadin",
]


def classify_anticoagulant(drug_list: list) -> dict:
    """
    Quét danh sách thuốc, trả nhóm chống đông đang dùng: 'vka' / 'doac' /
    'none' / 'both' (hiếm, nhưng cần biết để không bỏ sót cảnh báo tương tác).

    QUYẾT ĐỊNH HIỂN THỊ (theo yêu cầu anh Tấn):
      - VKA: hiển thị đầy đủ ngưỡng INR mục tiêu + giá trị INR gần nhất + TTR.
      - DOAC: ẨN HOÀN TOÀN trường INR/TTR, thay bằng nhãn trạng thái + nhắc
        theo dõi eGFR/CrCl định kỳ (DOAC thải qua thận, cần theo dõi chức
        năng thận, không phải INR).
    """
    names = " ".join((d.get("ten_thuoc") or "") for d in (drug_list or [])).lower()
    has_doac = any(k in names for k in DOAC_DRUG_NAMES)
    has_vka = any(k in names for k in VKA_DRUG_NAMES)

    doac_matched = next((d.get("ten_thuoc") for d in (drug_list or [])
                          if any(k in (d.get("ten_thuoc") or "").lower() for k in DOAC_DRUG_NAMES)), None)

    if has_doac and has_vka:
        nhom = "both"
    elif has_doac:
        nhom = "doac"
    elif has_vka:
        nhom = "vka"
    else:
        nhom = "none"

    return {
        "nhom": nhom,
        "ten_thuoc_doac": doac_matched,
        "an_inr_ttr": nhom == "doac",
        "thong_bao_doac": (
            f"Thuốc đang dùng: DOAC ({doac_matched}). Không chỉ định theo dõi bằng INR/TTR. "
            f"Cần theo dõi: chức năng thận (eGFR/CrCl) định kỳ."
        ) if nhom == "doac" else None,
    }
