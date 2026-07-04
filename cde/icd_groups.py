"""
icd_groups.py — Khung phân loại 10 nhóm bệnh hệ tuần hoàn theo ICD-10
(Chương IX, Bộ Y tế Việt Nam: https://icd.kcb.vn/icd-10-tt06/icd10-tt06)

ĐÂY LÀ TRUNG TÂM CỦA VIỆC SỬA VẤN ĐỀ 2 — thay vì viết luật riêng cho "ca van
tim" như cách cũ, mỗi nhóm bệnh dưới đây mang đúng bộ thang điểm/chỉ số đặc
trưng riêng của nó (theo đúng bảng anh Tấn cung cấp), và disease_classifier.py
chỉ cần hỏi "bệnh nhân thuộc nhóm ICD nào" — không hard-code theo từng ca.

10 NHÓM (đúng thứ tự Chương IX):
  I00     Thấp tim cấp tính (Jones Criteria)
  I05     Bệnh tim mạn tính do thấp (Wilkins score, WHF echo criteria)
  I10     Bệnh lý tăng huyết áp (phân loại HA theo ESC 2024, HMOD)
  I20     Bệnh tim thiếu máu cục bộ (GRACE/TIMI/HEART, hs-Troponin)
  I26     Bệnh tim do phổi và tuần hoàn phổi (Wells/Geneva/PESI, REVEAL)
  I30     Thể khác của bệnh tim (suy tim/NYHA, rung nhĩ/CHA2DS2-VASc,
          viêm nội tâm mạc/Duke, viêm màng ngoài tim, van tim không do thấp)
  I60     Bệnh mạch máu não (NIHSS, mRS, GCS, ASPECTS, ABCD2, ICH score)
  I70     Bệnh động mạch/tiểu động mạch/mao mạch (ABI/TBI, Fontaine/Rutherford)
  I80     Bệnh tĩnh mạch/mạch bạch huyết (CEAP, VCSS, Villalta, ISL)
  I95     Rối loạn khác/không xác định hệ tuần hoàn (Shock Index, MAP)

NGUYÊN TẮC GIỮ NGUYÊN từ disease_classifier.py cũ:
  - 1 bệnh nhân có thể thuộc NHIỀU nhóm cùng lúc, không return sớm.
  - Mỗi nhóm tự quản kiến thức của mình, không đụng nhóm khác.
  - Thiếu dữ liệu để tính 1 thang điểm -> trả None + lý do, KHÔNG suy diễn.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from clinical_rules import _strip_accents, _text_has_any_positive


ICD_GROUPS = {
    "I00_thap_tim_cap": {
        "ten_hien_thi": "Thấp tim cấp tính",
        "icd_range": "I00-I02",
        "keywords": [
            "thap tim", "sot thap", "viem hop lien cau", "mua giat",
            "sydenham chorea", "thap khop",
        ],
        "thang_diem_dac_trung": ["jones_criteria"],
        "nguon": "Jones Criteria for Rheumatic Fever",
    },
    "I05_tim_man_do_thap": {
        "ten_hien_thi": "Bệnh tim mạn tính do thấp",
        "icd_range": "I05-I09",
        "keywords": [
            "tim man tinh do thap", "hep van hai la do thap", "benh tim do thap",
        ],
        "thang_diem_dac_trung": ["wilkins_score", "whf_echo_criteria"],
        "nguon": "Wilkins score (Medscape); WHF echocardiographic criteria for RHD",
        "luu_y": "Nếu hồ sơ chỉ ghi 'hẹp van hai lá' KHÔNG kèm tiền sử thấp tim/sốt "
                 "thấp, ưu tiên phân vào I30 (van tim không do thấp) — KHÔNG tự suy "
                 "diễn nguyên nhân do thấp khi không có chứng cứ rõ.",
    },
    "I10_tang_huyet_ap": {
        "ten_hien_thi": "Bệnh lý tăng huyết áp",
        "icd_range": "I10-I16",
        "keywords": [
            "tang huyet ap", "cao huyet ap", "benh ly tang huyet ap",
            # KHÔNG dùng viết tắt "tha" đơn lẻ — đã phát hiện qua test: khớp
            # nhầm vào substring của rất nhiều từ khác ("thay van" chứa "tha",
            # "thận" chứa "tha"...). Bài học: keyword viết tắt ngắn (<4 ký tự)
            # luôn rủi ro giả dương cao trong tiếng Việt không dấu.
        ],
        "thang_diem_dac_trung": ["esc_bp_classification", "hmod_assessment"],
        "nguon": "ESC 2024 Hypertension Guidelines (phân loại HA + đánh giá HMOD)",
    },
    "I20_tim_thieu_mau_cuc_bo": {
        "ten_hien_thi": "Bệnh tim thiếu máu cục bộ (mạch vành)",
        "icd_range": "I20-I25",
        "keywords": [
            "mach vanh", "nhoi mau co tim", "dat stent", "bac cau chu vanh",
            "dau thang nguc", "thieu mau co tim", "cad", "pci", "cabg",
            "hoi chung vanh cap", "acs", "dau nguc trai",
            # Bỏ "mi " (viết tắt MI = myocardial infarction) — rủi ro giả dương
            # với âm tiết tiếng Việt thông thường, đã có "nhoi mau co tim" đầy
            # đủ nên không cần viết tắt này.
        ],
        "thang_diem_dac_trung": ["grace_score", "timi_score", "heart_score",
                                   "ccs_class", "duke_treadmill", "syntax_score"],
        "nguon": "ESC ACS 2023 Guidelines",
    },
    "I26_tim_do_phoi": {
        "ten_hien_thi": "Bệnh tim do phổi và tuần hoàn phổi",
        "icd_range": "I26-I28",
        "keywords": [
            "thuyen tap phoi", "tang ap phoi", "tam phe", "thuyen tac dong mach phoi",
        ],
        "thang_diem_dac_trung": ["wells_score_pe", "geneva_score", "perc_rule",
                                   "pesi_score", "who_functional_class_ph"],
        "nguon": "ESC Pulmonary Embolism Guidelines",
    },
    "I30_the_khac_benh_tim": {
        # NHÓM RẤT RỘNG theo đúng bảng Tấn — chứa nhiều bệnh cảnh con, mỗi
        # bệnh cảnh con có thang điểm riêng (đây là "subtypes" thật sự).
        "ten_hien_thi": "Thể khác của bệnh tim (suy tim/rung nhĩ/van tim/viêm tim)",
        "icd_range": "I30-I52",
        "keywords": [
            "suy tim", "rung nhi", "viem mang ngoai tim", "viem noi tam mac",
            "benh co tim", "van co hoc", "thay van", "sua van", "hep van", "ho van",
            "cuong nhi", "nyha", "hfref", "hfpef", "hfmref",
        ],
        "subtypes": {
            "heart_failure": {
                "keywords": ["suy tim", "nyha", "hfref", "hfpef", "hfmref"],
                "thang_diem_dac_trung": ["nyha_class", "lvef_classification",
                                          "nt_probnp", "kccq"],
            },
            "atrial_fibrillation": {
                "keywords": ["rung nhi", "cuong nhi", "fibrillation"],
                "thang_diem_dac_trung": ["cha2ds2_vasc", "has_bled", "ehra_class"],
            },
            "infective_endocarditis": {
                "keywords": ["viem noi tam mac", "endocarditis"],
                "thang_diem_dac_trung": ["duke_criteria"],
            },
            "pericarditis": {
                "keywords": ["viem mang ngoai tim", "pericarditis", "tran dich mang ngoai tim"],
                "thang_diem_dac_trung": ["pericarditis_4_criteria"],
            },
            "valve_disease_non_rheumatic": {
                "keywords": ["van co hoc", "thay van", "sua van", "hep van", "ho van"],
                "thang_diem_dac_trung": ["valve_gradient", "eroa", "sts_score", "euroscore_ii"],
                "default": True,
            },
        },
        "nguon": "ACC/AHA Heart Failure Guidelines; ESC AF 2024; Modified Duke Criteria; "
                 "ESC Pericardial Diseases Guidelines",
    },
    "I60_mach_mau_nao": {
        "ten_hien_thi": "Bệnh mạch máu não (đột quỵ)",
        "icd_range": "I60-I69",
        "keywords": [
            "xuat huyet duoi nhen", "xuat huyet nao", "nhoi mau nao", "tia ",
            "dot quy", "thieu mau nao thoang qua", "di chung dot quy",
        ],
        "thang_diem_dac_trung": ["nihss", "mrs", "gcs", "aspects", "abcd2",
                                   "ich_score", "hunt_hess"],
        "nguon": "AHA/ASA Stroke Guidelines",
    },
    "I70_dong_mach": {
        "ten_hien_thi": "Bệnh động mạch, tiểu động mạch, mao mạch",
        "icd_range": "I70-I79",
        "keywords": [
            "xo vua dong mach", "pad", "phinh dong mach", "benh mach chi",
            "thieu mau chi", "benh dong mach chi", "dong mach chi duoi",
        ],
        "thang_diem_dac_trung": ["abi", "tbi", "fontaine", "rutherford", "wifi", "glass"],
        "nguon": "PAD Guidelines 2024 (AHA)",
    },
    "I80_tinh_mach": {
        "ten_hien_thi": "Bệnh tĩnh mạch, mạch bạch huyết, hạch bạch huyết",
        "icd_range": "I80-I89",
        "keywords": [
            "dvt", "gian tinh mach", "suy tinh mach man", "hoi chung hau huyet khoi",
            "phu bach mach", "huyet khoi tinh mach sau",
        ],
        "thang_diem_dac_trung": ["wells_dvt", "ceap", "vcss", "villalta", "isl_staging"],
        "nguon": "NCBI Venous Disease Classification",
    },
    "I95_roi_loan_khac": {
        "ten_hien_thi": "Rối loạn khác/không xác định của hệ tuần hoàn",
        "icd_range": "I95-I99",
        "keywords": [
            "ha huyet ap", "soc", "ngat", "ngung tuan hoan", "tut huyet ap",
        ],
        "thang_diem_dac_trung": ["shock_index", "map", "canadian_syncope_risk", "cpc"],
        "nguon": "Dovepress (Shock Index); Canadian Syncope Risk Score",
        "luu_y": "Đây là nhóm 'mặc định cuối' khi rối loạn huyết động không khớp "
                 "nhóm nào khác rõ ràng (vd hạ HA tư thế đơn độc, ngất chưa rõ nguyên "
                 "nhân) — KHÔNG dùng để gán bừa cho mọi triệu chứng mơ hồ.",
    },
}


def _detect_all_subtypes_by_keyword(text: str, subtypes_def: dict) -> list:
    """
    KHÁC với _detect_subtype_by_keyword (chỉ trả 1 kết quả đầu tiên khớp):
    hàm này trả TẤT CẢ subtype khớp keyword — vì 1 bệnh nhân trong cùng 1
    nhóm ICD rộng (như I30) có thể thuộc NHIỀU bệnh cảnh con cùng lúc (ví dụ
    vừa suy tim vừa rung nhĩ vừa có van cơ học). Đây sửa đúng lỗi thiết kế
    ban đầu: bản cũ chỉ trả 1 subtype đầu tiên khớp, bỏ sót các subtype khác
    — vi phạm chính nguyên tắc "không chọn 1" của kiến trúc này.

    default subtype CHỈ thêm vào nếu KHÔNG có subtype cụ thể nào khớp.
    QUAN TRỌNG: 1 subtype CÓ THỂ vừa có default=True VỪA có keywords riêng
    (ví dụ valve_disease_non_rheumatic — "mặc định" cho I30 nhưng vẫn có
    keyword thật như "van co hoc"). PHẢI kiểm tra keyword TRƯỚC, không được
    bỏ qua hẳn khi thấy default=True — bug đã phát hiện qua test: subtype
    này từng KHÔNG BAO GIỜ được thêm vào dù khớp keyword thật, vì code cũ
    "continue" ngay khi thấy default=True trước khi kiểm tra keywords.
    """
    matched = []
    default_subtype = None
    for sub_id, sub_def in subtypes_def.items():
        if sub_def.get("default"):
            default_subtype = sub_id
        kws = sub_def.get("keywords") or []
        if kws and _text_has_any_positive(text, kws):
            matched.append(sub_id)
    if not matched and default_subtype:
        matched.append(default_subtype)
    return matched


def classify_icd_groups(text_chan_doan: str) -> list:
    """
    Trả về list các nhóm ICD ĐANG ACTIVE theo keyword trong text (đã gộp chẩn
    đoán + tiền sử + phẫu thuật, đã bỏ dấu — dùng _gather_text() có sẵn).

    KHÔNG return sớm — 1 bệnh nhân có thể thuộc nhiều nhóm ICD cùng lúc (đúng
    yêu cầu cốt lõi của anh Tấn, ví dụ vừa I20-mạch vành vừa I30-van tim).

    Với nhóm có subtypes (hiện chỉ I30), trả MỘT ENTRY CHO MỖI SUBTYPE khớp
    — không gộp chung 1 entry với 1 subtype duy nhất (xem
    _detect_all_subtypes_by_keyword).
    """
    active = []
    for group_id, group_def in ICD_GROUPS.items():
        kws = group_def.get("keywords") or []
        if not kws or not _text_has_any_positive(text_chan_doan, kws):
            continue

        subtypes_def = group_def.get("subtypes")
        if subtypes_def:
            matched_subtypes = _detect_all_subtypes_by_keyword(text_chan_doan, subtypes_def)
            if not matched_subtypes:
                matched_subtypes = [None]
            for subtype in matched_subtypes:
                active.append({
                    "icd_group": group_id,
                    "ten_hien_thi": group_def["ten_hien_thi"],
                    "icd_range": group_def["icd_range"],
                    "subtype": subtype,
                    "thang_diem_dac_trung": (
                        subtypes_def[subtype]["thang_diem_dac_trung"]
                        if subtype and subtypes_def.get(subtype)
                        else group_def.get("thang_diem_dac_trung", [])
                    ),
                })
        else:
            active.append({
                "icd_group": group_id,
                "ten_hien_thi": group_def["ten_hien_thi"],
                "icd_range": group_def["icd_range"],
                "subtype": None,
                "thang_diem_dac_trung": group_def.get("thang_diem_dac_trung", []),
            })
    return active


def has_icd_group(active_groups: list, group_id: str, subtype=None) -> bool:
    """Helper tương tự has_profile() — kiểm tra 1 nhóm ICD (+ subtype) active."""
    for g in active_groups:
        if g["icd_group"] != group_id:
            continue
        if subtype is None or g["subtype"] == subtype:
            return True
    return False
