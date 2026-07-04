"""
universal_indicators.py — Chỉ số CHUNG cho mọi bệnh nhân tim mạch, không phân
biệt nhóm ICD (Vấn đề 2, mục 9 — bảng "Chung" do anh Tấn cung cấp).

KHÁC với icd_groups.py (chỉ số ĐẶC TRƯNG riêng từng nhóm bệnh): file này tính
toán các chỉ số áp dụng cho TẤT CẢ bệnh nhân, bất kể họ thuộc nhóm ICD nào.
Layer 4 (engine.py) luôn gọi các hàm ở đây, không cần kiểm tra active_groups
trước — đây chính là "bộ quy tắc chung" mà anh Tấn yêu cầu tách riêng khỏi
"bộ quy tắc CHỈ áp dụng cho 1 nhóm bệnh cụ thể".

5 NHÓM CHỈ SỐ CHUNG (đúng bảng anh Tấn):
  1. Sinh hiệu – huyết động (HA, mạch, SpO2, nhịp thở, nhiệt độ, BMI...)
  2. Yếu tố nguy cơ tim mạch (tuổi, giới, hút thuốc, ĐTĐ, THA, lipid, CKD...)
  3. ECG (nhịp, tần số, PR/QRS/QTc, ST-T, block, ngoại tâm thu)
  4. Xét nghiệm nền (công thức máu, eGFR, điện giải, glucose/HbA1c, lipid...)
  5. Nguy cơ tim mạch toàn bộ (SCORE2/SCORE2-OP)

NGUYÊN TẮC MINH BẠCH: SCORE2 cần đủ tuổi+giới+hút thuốc+HA+cholesterol toàn
phần/HDL — THIẾU 1 trong các trường này thì KHÔNG tính, trả lý do cụ thể,
không suy diễn giá trị thiếu.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from clinical_rules import _strip_accents, _text_has_any_positive


# ─── 1. SINH HIỆU – HUYẾT ĐỘNG ────────────────────────────────────────────────
def assess_vital_signs(dau_hieu_sinh_ton: dict) -> dict:
    """Đánh giá sinh hiệu cơ bản — luôn áp dụng cho mọi bệnh nhân.
    HA và mạch là TỐI THIỂU (theo anh Tấn) — nếu thiếu cả 2, trả rõ thiếu gì."""
    d = dau_hieu_sinh_ton or {}
    ha_tt, ha_ttr = d.get("ha_tt"), d.get("ha_ttr")
    mach = d.get("mach")

    missing = []
    if ha_tt is None or ha_ttr is None:
        missing.append("Huyết áp (tâm thu/tâm trương)")
    if mach is None:
        missing.append("Mạch")

    result = {
        "ha_tt": ha_tt, "ha_ttr": ha_ttr, "mach": mach,
        "spo2": d.get("spo2"), "nhip_tho": d.get("nhip_tho"),
        "nhiet_do": d.get("nhiet_do"),
        "thieu_du_lieu": missing,
    }

    # Phân loại HA theo ESC 2024 (3 mức: non-elevated / elevated / hypertension)
    if ha_tt is not None and ha_ttr is not None:
        if ha_tt >= 140 or ha_ttr >= 90:
            result["phan_loai_ha"] = "hypertension"
            result["phan_loai_ha_nhan"] = "Tăng huyết áp (≥140/90 mmHg)"
        elif ha_tt >= 120 or ha_ttr >= 70:
            result["phan_loai_ha"] = "elevated"
            result["phan_loai_ha_nhan"] = "Huyết áp tăng nhẹ (120-139/70-89 mmHg)"
        else:
            result["phan_loai_ha"] = "non_elevated"
            result["phan_loai_ha_nhan"] = "Huyết áp không tăng (<120/70 mmHg)"
        result["nguon_phan_loai_ha"] = "ESC 2024 Hypertension Guidelines"

    # Gợi ý bắt mạch để phát hiện rung nhĩ (ESC 2024 nhấn mạnh) — chỉ là GỢI
    # NHẮC, không phải chẩn đoán, vì cần khám thật để xác nhận đều/không đều.
    if mach is not None:
        result["nhac_kham"] = (
            "ESC 2024: nên bắt mạch kèm đo HA để phát hiện sớm rối loạn nhịp "
            "(ví dụ rung nhĩ) — cần khám thực thể trực tiếp để xác nhận, "
            "không suy ra từ số liệu mạch đơn lẻ."
        )

    return result


# ─── 2. YẾU TỐ NGUY CƠ TIM MẠCH (Risk factor) ────────────────────────────────
RISK_FACTOR_KEYWORDS = {
    "hut_thuoc": ["hut thuoc", "thuoc la", "nghien thuoc"],
    "dtd": ["dai thao duong", "dtd type", "dtd ii", "dtd i", "tieu duong"],
    "tha": ["tang huyet ap", "cao huyet ap"],
    "roi_loan_lipid": ["roi loan lipid", "mau mo", "tang cholesterol", "rối loạn mỡ máu"],
    "ckd": ["suy than", "benh than man", "ckd"],
    "beo_phi": ["beo phi", "thua can"],
    "tien_su_gia_dinh": ["tien su gia dinh", "gia dinh co benh tim", "di truyen"],
    "tien_su_ascvd": ["nhoi mau co tim", "dot quy", "benh mach vanh", "ascvd"],
}


def detect_risk_factors(text_chan_doan: str, tuoi=None, gioi_tinh=None) -> dict:
    """Quét risk factor từ text (đã bỏ dấu) — nền cho mọi nhóm bệnh, nhưng
    CÁCH TÍNH NGUY CƠ khác nhau tùy bệnh (đúng ghi chú của anh Tấn), nên hàm
    này chỉ LIỆT KÊ risk factor, KHÔNG tự suy ra mức nguy cơ tổng quát."""
    found = {}
    for key, kws in RISK_FACTOR_KEYWORDS.items():
        found[key] = _text_has_any_positive(text_chan_doan, kws)
    return {
        "yeu_to_nguy_co": found,
        "so_yeu_to_nguy_co": sum(1 for v in found.values() if v),
        "tuoi": tuoi,
        "gioi_tinh": gioi_tinh,
    }


# ─── 3. ECG — chỉ liệt kê field cần có, CHƯA tự tính (cần dữ liệu ECG số hóa) ─
ECG_UNIVERSAL_FIELDS = [
    "nhip", "tan_so", "pr_interval_ms", "qrs_duration_ms", "qtc_ms",
    "st_t_changes", "block", "ngoai_tam_thu",
]


def extract_ecg_universal(ecg_data: dict) -> dict:
    """Trích các field ECG chung nếu hồ sơ có (KHÔNG bắt buộc — đa số hồ sơ
    PDF text hiện tại không có dữ liệu ECG số hóa đầy đủ, chỉ ghi mô tả text
    tự do "nhịp xoang đều" trong xet_nghiem_key hoặc dien_bien_lam_sang).
    Đây là điểm chờ tích hợp sâu hơn với module ecg_engine.py (Mức 3 — phân
    loại nhịp — CHƯA code, đang chờ Tấn/Ngân xác nhận ngưỡng CV%/PP range)."""
    if not ecg_data:
        return {"co_du_lieu": False,
                "ly_do": "Hồ sơ chưa có trường ECG số hóa riêng — chỉ có mô tả "
                         "text tự do (nếu có) trong diễn biến lâm sàng."}
    return {
        "co_du_lieu": True,
        **{f: ecg_data.get(f) for f in ECG_UNIVERSAL_FIELDS},
    }


# ─── 4. XÉT NGHIỆM NỀN — đối chiếu xem hồ sơ có đủ các xét nghiệm cơ bản ──────
BASELINE_LAB_KEYS = {
    "cong_thuc_mau": ["HGB", "WBC", "PLT", "Hb", "Hct"],
    "creatinin_egfr": ["Creatinin", "eGFR"],
    "dien_giai": ["Na+", "K+", "Mg", "Na", "K"],
    "glucose_hba1c": ["Glucose", "HbA1c"],
    "lipid": ["LDL", "HDL", "Cholesterol", "Triglyceride"],
    "men_gan": ["AST", "ALT", "GGT"],
    "dong_mau": ["INR", "PT", "aPTT"],
}


def check_baseline_labs_completeness(xet_nghiem_key: list) -> dict:
    """Đối chiếu hồ sơ có những nhóm xét nghiệm nền nào, nhóm nào còn thiếu —
    KHÔNG tự suy diễn giá trị, chỉ báo cáo tình trạng đầy đủ dữ liệu để bác
    sĩ biết cần bổ sung xét nghiệm gì."""
    present_keys = {(l.get("key") or "").strip().upper() for l in (xet_nghiem_key or [])}
    result = {}
    for group, keys in BASELINE_LAB_KEYS.items():
        matched = [k for k in keys if k.upper() in present_keys]
        result[group] = {"co_du_lieu": len(matched) > 0, "chi_so_co": matched}
    missing_groups = [g for g, v in result.items() if not v["co_du_lieu"]]
    return {
        "chi_tiet": result,
        "nhom_con_thieu": missing_groups,
    }


# ─── 5. SCORE2 / SCORE2-OP — nguy cơ tim mạch 10 năm ──────────────────────────
def compute_score2_applicability(tuoi, gioi_tinh, hut_thuoc, ha_tt, cholesterol_total, hdl) -> dict:
    """
    SCORE2 (40-69 tuổi) / SCORE2-OP (≥70 tuổi) — CHỈ áp dụng cho người "có vẻ
    khỏe mạnh", CHƯA có bệnh tim mạch xơ vữa rõ (theo đúng định nghĩa anh Tấn
    đưa ra). KHÔNG tính nếu bệnh nhân đã có ASCVD rõ ràng (vì SCORE2 là dự
    phòng tiên phát, không dùng cho người đã có bệnh).

    Hàm này CHỈ kiểm tra ĐỦ DỮ LIỆU để tính hay không — KHÔNG tự tính công
    thức SCORE2 thật (công thức SCORE2 dùng hệ số hồi quy theo vùng địa lý
    châu Âu, CẦN xác nhận từ Tấn/Ngân bộ hệ số phù hợp áp dụng cho dân số VN
    trước khi code phần tính điểm thật — tránh tự suy diễn hệ số y khoa).
    """
    missing = []
    if tuoi is None:
        missing.append("Tuổi")
    if gioi_tinh is None:
        missing.append("Giới tính")
    if hut_thuoc is None:
        missing.append("Tình trạng hút thuốc")
    if ha_tt is None:
        missing.append("Huyết áp tâm thu")
    if cholesterol_total is None:
        missing.append("Cholesterol toàn phần")
    if hdl is None:
        missing.append("HDL-Cholesterol")

    do_tuoi_phu_hop = None
    if tuoi is not None:
        if 40 <= tuoi <= 69:
            do_tuoi_phu_hop = "SCORE2"
        elif tuoi >= 70:
            do_tuoi_phu_hop = "SCORE2-OP"
        else:
            do_tuoi_phu_hop = None  # <40 tuổi: SCORE2 không áp dụng

    return {
        "thang_diem_phu_hop": do_tuoi_phu_hop,
        "du_du_lieu_de_tinh": len(missing) == 0 and do_tuoi_phu_hop is not None,
        "thieu_du_lieu": missing,
        "luu_y": "Hệ thống CHƯA tự tính điểm SCORE2 thật — cần Tấn/Ngân xác nhận "
                 "bộ hệ số hồi quy phù hợp trước khi code phần tính điểm. Hiện tại "
                 "chỉ kiểm tra đủ dữ liệu đầu vào.",
        "nguon": "ESC SCORE2/SCORE2-OP — dự phòng tiên phát nguy cơ 10 năm, "
                 "CHỈ áp dụng người chưa có bệnh tim mạch xơ vữa rõ.",
    }
