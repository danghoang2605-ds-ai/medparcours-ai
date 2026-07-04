"""
indicators.py — Layer 3 của Clinical Decision Engine v2: Applicable Indicators

VẤN ĐỀ ĐANG SỬA (Vấn đề 1 cũ + góp ý anh Tấn mục "Bước 4"):
  Kiến trúc cũ: indicator → reference range trực tiếp. Khi không áp dụng,
  hiện "-" → bác sĩ đọc nhầm thành "thiếu dữ liệu" trong khi bản chất là
  "chỉ số này không áp dụng cho bệnh nhân này" (ví dụ chênh áp van ở bệnh
  nhân không có bệnh van tim).

  Kiến trúc mới: indicator → is_applicable(active_profiles) → True/False.
  Nếu False, indicator KHÔNG xuất hiện trong output Layer 5 — không hiện
  "-", không gây hiểu lầm.

Mỗi INDICATOR_REGISTRY entry khai báo: thuộc profile nào, cần subtype gì
(nếu có), và tên hàm tính toán tương ứng ở Layer 4 (chỉ để tham chiếu/đối
chiếu — Layer 5 vẫn tự gọi hàm tính toán, file này chỉ quyết định
applicable hay không).
"""
try:
    from .disease_classifier import has_profile
except ImportError:
    from disease_classifier import has_profile


INDICATOR_REGISTRY = {
    "inr_target_mechanical": {
        "ten_hien_thi": "INR mục tiêu (van cơ học)",
        "requires_profile": "valve_disease",
        "requires_subtype": "mechanical",
        "calculation_ref": "valve.inr_target_mechanical",
        # Ngưỡng 2.0-3.0 GIỮ NGUYÊN từ code cũ — chỉ đổi NƠI áp dụng (chỉ
        # mechanical, không còn áp cho bioprosthetic/repair/native_disease).
    },
    "valve_gradient": {
        "ten_hien_thi": "Chênh áp qua van",
        "requires_profile": "valve_disease",
        "requires_subtype": None,  # áp dụng cho MỌI subtype của valve_disease
        "calculation_ref": "valve.gradient_from_echo",
    },
    "cha2ds2_vasc": {
        "ten_hien_thi": "CHA2DS2-VASc",
        "requires_profile": "atrial_fibrillation",
        "requires_subtype": None,
        "calculation_ref": "af.compute_cha2ds2_vasc",
    },
    "has_bled": {
        "ten_hien_thi": "HAS-BLED",
        "requires_profile": "atrial_fibrillation",
        "requires_subtype": None,
        "calculation_ref": "af.compute_has_bled",
    },
    "ttr": {
        "ten_hien_thi": "TTR (Time in Therapeutic Range)",
        # TTR chỉ có nghĩa khi bệnh nhân dùng kháng vitamin K theo dõi bằng
        # INR — đúng là van cơ học, NHƯNG cũng có thể là AF không do van mà
        # vẫn dùng kháng vitamin K. Khai báo CẢ HAI profile đều mở khóa được
        # TTR (any_of, không phải all_of) — sửa đúng góp ý Vấn đề 1 mục 1
        # ("DOAC không theo dõi bằng INR" sẽ KHÔNG kích hoạt indicator này
        # vì không thuộc profile nào theo dõi bằng INR).
        "requires_profile_any_of": ["valve_disease", "atrial_fibrillation"],
        "requires_subtype": None,
        "calculation_ref": "anticoagulation.compute_ttr",
    },
    "egfr": {
        "ten_hien_thi": "eGFR (CKD-EPI 2021)",
        # eGFR tính được cho MỌI bệnh nhân có đủ creatinin+tuổi+giới, không
        # cần profile CKD active trước — ngược lại, chính eGFR là một phần
        # quyết định CKD có active hay không (xem disease_classifier.py).
        # Vì vậy eGFR không gắn "requires_profile" — luôn applicable nếu đủ
        # dữ liệu đầu vào, bất kể profile.
        "requires_profile": None,
        "requires_subtype": None,
        "calculation_ref": "ckd.compute_egfr",
    },
}


def is_applicable(indicator_id: str, active_profiles: list) -> bool:
    """Hàm DUY NHẤT quyết định 1 indicator có nên xuất hiện trong output hay
    không. Layer 5 gọi hàm này TRƯỚC khi tính/trả kết quả — nếu False, không
    tính, không trả, không hiện '-' ở frontend."""
    spec = INDICATOR_REGISTRY.get(indicator_id)
    if not spec:
        return False

    req_profile = spec.get("requires_profile")
    req_any_of = spec.get("requires_profile_any_of")
    req_subtype = spec.get("requires_subtype")

    if req_profile is None and req_any_of is None:
        return True  # không gắn điều kiện profile nào -> luôn applicable

    if req_any_of:
        return any(has_profile(active_profiles, pid, req_subtype) for pid in req_any_of)

    return has_profile(active_profiles, req_profile, req_subtype)
