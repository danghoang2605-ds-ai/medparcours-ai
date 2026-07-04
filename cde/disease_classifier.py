"""
disease_classifier.py — Layer 1 + Layer 2 của Clinical Decision Engine v2

Layer 1 (Patient Identification): trích các trường định danh thô từ report
  (tuổi, giới, text chẩn đoán/tiền sử) — KHÔNG suy luận gì, chỉ gom lại.

Layer 2 (Disease Classifier): với mỗi PROFILE đã đăng ký trong
  PROFILE_REGISTRY, kiểm tra điều kiện kích hoạt (keyword, hoặc kết quả
  tính toán độc lập như eGFR). Một bệnh nhân có thể thuộc 0..N profile
  CÙNG LÚC — không return sớm, không chọn 1.

THIẾT KẾ THEO GÓP Ý CHUYÊN MÔN CỦA ANH TẤN (xem SDS_Clinical_Decision_Engine_v2.md):
  "Đây không phải lỗi AI/Prompt, mà lỗi Clinical Knowledge Architecture —
  team đang encode 1 ca bệnh thay vì encode kiến thức y khoa tổng quát."

NGUYÊN TẮC MỞ RỘNG: thêm 1 profile mới = thêm 1 entry vào PROFILE_REGISTRY,
KHÔNG sửa logic file này.
"""
import sys
import os
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from clinical_rules import _strip_accents, _text_has_any_positive, _gather_text


# ─── LAYER 1: PATIENT IDENTIFICATION ──────────────────────────────────────────
def identify_patient(report: dict) -> dict:
    """Gom các trường định danh thô, KHÔNG suy luận. Dùng làm input cho Layer 2."""
    info = report.get("thong_tin_benh_nhan", {}) or {}
    return {
        "tuoi": info.get("tuoi"),
        "gioi_tinh": info.get("gioi_tinh"),
        "text_chan_doan": _gather_text(report),  # đã bỏ dấu, gộp chẩn đoán+tiền sử+cảnh báo
        "phuong_phap_phau_thuat": _strip_accents(
            (report.get("phau_thuat", {}) or {}).get("phuong_phap", "") or ""
        ),
    }


# ─── ĐĂNG KÝ PROFILE (Layer 2 data) ───────────────────────────────────────────
# Mỗi profile: điều kiện kích hoạt bằng keyword (đa số) hoặc bằng kết quả tính
# toán độc lập (calculated_trigger — ví dụ CKD active khi eGFR < 90, không cần
# bệnh nhân có chữ "suy thận"). subtypes (nếu có) phân loại chi tiết hơn BÊN
# TRONG profile đã active — đây chính là phần "đừng gộp van cơ học với sửa van"
# theo đúng góp ý Vấn đề 1 cũ.
#
# CHƯA CODE: CAD, HF, DM, HTN... (xem SDS mục 6 — chiến lược triển khai theo
# từng vòng, không làm hết 1 lần để kịp deadline). Thêm profile mới sau này:
# chỉ thêm 1 entry vào dict này + viết calculation riêng nếu cần, KHÔNG sửa
# hàm classify_profiles() bên dưới.
PROFILE_REGISTRY = {
    "valve_disease": {
        "ten_hien_thi": "Bệnh van tim",
        "keywords": [
            "van co hoc", "thay van", "sua van", "hep van", "ho van",
            "on-x", "on x", "st jude", "van sinh hoc", "khau van", "tao hinh van",
            "hep ho van", "van hai la", "van dong mach chu", "van ba la", "van dmc",
            "carbomedics", "sorin bicarbon", "ats", "medtronic open pivot",
        ],
        "subtypes": {
            # Thứ tự kiểm tra CÓ Ý NGHĨA — dict giữ đúng thứ tự khai báo,
            # phần tử khớp trước sẽ được trả về ngay, không kiểm tra tiếp.
            #
            # BUG THẬT ĐÃ SỬA (báo cáo từ chuyên gia y tế): "St Jude",
            # "CarboMedics", "ATS"... là TÊN HÃNG SẢN XUẤT CẢ van cơ học VÀ
            # van sinh học (vd "St Jude Epic" = van SINH HỌC, "St Jude
            # Regent"/"Master" = van CƠ HỌC — cùng 1 hãng, 2 dòng sản phẩm
            # khác hẳn nhau về bản chất chống đông). Thứ tự CŨ kiểm tra
            # "mechanical" TRƯỚC "bioprosthetic" khiến 1 hồ sơ ghi "Van
            # sinh học St Jude Epic" bị NHẦM thành van cơ học (vì "st jude"
            # khớp keyword mechanical trước khi kịp thấy chữ "sinh học"),
            # áp SAI ngưỡng INR (đưa ngưỡng cơ học 2.5-3.5/3.0-4.0 cho 1 ca
            # đáng lẽ chỉ cần 2.0-3.0 hoặc thậm chí không cần chống đông
            # suốt đời) — rủi ro lâm sàng thật, không chỉ là lỗi hiển thị.
            #
            # SỬA: kiểm tra "bioprosthetic" TRƯỚC "mechanical" — cụm từ
            # "van sinh học"/"bioprosthetic" là khẳng định TRỰC TIẾP, RÕ
            # RÀNG, đáng tin hơn nhiều so với suy luận GIÁN TIẾP từ tên
            # thương hiệu mơ hồ (dùng chung cho cả 2 loại van).
            "bioprosthetic": {"keywords": ["van sinh hoc", "bioprosthetic"]},
            "mechanical": {"keywords": ["van co hoc", "on-x", "on x", "st jude",
                                         "carbomedics", "sorin bicarbon", "ats",
                                         "medtronic open pivot"]},
            "repair": {"keywords": ["sua van", "khau van", "tao hinh van"]},
            "native_disease": {"keywords": ["hep van", "ho van"], "default": True},
        },
    },
    "atrial_fibrillation": {
        "ten_hien_thi": "Rung nhĩ",
        "keywords": [
            "rung nhi", "af ", "fibrillation", "cuong nhi", "rung cuong nhi",
        ],
        "subtypes": None,
    },
    "ckd": {
        "ten_hien_thi": "Bệnh thận mạn",
        "keywords": [
            "suy than", "benh than man", "ckd", "lc thận", "viem cau than man",
        ],
        # CKD còn có thể active từ KẾT QUẢ TÍNH TOÁN (eGFR < 90), không chỉ
        # keyword — xử lý riêng trong classify_profiles() bằng calculated_trigger.
        "calculated_trigger": "egfr_lt_90",
        "subtypes": {
            # Phân loại theo KDIGO — dùng calculated_trigger riêng, không phải
            # keyword, nên khai báo subtypes rỗng ở đây và xử lý trong
            # _classify_ckd_subtype() bên dưới.
            "_uses_calculated_subtype": True,
        },
    },
}


def _profile_active_by_keyword(text_chan_doan: str, profile_def: dict) -> bool:
    kws = profile_def.get("keywords") or []
    if not kws:
        return False
    return _text_has_any_positive(text_chan_doan, kws)


def _detect_subtype_by_keyword(text_chan_doan: str, subtypes_def: dict) -> Optional[str]:
    """Trả subtype đầu tiên khớp keyword, theo đúng thứ tự khai báo (dict giữ thứ tự
    trong Python 3.7+). Nếu không khớp gì, trả subtype có default=True (nếu có)."""
    default_subtype = None
    for sub_id, sub_def in subtypes_def.items():
        if sub_def.get("default"):
            default_subtype = sub_id
            continue
        kws = sub_def.get("keywords") or []
        if kws and _text_has_any_positive(text_chan_doan, kws):
            return sub_id
    return default_subtype


def _classify_ckd_subtype(egfr: Optional[int]) -> Optional[str]:
    """Phân giai đoạn KDIGO theo eGFR — TÁCH RIÊNG khỏi keyword vì đây là phân
    loại bằng SỐ, không phải bằng chữ. Ngưỡng theo KDIGO 2024/2025 (giai đoạn
    G1-G5), CHƯA xác nhận lại bởi Tấn/Ngân cho mục đích hiển thị subtype này
    — chỉ áp dụng cho việc gắn nhãn giai đoạn, KHÔNG ảnh hưởng tới các cảnh
    báo eGFR/renal_flags đã có (những cái đó giữ nguyên ngưỡng cũ)."""
    if egfr is None:
        return None
    if egfr >= 90:
        return "g1"
    if egfr >= 60:
        return "g2"
    if egfr >= 45:
        return "g3a"
    if egfr >= 30:
        return "g3b"
    if egfr >= 15:
        return "g4"
    return "g5"


def classify_profiles(report: dict, egfr: Optional[int] = None) -> list:
    """
    Layer 2 chính. Trả về list các profile ĐANG ACTIVE, mỗi item:
        {"profile_id": ..., "subtype": ..., "ten_hien_thi": ..., "confidence": ...}

    egfr: kết quả Layer 4 sơ bộ (tính trước, độc lập) — cần để quyết định CKD
    có active hay không, kể cả khi hồ sơ không hề ghi chữ "suy thận".

    KHÔNG return sớm — chạy hết toàn bộ PROFILE_REGISTRY, đúng yêu cầu "1 bệnh
    nhân có thể thuộc nhiều profile cùng lúc, không được phép chọn 1".
    """
    ident = identify_patient(report)
    text = ident["text_chan_doan"]
    active = []

    for profile_id, profile_def in PROFILE_REGISTRY.items():
        is_active = False
        confidence = None

        if _profile_active_by_keyword(text, profile_def):
            is_active = True
            confidence = "keyword_match"

        calc_trigger = profile_def.get("calculated_trigger")
        if calc_trigger == "egfr_lt_90" and egfr is not None and egfr < 90:
            is_active = True
            confidence = "calculated" if confidence is None else confidence + "+calculated"

        if not is_active:
            continue

        subtype = None
        subtypes_def = profile_def.get("subtypes")
        if subtypes_def and not subtypes_def.get("_uses_calculated_subtype"):
            subtype = _detect_subtype_by_keyword(text, subtypes_def)
        elif profile_id == "ckd":
            subtype = _classify_ckd_subtype(egfr)

        active.append({
            "profile_id": profile_id,
            "ten_hien_thi": profile_def["ten_hien_thi"],
            "subtype": subtype,
            "confidence": confidence,
        })

    return active


def has_profile(active_profiles: list, profile_id: str, subtype: Optional[str] = None) -> bool:
    """Helper cho Layer 3/4/5: kiểm tra 1 profile (+ subtype cụ thể nếu cần) có
    active hay không. Đây là hàm DUY NHẤT mà các layer sau nên dùng để hỏi
    "bệnh nhân có thuộc nhóm X không" — KHÔNG tự dò keyword lại ở nơi khác."""
    for p in active_profiles:
        if p["profile_id"] != profile_id:
            continue
        if subtype is None or p["subtype"] == subtype:
            return True
    return False
