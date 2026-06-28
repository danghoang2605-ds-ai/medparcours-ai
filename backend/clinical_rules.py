"""
clinical_rules.py — Rule Engine lâm sàng (Bước 2 trong pipeline Hybrid)

KIẾN TRÚC:
  Bước 1 (LLM): Claude đọc PDF -> JSON thuần (labs, vitals, drugs). KHÔNG đánh giá.
  Bước 2 (FILE NÀY): code if/else cứng, tra dictionary. KHÔNG dùng AI. Chính xác 100%.
  Bước 3 (LLM): Claude diễn đạt lại kết quả thành câu tóm tắt diễn tiến.

NGUYÊN TẮC:
  - Mọi luật ở đây do bác sĩ (Ngân, Tấn) soạn và chốt. AI không bao giờ tự suy luận.
  - Mỗi cảnh báo BẮT BUỘC kèm nguồn guideline.
  - Đây là MVP Hackathon: dictionary cứng, dễ đọc, dễ bác sĩ kiểm tra và bổ sung.
"""
from typing import Optional
import unicodedata
import re
import datetime as _dt


def _strip_accents(s: str) -> str:
    """Bỏ dấu tiếng Việt + viết thường, để dò từ khóa bất kể có dấu hay không.
    Dùng chung logic với main.py (STRONG_KEYWORDS) để 2 nơi nhất quán.
    LƯU Ý: chữ Đ/đ không decompose qua NFD (là ký tự độc lập trong Unicode,
    không phải D + dấu), nên phải replace tay trước khi normalize — nếu không,
    keyword như "ĐTĐ" sẽ không bao giờ khớp được với "dtd"."""
    if not s:
        return ""
    s = s.replace("Đ", "D").replace("đ", "d")
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    ).lower()


# ─── BẢN ĐỒ BIỆT DƯỢC VIỆT -> HOẠT CHẤT GỐC ───────────────────────────────────
BRAND_TO_GENERIC = {
    "vincerol": "acenocoumarol", "sintrom": "acenocoumarol", "coumadin": "warfarin",
    "medoxasol": "levofloxacin", "tavanic": "levofloxacin", "ciprobay": "ciprofloxacin",
    "forxiga": "dapagliflozin", "jardiance": "empagliflozin",
    "agifuros": "furosemid", "lasix": "furosemid", "takizd": "furosemid",
    "buflan": "cefoperazone", "pantoloc": "pantoprazole", "nexium": "esomeprazole",
    "betaloc": "metoprolol", "concor": "bisoprolol", "lipitor": "atorvastatin",
    "glucophage": "metformin", "aldactone": "spironolactone", "cordarone": "amiodarone",
    "plavix": "clopidogrel", "brilinta": "ticagrelor", "xarelto": "rivaroxaban",
    "eliquis": "apixaban", "pradaxa": "dabigatran", "crestor": "rosuvastatin",
    "diamicron": "gliclazide", "amaryl": "glimepiride", "amlor": "amlodipine",
    "losartas": "losartan", "cozaar": "losartan", "diovan": "valsartan",
    "klacid": "clarithromycin", "zithromax": "azithromycin", "rocephin": "ceftriaxone",
    "lanoxin": "digoxin",
}

# Hoạt chất -> nhóm dược lý
GENERIC_GROUPS = {
    "acenocoumarol": ["khang_vitamin_k"], "warfarin": ["khang_vitamin_k"],
    "levofloxacin": ["fluoroquinolon"], "ciprofloxacin": ["fluoroquinolon"],
    "furosemid": ["loi_tieu_quai"], "dapagliflozin": ["sglt2i"], "empagliflozin": ["sglt2i"],
    "pantoprazole": ["ppi"], "esomeprazole": ["ppi"], "omeprazole": ["ppi"],
    "cefoperazone": ["cephalosporin"], "ceftriaxone": ["cephalosporin"], "cefuroxime": ["cephalosporin"],
    "metformin": ["biguanid"], "spironolactone": ["loi_tieu_giu_kali"],
    "metoprolol": ["chen_beta"], "bisoprolol": ["chen_beta"], "carvedilol": ["chen_beta"],
    "atorvastatin": ["statin"], "simvastatin": ["statin"], "rosuvastatin": ["statin"],
    "amiodarone": ["chong_loan_nhip"], "clarithromycin": ["macrolid"],
    "erythromycin": ["macrolid"], "azithromycin": ["macrolid"],
    "ibuprofen": ["nsaid"], "diclofenac": ["nsaid"], "meloxicam": ["nsaid"], "celecoxib": ["nsaid"],
    "enalapril": ["acei"], "lisinopril": ["acei"], "captopril": ["acei"],
    "losartan": ["arb"], "valsartan": ["arb"], "telmisartan": ["arb"],
    "aspirin": ["khang_ket_tap_tieu_cau"], "clopidogrel": ["khang_ket_tap_tieu_cau"],
    "ticagrelor": ["khang_ket_tap_tieu_cau"],
    "rivaroxaban": ["khang_dong_truc_tiep"], "apixaban": ["khang_dong_truc_tiep"],
    "dabigatran": ["khang_dong_truc_tiep"],
    "insulin": ["insulin"], "gliclazide": ["sulfonylurea"], "glimepiride": ["sulfonylurea"],
    "amlodipine": ["chen_kenh_calci"], "nifedipine": ["chen_kenh_calci"],
    "digoxin": ["digoxin"],
}

# ─── BẢNG TƯƠNG TÁC THUỐC (do bác sĩ soạn) ─────────────────────────────────────
# Mỗi luật: 2 nhóm dược lý + mức độ + hậu quả + đề xuất + nguồn
INTERACTION_RULES = [
    {"a": "khang_vitamin_k", "b": "fluoroquinolon", "muc": "warning",
     "hau_qua": "Fluoroquinolon làm tăng tác dụng chống đông của thuốc kháng vitamin K, có thể đẩy INR lên cao và tăng nguy cơ chảy máu.",
     "de_xuat": "Theo dõi INR sát hơn trong và sau đợt kháng sinh, cân nhắc chỉnh liều chống đông.",
     "nguon": "Tương tác coumarin-fluoroquinolon (y văn lâm sàng)"},
    {"a": "khang_vitamin_k", "b": "nsaid", "muc": "critical",
     "hau_qua": "Tăng mạnh nguy cơ loét và xuất huyết tiêu hóa.",
     "de_xuat": "Tránh phối hợp, dùng paracetamol thay thế.",
     "nguon": "Tương tác kháng đông-NSAID"},
    {"a": "khang_vitamin_k", "b": "macrolid", "muc": "warning",
     "hau_qua": "Ức chế chuyển hóa thuốc chống đông, tăng INR.",
     "de_xuat": "Theo dõi INR, cân nhắc kháng sinh nhóm khác.",
     "nguon": "Tương tác coumarin-macrolid"},
    {"a": "khang_vitamin_k", "b": "chong_loan_nhip", "muc": "critical",
     "hau_qua": "Amiodarone tăng mạnh tác dụng chống đông, nguy cơ xuất huyết.",
     "de_xuat": "Cần giảm liều thuốc chống đông ngay từ đầu, theo dõi INR.",
     "nguon": "Tương tác warfarin-amiodarone"},
    {"a": "loi_tieu_giu_kali", "b": "acei", "muc": "warning",
     "hau_qua": "Tăng kali máu, nguy cơ rối loạn nhịp tim.",
     "de_xuat": "Theo dõi kali máu và chức năng thận.",
     "nguon": "Tương tác ACEI-lợi tiểu giữ kali"},
    {"a": "loi_tieu_giu_kali", "b": "arb", "muc": "warning",
     "hau_qua": "Tăng kali máu, nguy cơ rối loạn nhịp tim (cơ chế tương tự phối hợp với ACEI).",
     "de_xuat": "Theo dõi kali máu và chức năng thận định kỳ.",
     "nguon": "Tương tác ARB-lợi tiểu giữ kali"},
    {"a": "acei", "b": "arb", "muc": "warning",
     "hau_qua": "Phối hợp 2 thuốc ức chế hệ Renin-Angiotensin cùng lúc không tăng hiệu quả rõ rệt nhưng tăng nguy cơ tăng kali máu và suy thận.",
     "de_xuat": "Thường KHÔNG phối hợp ACEI + ARB cùng lúc; xem lại chỉ định.",
     "nguon": "ESC/ESH Tăng huyết áp"},
    {"a": "statin", "b": "macrolid", "muc": "warning",
     "hau_qua": "Tăng nồng độ statin, nguy cơ đau cơ và tiêu cơ vân.",
     "de_xuat": "Tạm ngừng statin trong đợt kháng sinh.",
     "nguon": "Tương tác statin-macrolid"},
    {"a": "chen_beta", "b": "chong_loan_nhip", "muc": "warning",
     "hau_qua": "Cộng gộp ức chế tim, nguy cơ nhịp chậm, block nhĩ thất.",
     "de_xuat": "Theo dõi nhịp tim, điện tâm đồ.",
     "nguon": "Tương tác chẹn beta-chống loạn nhịp"},
    {"a": "chen_beta", "b": "chen_kenh_calci", "muc": "warning",
     "hau_qua": "Phối hợp có thể cộng gộp ức chế dẫn truyền nhĩ thất và co cơ tim, nguy cơ nhịp chậm/tụt huyết áp (đặc biệt nhóm non-dihydropyridine).",
     "de_xuat": "Theo dõi nhịp tim và huyết áp sát khi mới phối hợp.",
     "nguon": "Tương tác chẹn beta-chẹn kênh calci"},
    {"a": "khang_ket_tap_tieu_cau", "b": "khang_dong_truc_tiep", "muc": "critical",
     "hau_qua": "Phối hợp kháng kết tập tiểu cầu với kháng đông trực tiếp (DOAC) làm tăng đáng kể nguy cơ chảy máu.",
     "de_xuat": "Chỉ phối hợp khi có chỉ định rõ ràng (vd sau đặt stent + rung nhĩ); xem lại thời gian điều trị kép.",
     "nguon": "ESC Hội chứng mạch vành cấp / Rung nhĩ"},
    {"a": "khang_vitamin_k", "b": "khang_ket_tap_tieu_cau", "muc": "critical",
     "hau_qua": "Tăng nguy cơ chảy máu khi phối hợp kháng vitamin K với thuốc kháng kết tập tiểu cầu.",
     "de_xuat": "Chỉ phối hợp khi có chỉ định rõ ràng, theo dõi sát dấu hiệu chảy máu.",
     "nguon": "ESC Rung nhĩ / Hội chứng mạch vành cấp"},
    {"a": "digoxin", "b": "chong_loan_nhip", "muc": "warning",
     "hau_qua": "Amiodarone làm tăng nồng độ digoxin trong máu, có thể gây ngộ độc digoxin.",
     "de_xuat": "Giảm liều digoxin (thường 30-50%) khi phối hợp với amiodarone, theo dõi nồng độ.",
     "nguon": "Tương tác digoxin-amiodarone"},
    {"a": "digoxin", "b": "loi_tieu_quai", "muc": "warning",
     "hau_qua": "Lợi tiểu quai gây hạ kali máu, làm tăng nguy cơ ngộ độc digoxin dù nồng độ digoxin không đổi.",
     "de_xuat": "Theo dõi kali máu định kỳ khi phối hợp.",
     "nguon": "Tương tác digoxin-lợi tiểu quai"},
]

# ─── LUẬT CHỈNH LIỀU THEO CHỨC NĂNG THẬN (eGFR) ───────────────────────────────
RENAL_RULES = [
    {"generic": "metformin", "egfr_lt": 30, "muc": "critical",
     "note": "Chống chỉ định khi eGFR dưới 30 do nguy cơ nhiễm toan lactic.",
     "nguon": "ADA 2025 / KDIGO"},
    {"generic": "dapagliflozin", "egfr_lt": 25, "muc": "warning",
     "note": "Không khởi trị khi eGFR dưới 25.", "nguon": "ESC / ADA 2025"},
    {"generic": "levofloxacin", "egfr_lt": 50, "muc": "warning",
     "note": "Cần chỉnh liều khi độ thanh thải creatinin dưới 50 mL/phút.",
     "nguon": "Hướng dẫn kê đơn fluoroquinolon"},
    {"generic": "rivaroxaban", "egfr_lt": 30, "muc": "critical",
     "note": "Chống chỉ định/cần chỉnh liều khi eGFR dưới 30 — nguy cơ tích lũy thuốc, tăng chảy máu.",
     "nguon": "ESC Rung nhĩ 2025"},
    {"generic": "apixaban", "egfr_lt": 25, "muc": "warning",
     "note": "Cần chỉnh liều khi eGFR dưới 25-30, theo dõi sát dấu hiệu chảy máu.",
     "nguon": "ESC Rung nhĩ 2025"},
    {"generic": "dabigatran", "egfr_lt": 30, "muc": "critical",
     "note": "Chống chỉ định khi eGFR dưới 30 — thải trừ chủ yếu qua thận.",
     "nguon": "ESC Rung nhĩ 2025"},
    {"generic": "spironolactone", "egfr_lt": 30, "muc": "critical",
     "note": "Tăng nguy cơ tăng kali máu nặng khi eGFR dưới 30, cần theo dõi kali sát hoặc tránh dùng.",
     "nguon": "ESC Suy tim 2025 / KDIGO"},
    {"generic": "gliclazide", "egfr_lt": 30, "muc": "warning",
     "note": "Tăng nguy cơ hạ đường huyết khi chức năng thận giảm nặng, cần chỉnh liều.",
     "nguon": "ADA 2025"},
]

# ─── THUỐC PHÙ HỢP GUIDELINE (gắn nhãn xanh) ──────────────────────────────────
FAVORABLE_RULES = [
    {"generic": "dapagliflozin", "dieu_kien": "suy_tim",
     "note": "SGLT2i được ESC khuyến cáo cho bệnh nhân suy tim, cải thiện tiên lượng.",
     "nguon": "ESC suy tim 2025"},
]


# ─── HÀM TÍNH eGFR (CKD-EPI 2021, không yếu tố chủng tộc) ──────────────────────
def compute_egfr(creatinine_umol: Optional[float], age: Optional[int], sex_male: bool) -> Optional[int]:
    """
    eGFR theo công thức CKD-EPI 2021 (không hệ số chủng tộc).

    LƯU Ý 2 LỖI ĐÃ SỬA (phát hiện qua test edge case, không phải lý thuyết):
    1. `if not creatinine_umol or not age` coi age=0 là falsy -> trả None sai
       cho bệnh nhân sơ sinh (0 tuổi) dù dữ liệu hợp lệ. Đổi thành so sánh
       "is None" + kiểm tra giá trị dương rõ ràng.
    2. Creatinin âm hoặc 0 (dữ liệu lỗi/chưa nhập) làm (scr/k) âm, mũ với
       alpha không nguyên ra số phức -> crash TypeError khi round(). Chặn
       sớm bằng kiểm tra creatinine_umol > 0.
    """
    if creatinine_umol is None or age is None:
        return None
    if creatinine_umol <= 0 or age < 0:
        return None  # dữ liệu không hợp lệ -> không tính, không bịa số
    scr = creatinine_umol / 88.4  # mg/dL
    k = 0.9 if sex_male else 0.7
    alpha = -0.302 if sex_male else -0.241
    egfr = 142 * (min(scr / k, 1) ** alpha) * (max(scr / k, 1) ** -1.200) * (0.9938 ** age)
    if not sex_male:
        egfr *= 1.012
    return round(egfr)


# ─── CHUẨN HÓA TÊN THUỐC -> HOẠT CHẤT ─────────────────────────────────────────
def resolve_generic(ten_thuoc: str) -> Optional[str]:
    """Lấy hoạt chất từ tên thuốc. Ưu tiên phần trong ngoặc, fallback bảng biệt dược."""
    import re
    paren = re.search(r"\(([^)]+)\)", ten_thuoc or "")
    if paren:
        first = re.split(r"[+/,]", paren.group(1))[0].strip().lower()
        for g in GENERIC_GROUPS:
            if g in first or first in g:
                return g
    brand = re.split(r"\d", ten_thuoc or "")[0].strip().lower()
    return BRAND_TO_GENERIC.get(brand)


# ─── KIỂM TRA AN TOÀN ĐƠN THUỐC ───────────────────────────────────────────────
def check_drug_safety(drugs: list, egfr: Optional[int], context: dict) -> dict:
    """
    drugs: list các dict có khóa 'ten_thuoc' (hoặc 'ten_goc').
    Trả về interactions, renal_flags, favorable, duplicate_groups.
    """
    resolved = []
    for d in drugs or []:
        name = d.get("ten_thuoc") or d.get("ten_goc") or ""
        g = resolve_generic(name)
        resolved.append({"name": name, "generic": g, "groups": GENERIC_GROUPS.get(g, [])})

    interactions = []
    for i in range(len(resolved)):
        for j in range(i + 1, len(resolved)):
            A, B = resolved[i], resolved[j]
            for rule in INTERACTION_RULES:
                hit = (rule["a"] in A["groups"] and rule["b"] in B["groups"]) or \
                      (rule["b"] in A["groups"] and rule["a"] in B["groups"])
                if hit:
                    interactions.append({
                        "thuoc_a": A["generic"] or A["name"],
                        "thuoc_b": B["generic"] or B["name"],
                        **rule,
                    })

    renal_flags = []
    if egfr is not None:
        for m in resolved:
            for rule in RENAL_RULES:
                if rule["generic"] == m["generic"] and egfr < rule["egfr_lt"]:
                    renal_flags.append({"thuoc": m["generic"], "egfr": egfr, **rule})

    favorable = []
    for m in resolved:
        for rule in FAVORABLE_RULES:
            if rule["generic"] == m["generic"] and context.get(rule["dieu_kien"]):
                favorable.append({"thuoc": m["generic"], **rule})

    # Trùng nhóm thuốc (mục 9-B1): 2 thuốc khác hoạt chất nhưng CÙNG nhóm dược
    # lý — thường không cần dùng đồng thời, có thể là sai sót kê đơn hoặc
    # quên ngừng thuốc cũ. Chỉ báo khi đã xác định được "generic" (bỏ qua
    # thuốc không nhận diện được, để tránh báo nhầm "trùng nhóm rỗng").
    duplicate_groups = []
    seen_pairs = set()
    for i in range(len(resolved)):
        for j in range(i + 1, len(resolved)):
            A, B = resolved[i], resolved[j]
            if not A["generic"] or not B["generic"] or A["generic"] == B["generic"]:
                continue  # cùng hoạt chất hệt nhau thì không tính "trùng nhóm" mà là trùng thuốc hẳn
            common_groups = set(A["groups"]) & set(B["groups"])
            for grp in common_groups:
                pair_key = tuple(sorted([A["generic"], B["generic"]]) + [grp])
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)
                duplicate_groups.append({
                    "nhom": grp,
                    "thuoc_a": A["generic"],
                    "thuoc_b": B["generic"],
                    "ghi_chu": f"Hai thuốc khác hoạt chất nhưng cùng nhóm dược lý "
                               f"({grp}) — kiểm tra có cần dùng đồng thời hay là "
                               f"sai sót quên ngừng thuốc cũ.",
                })

    return {
        "interactions": interactions,
        "renal_flags": renal_flags,
        "favorable": favorable,
        "duplicate_groups": duplicate_groups,
    }


# ─── SÀNG LỌC ƯU TIÊN (Sepsis / AKI / điện giải / suy tim) ────────────────────
def run_priority_screens(report: dict) -> dict:
    """So ngưỡng vital + lab, trả về findings 3 mức: critical / warning / stable."""
    v = report.get("dau_hieu_sinh_ton", {}) or {}
    labs = report.get("xet_nghiem_key") or []
    lab_of = lambda key: next((l for l in labs if l.get("key") == key), None)

    dx = (report.get("chan_doan_chinh", "") + " " + report.get("tien_su_benh", "")).lower()
    bnp = lab_of("NT-proBNP")
    context = {"suy_tim": ("suy tim" in dx or "probnp" in dx or (bnp and bnp.get("rawVal", 0) > 900))}

    findings = []
    add = lambda muc, ten, ly_do, nguon: findings.append(
        {"muc": muc, "ten": ten, "ly_do": ly_do, "nguon": nguon})

    spo2, rr = v.get("spo2"), v.get("nhip_tho")
    sbp = v.get("ha_tt")
    temp, lactate = v.get("nhiet_do"), v.get("lactate")

    # Hô hấp (ESC)
    if spo2 is not None and spo2 < 92:
        add("critical", "Suy hô hấp", f"SpO2 {spo2}% (dưới 92%)", "ESC")
    elif rr is not None and rr >= 25:
        add("warning", "Theo dõi hô hấp", f"Nhịp thở {rr} lần/phút", "ESC")
    elif spo2 is not None:
        add("stable", "Hô hấp ổn định", f"SpO2 {spo2}%, nhịp thở {rr} lần/phút", "ESC")

    # Sốc nhiễm khuẩn (Rule Sepsis của bác sĩ): Sốt + Lactate + tụt HA
    if (temp is not None and temp > 38.5) and (lactate is not None and lactate > 2.0) and (sbp is not None and sbp < 90):
        add("critical", "Nguy cơ sốc nhiễm khuẩn",
            f"Sốt {temp} độ, lactate {lactate} mmol/L, huyết áp tâm thu {sbp} mmHg", "Sepsis 2026")
    else:
        add("stable", "Không dấu hiệu sốc nhiễm khuẩn",
            f"Huyết áp {sbp}/{v.get('ha_ttr','-')}, lactate {lactate} mmol/L, nhiệt độ {temp} độ", "Sepsis 2026")

    # Suy thận (KDIGO)
    creat = lab_of("Creatinin")
    creat_val = creat.get("rawVal") if creat else None
    egfr = compute_egfr(creat_val, report.get("thong_tin_benh_nhan", {}).get("tuoi"),
                        "nam" in report.get("thong_tin_benh_nhan", {}).get("gioi_tinh", "").lower())
    if egfr is not None:
        if egfr < 30:
            add("critical", "Suy thận nặng", f"eGFR {egfr} mL/phút/1.73m2 (dưới 30)", "KDIGO 2026")
        elif egfr < 45:
            add("warning", "Suy giảm chức năng thận", f"eGFR {egfr} mL/phút/1.73m2", "KDIGO 2026")
        else:
            add("stable", "Chức năng thận bình thường",
                f"eGFR {egfr} mL/phút/1.73m2, creatinin {creat_val} µmol/L", "KDIGO 2026")

    # Kali máu (KDIGO tăng kali)
    k = lab_of("K+")
    k_val = k.get("rawVal") if k else None
    if k_val is not None:
        if k_val > 6.0:
            add("critical", "Tăng kali máu nặng", f"Kali {k_val} mmol/L (trên 6.0)", "KDIGO tăng kali")
        elif k_val > 5.5:
            add("warning", "Tăng kali máu", f"Kali {k_val} mmol/L (trên 5.5)", "KDIGO tăng kali")
        else:
            add("stable", "Kali máu trong giới hạn", f"Kali {k_val} mmol/L", "KDIGO")

    # Natri máu
    na = lab_of("Na+")
    na_val = na.get("rawVal") if na else None
    if na_val is not None:
        if na_val < 125:
            add("critical", "Hạ natri máu nặng", f"Na {na_val} mmol/L (dưới 125)", "Điện giải đồ")
        elif na_val < 135:
            add("warning", "Hạ natri máu", f"Na {na_val} mmol/L (dưới 135)", "Điện giải đồ")

    # Suy tim (NT-proBNP)
    bnp_val = bnp.get("rawVal") if bnp else None
    if bnp_val is not None and bnp_val > 2000 and context["suy_tim"]:
        add("critical", "Suy tim cần quản lý tích cực",
            f"NT-proBNP {bnp_val} pg/mL (rất cao) kèm chẩn đoán suy tim", "ESC suy tim 2025")
    elif bnp_val is not None and bnp_val > 900:
        add("warning", "Marker suy tim tăng", f"NT-proBNP {bnp_val} pg/mL", "ESC suy tim 2025")

    # Viêm nhiễm (CRP)
    crp = lab_of("CRP")
    crp_val = crp.get("rawVal") if crp else None
    if crp_val is not None and crp_val > 10:
        add("warning", "Phản ứng viêm còn cao", f"CRP {crp_val} mg/L (chưa về dưới 5)", "Xét nghiệm")

    return {"findings": findings, "egfr": egfr, "context": context}


# ─── DỮ LIỆU CHO BƯỚC 3 (LLM diễn đạt diễn tiến) ──────────────────────────────
def build_trend_facts(report: dict) -> dict:
    """
    KHÔNG kết luận ở đây. Chỉ trích các mốc chênh lệch (delta) để đưa cho Claude
    diễn đạt ở Bước 3. Claude chỉ được dựa trên các con số này, không bịa thêm.
    """
    labs = report.get("xet_nghiem_key") or []
    facts = []
    for m in labs:
        trend = m.get("trend") or []
        if len(trend) >= 2:
            facts.append({
                "chi_so": m.get("key"),
                "dau": trend[0], "cuoi": trend[-1],
                "huong": "giam" if trend[-1] < trend[0] else "tang" if trend[-1] > trend[0] else "khong_doi",
                "chuoi": trend,
                "don_vi": m.get("unit", ""),
            })
    return {"trend_facts": facts}


# ═══════════════════════════════════════════════════════════════════════════
# THANG ĐIỂM NGUY CƠ: CHA2DS2-VASc + HAS-BLED
# ═══════════════════════════════════════════════════════════════════════════
# NGUYÊN TẮC AN TOÀN (bắt buộc):
#   - Đây là HỖ TRỢ QUYẾT ĐỊNH, KHÔNG tự kê đơn/chỉnh liều chống đông.
#   - Mỗi điểm cộng PHẢI kèm "biến đầu vào" + "nguồn" để bác sĩ tự kiểm tra,
#     và biến KHÔNG xác định được trong hồ sơ phải hiển thị rõ "không xác định"
#     (không ngầm coi = không có bệnh).
#   - Input lấy từ text tự do (chan_doan_chinh, tien_su_benh, canh_bao_nguy_co)
#     vì schema hiện tại chưa có field Có/Không riêng cho từng bệnh kèm theo.
#     Đây là HẠN CHẾ ĐÃ BIẾT: nếu hồ sơ ghi bệnh kèm theo bằng từ viết tắt lạ
#     hoặc không nhắc tới, hệ thống sẽ báo "không xác định", không tự suy diễn.

# Từ khóa (đã bỏ dấu, thường) khớp với cách ghi thực tế trong HIS/bệnh án giấy
# (xem ca mẫu: "ĐTĐ II", "HHoC", "ĐTN", "RLĐM" là viết tắt, không phải Có/Không
# rạch ròi như form REDCap). Tấn/Ngân rà soát và bổ sung thêm khi gặp ca mới.
CV_KEYWORDS = {
    "suy_tim": ["suy tim", "EF giam", "phan suat tong mau giam", "rlcn tam thu"],
    "tang_huyet_ap": ["tang huyet ap", "THA", "cao huyet ap"],
    "dtd": ["dai thao duong", "ĐTĐ", "dtd type", "dtd ii", "dtd i", "hba1c"],
    "dot_quy_tia_huyet_khoi": [
        "dot quy", "tai bien mach mau nao", "nhoi mau nao", "tia ",
        "thieu mau nao cuc bo",
        # LƯU Ý: ĐÃ BỎ "thuyen tac"/"huyet khoi" — 2 từ này quá rộng, thường
        # xuất hiện trong câu CẢNH BÁO NGUY CƠ DỰ PHÒNG (vd "nguy cơ huyết
        # khối van do INR thấp" ở bệnh nhân van cơ học), không phải biến cố
        # ĐÃ XẢY RA thật. Giữ chúng gây false positive S2 (+2 điểm) sai cho
        # mọi bệnh nhân van cơ học có INR dao động — tức gần như toàn bộ ca
        # demo chính. Nếu cần bắt "tiền sử thuyên tắc/huyết khối THẬT", nên
        # ghép với cụm "tiền sử" đứng trước (vd "tiền sử huyết khối tĩnh
        # mạch") thay vì khớp từ đơn lẻ — để Tấn/Ngân quyết định cụm ghép cụ
        # thể khi gặp ca thật.
    ],
    "benh_mach_mau": [
        "nhoi mau co tim", "nmct", "benh dong mach ngoai bien", "hep dong mach canh",
        "mang xo vua dmc", "xo vua dong mach", "benh mach mau",
        # Bổ sung sau khi phát hiện bỏ sót thật qua test với dữ liệu demo có sẵn
        # (PATIENT_B trong App.jsx): "Bệnh mạch vành đã đặt 2 stent ĐMV" KHÔNG
        # khớp bộ keyword cũ dù đây là cách ghi rất phổ biến trong bệnh án.
        "benh mach vanh", "dat stent", "stent dmv", "stent mach vanh",
        "can thiep mach vanh", "dat gia do mach vanh", "bac cau mach vanh",
        "cabg", "pci",
    ],
}

# Từ khóa riêng cho HAS-BLED (một số trùng CV_KEYWORDS, tách để rõ nghĩa)
HB_KEYWORDS = {
    "benh_gan": ["xo gan", "viem gan", "suy gan", "benh gan man"],
    "tien_su_chay_mau": [
        "xuat huyet", "tien su chay mau", "loet da day xuat huyet",
        # LƯU Ý: ĐÃ BỎ "chay mau" đơn lẻ — quá rộng, thường khớp nhầm câu
        # CẢNH BÁO NGUY CƠ DỰ PHÒNG (vd "nguy cơ chảy máu" khi INR cao ở
        # bệnh nhân van cơ học), không phải tiền sử chảy máu THẬT đã xảy ra.
        # Cùng nguyên nhân với việc đã bỏ "huyet khoi"/"thuyen tac" khỏi
        # CV_KEYWORDS["dot_quy_tia_huyet_khoi"]. Nếu cần bắt rộng hơn, ghép
        # với cụm "tiền sử" đứng trước, để Tấn/Ngân quyết định cụm cụ thể.
    ],
    "thuoc_tang_chay_mau": ["nsaid", "aspirin", "khang ket tap tieu cau", "ibuprofen", "diclofenac"],
    "ruou": ["nghien ruou", "uong ruou nhieu", "lam dung ruou", "ruou bia"],
}


def _text_has_any(haystack_stripped: str, keywords: list) -> bool:
    """Khớp keyword thô, KHÔNG xét phủ định. Dùng cho trường hợp phủ định
    không có ý nghĩa (vd dò tên thuốc trong danh sách thuốc — không ai viết
    "không dùng metformin" trong danh sách thuốc đang dùng)."""
    return any(_strip_accents(kw) in haystack_stripped for kw in keywords)


# Cụm phủ định tiếng Việt thường gặp trong bệnh án khi mô tả KHÔNG có bệnh/
# biến cố. Đặt NGAY TRƯỚC từ khóa bệnh trong câu, ví dụ "không ghi nhận đái
# tháo đường", "chưa từng đột quỵ". Đã bỏ dấu để khớp cùng cách với keyword.
NEGATION_PHRASES = [
    "khong ghi nhan", "khong co", "khong bi", "chua tung", "chua co",
    "khong phat hien", "phu nhan", "loai tru",
]

# Cụm "CẢNH BÁO NGUY CƠ DỰ PHÒNG" — KHÁC bản chất với phủ định (phủ định nói
# "không có", cụm này nói "có khả năng xảy ra trong tương lai, CHƯA xảy ra"),
# nhưng dùng CÙNG cơ chế lọc theo cửa sổ ký tự. ĐÃ PHÁT HIỆN qua test có hệ
# thống (không chỉ test case cố định): trước đây chỉ bỏ keyword cụ thể như
# "huyết khối"/"chảy máu" khỏi danh sách, nhưng "đột quỵ"/"tai biến mạch máu
# não" tự nó vẫn khớp dù đứng sau "nguy cơ"/"phòng ngừa" — đây là lỗi tổng
# quát hơn (thiếu cơ chế, không phải thiếu 1 từ khóa), sửa đúng gốc bằng cách
# thêm nhóm cụm dự phòng này, áp dụng tương tự NEGATION_PHRASES.
PROSPECTIVE_RISK_PHRASES = [
    "nguy co", "can phong ngua", "can theo doi", "co kha nang",
    "trong tuong lai", "de phong", "canh bao nguy co",
]
# Khoảng cách tối đa (số ký tự) cho phép giữa cụm phủ định và từ khóa bệnh để
# vẫn coi là phủ định "của" từ khóa đó — tránh bắt nhầm phủ định ở câu khác
# cách xa trong đoạn văn dài.
NEGATION_WINDOW_CHARS = 35


def _text_has_any_positive(haystack_stripped: str, keywords: list) -> bool:
    """
    Giống _text_has_any, nhưng loại trừ trường hợp keyword nằm ngay sau một
    cụm phủ định gần đó (vd "không ghi nhận đái tháo đường" -> KHÔNG tính là
    có ĐTĐ). Đây là rule TẤT ĐỊNH đơn giản (tìm cụm phủ định trong khoảng
    NEGATION_WINDOW_CHARS ký tự trước vị trí khớp) — KHÔNG phải xử lý ngôn
    ngữ tự nhiên đầy đủ, vẫn có thể bỏ sót phủ định viết khác cách hoặc bắt
    nhầm phủ định ở câu trước không liên quan. Dùng cho mọi chỗ dò BỆNH KÈM
    THEO/TIỀN SỬ (CHA2DS2-VASc, HAS-BLED) — nơi câu phủ định thực sự xuất
    hiện phổ biến trong bệnh án ("không ghi nhận đái tháo đường").
    """
    for kw in keywords:
        kw_stripped = _strip_accents(kw)
        start = 0
        while True:
            idx = haystack_stripped.find(kw_stripped, start)
            if idx == -1:
                break
            window_start = max(0, idx - NEGATION_WINDOW_CHARS)
            window = haystack_stripped[window_start:idx]
            is_negated = any(neg in window for neg in NEGATION_PHRASES)
            is_prospective = any(p in window for p in PROSPECTIVE_RISK_PHRASES)
            if not is_negated and not is_prospective:
                return True  # tìm được 1 lần khớp KHÔNG bị phủ định/dự phòng -> đủ để tính "có"
            start = idx + len(kw_stripped)  # khớp này bị loại, tìm lần khớp tiếp theo
    return False


def _gather_text(report: dict) -> str:
    """Gộp các trường text tự do hay chứa bệnh kèm theo, đã bỏ dấu."""
    parts = [
        report.get("chan_doan_chinh", "") or "",
        report.get("tien_su_benh", "") or "",
    ]
    for c in (report.get("canh_bao_nguy_co") or []):
        parts.append(c.get("mo_ta", "") or "")
        parts.append(c.get("can_cu", "") or "")
    return _strip_accents(" ".join(parts))


def _is_mechanical_valve(report: dict) -> bool:
    """Nhận biết van cơ học qua chẩn đoán/phẫu thuật (cùng cách main.py LUẬT 17 dùng)."""
    txt = _gather_text(report)
    pt = _strip_accents((report.get("phau_thuat", {}) or {}).get("phuong_phap", "") or "")
    combined = txt + " " + pt
    markers = ["van co hoc", "on-x", "on x", "st jude", "thay van"]
    return any(m in combined for m in markers)


def compute_cha2ds2_vasc(report: dict) -> dict:
    """
    CHA2DS2-VASc: nguy cơ đột quỵ/huyết khối ở rung nhĩ KHÔNG do van (0-9 điểm).
    Trả về breakdown từng mục: co_mat (đã xác định có) / khong_xac_dinh.
    """
    info = report.get("thong_tin_benh_nhan", {}) or {}
    tuoi = info.get("tuoi")
    gioi_tinh_nu = "nam" not in _strip_accents(info.get("gioi_tinh", "") or "") and \
                   "nu" in _strip_accents(info.get("gioi_tinh", "") or "")
    txt = _gather_text(report)

    items = []
    total = 0

    def item(ten, diem, co, ghi_chu):
        nonlocal total
        if co:
            total += diem
        items.append({"ten": ten, "diem_neu_co": diem, "co": co, "ghi_chu": ghi_chu})

    item("C - Suy tim / rối loạn chức năng thất trái", 1,
         _text_has_any_positive(txt, CV_KEYWORDS["suy_tim"]),
         "Dò từ khóa suy tim/EF giảm trong chẩn đoán-tiền sử")
    item("H - Tăng huyết áp", 1,
         _text_has_any_positive(txt, CV_KEYWORDS["tang_huyet_ap"]),
         "Dò từ khóa tăng huyết áp/THA")

    if tuoi is not None:
        if tuoi >= 75:
            item("A2 - Tuổi ≥ 75", 2, True, f"Tuổi {tuoi}")
        elif tuoi >= 65:
            item("A - Tuổi 65-74", 1, True, f"Tuổi {tuoi}")
        else:
            item("A/A2 - Nhóm tuổi nguy cơ (65-74 hoặc ≥75)", 0, False, f"Tuổi {tuoi} (dưới 65)")
    else:
        item("A/A2 - Nhóm tuổi nguy cơ (65-74 hoặc ≥75)", 0, False, "Không xác định: thiếu tuổi")

    item("D - Đái tháo đường", 1,
         _text_has_any_positive(txt, CV_KEYWORDS["dtd"]),
         "Dò từ khóa đái tháo đường/ĐTĐ/HbA1C")
    item("S2 - Tiền sử đột quỵ/TIA/thuyên tắc", 2,
         _text_has_any_positive(txt, CV_KEYWORDS["dot_quy_tia_huyet_khoi"]),
         "Dò từ khóa đột quỵ/TIA/thuyên tắc/huyết khối")
    item("V - Bệnh mạch máu (NMCT cũ, bệnh ĐM ngoại biên, mảng xơ vữa ĐMC)", 1,
         _text_has_any_positive(txt, CV_KEYWORDS["benh_mach_mau"]),
         "Dò từ khóa NMCT/bệnh động mạch ngoại biên/xơ vữa ĐMC")

    if info.get("gioi_tinh"):
        item("Sc - Giới nữ", 1, gioi_tinh_nu, f"Giới tính ghi nhận: {info.get('gioi_tinh')}")
    else:
        item("Sc - Giới nữ", 0, False, "Không xác định: thiếu giới tính")

    mechanical_valve = _is_mechanical_valve(report)

    return {
        "ten_thang_diem": "CHA2DS2-VASc",
        "tong_diem": total,
        "thang_diem_toi_da": 9,
        "chi_tiet": items,
        "nguon_guideline": "ESC/AHA Atrial Fibrillation Guideline",
        "canh_bao_boi_canh": (
            "Bệnh nhân có VAN CƠ HỌC: CHA2DS2-VASc được xây dựng cho rung nhĩ KHÔNG "
            "do van — với van cơ học, chỉ định chống đông (warfarin/kháng vitamin K) "
            "là BẮT BUỘC bất kể điểm số này. Điểm số ở đây chỉ mang tính minh họa thêm "
            "bối cảnh nguy cơ tổng quát, KHÔNG dùng để quyết định có chống đông hay không."
            if mechanical_valve else
            "Thang điểm áp dụng cho rung nhĩ không do bệnh van tim. Cần bác sĩ xác nhận "
            "trước khi dùng để ra quyết định chống đông."
        ),
        "mechanical_valve": mechanical_valve,
        "nhan": "Hỗ trợ quyết định — cần bác sĩ xác nhận",
    }


def compute_has_bled(report: dict, egfr: Optional[int], inr_trend: Optional[list] = None) -> dict:
    """
    HAS-BLED: nguy cơ chảy máu khi dùng chống đông (0-9 điểm).
    inr_trend: mảng giá trị INR theo thời gian (nếu có) để đánh giá "labile" (dao động).
    """
    info = report.get("thong_tin_benh_nhan", {}) or {}
    tuoi = info.get("tuoi")
    txt = _gather_text(report)
    v = report.get("dau_hieu_sinh_ton", {}) or {}
    sbp = v.get("ha_tt")

    items = []
    total = 0

    def item(ten, diem, co, ghi_chu):
        nonlocal total
        if co:
            total += diem
        items.append({"ten": ten, "diem_neu_co": diem, "co": co, "ghi_chu": ghi_chu})

    if sbp is not None:
        item("H - Tăng huyết áp không kiểm soát (HATT > 160)", 1, sbp > 160,
             f"Huyết áp tâm thu ghi nhận gần nhất: {sbp} mmHg")
    else:
        item("H - Tăng huyết áp không kiểm soát (HATT > 160)", 0, False,
             "Không xác định: thiếu huyết áp tâm thu")

    # A - bất thường thận và/hoặc gan, tối đa +2 (tách 2 thành phần để minh bạch)
    than_bat_thuong = egfr is not None and egfr < 60
    if egfr is not None:
        item("A - Bất thường chức năng thận (eGFR < 60)", 1, than_bat_thuong,
             f"eGFR {egfr} mL/phút/1.73m2 (CKD-EPI 2021)")
    else:
        item("A - Bất thường chức năng thận (eGFR < 60)", 0, False,
             "Không xác định: thiếu eGFR (cần Creatinin + tuổi + giới)")

    gan_bat_thuong = _text_has_any_positive(txt, HB_KEYWORDS["benh_gan"])
    item("A - Bất thường chức năng gan", 1, gan_bat_thuong,
         "Dò từ khóa xơ gan/viêm gan/suy gan trong chẩn đoán-tiền sử")

    item("S - Tiền sử đột quỵ", 1,
         _text_has_any_positive(txt, CV_KEYWORDS["dot_quy_tia_huyet_khoi"]),
         "Dò từ khóa đột quỵ/tai biến mạch máu não")
    item("B - Tiền sử/cơ địa chảy máu", 1,
         _text_has_any_positive(txt, HB_KEYWORDS["tien_su_chay_mau"]),
         "Dò từ khóa xuất huyết/chảy máu trong tiền sử")

    # L - INR dao động (labile): cần ít nhất 3 điểm đo để đánh giá biến thiên thật
    labile = False
    labile_note = "Không xác định: chưa đủ dữ liệu INR (cần ≥ 3 lần đo)"
    if inr_trend and len(inr_trend) >= 3:
        lo, hi = min(inr_trend), max(inr_trend)
        labile = (hi - lo) >= 1.5  # dao động rộng quanh đích 2.0-3.0
        labile_note = f"Dải INR ghi nhận: {lo} đến {hi} (chênh {round(hi-lo,2)})"
    item("L - INR dao động (labile / TTR thấp)", 1, labile, labile_note)

    if tuoi is not None:
        item("E - Tuổi > 65", 1, tuoi > 65, f"Tuổi {tuoi}")
    else:
        item("E - Tuổi > 65", 0, False, "Không xác định: thiếu tuổi")

    # D - thuốc tăng chảy máu và/hoặc rượu, tối đa +2
    thuoc_nguy_co = False
    for d in (report.get("thuoc_cuoi_ky") or []):
        name = _strip_accents(d.get("ten_thuoc", "") or "")
        if _text_has_any(name, HB_KEYWORDS["thuoc_tang_chay_mau"]):
            thuoc_nguy_co = True
            break
    item("D - Thuốc tăng nguy cơ chảy máu (kháng tiểu cầu/NSAID)", 1, thuoc_nguy_co,
         "Dò trong danh sách thuốc hiện dùng")
    item("D - Lạm dụng rượu", 1, _text_has_any_positive(txt, HB_KEYWORDS["ruou"]),
         "Dò từ khóa lạm dụng rượu trong tiền sử")

    return {
        "ten_thang_diem": "HAS-BLED",
        "tong_diem": total,
        "thang_diem_toi_da": 9,
        "chi_tiet": items,
        "nguon_guideline": "ESC Guideline on Atrial Fibrillation (HAS-BLED)",
        "muc_nguy_co": "cao" if total >= 3 else "thap_trung_binh",
        "dien_giai_muc_nguy_co": (
            "Điểm ≥ 3: nguy cơ chảy máu cao — cần theo dõi sát hơn khi dùng chống đông, "
            "KHÔNG đồng nghĩa với việc ngừng chống đông (vẫn cần cân nhắc lợi ích/nguy cơ)."
            if total >= 3 else
            "Điểm dưới 3: nguy cơ chảy máu thấp đến trung bình theo thang điểm này."
        ),
        "nhan": "Hỗ trợ quyết định — cần bác sĩ xác nhận",
    }


# ═══════════════════════════════════════════════════════════════════════════
# CARE-GAP DETECTOR (mục 9-B3): quét khoảng trống theo guideline
# ═══════════════════════════════════════════════════════════════════════════
# Tất định 100%, không qua LLM — chỉ kiểm tra "có/thiếu dữ liệu" theo quy tắc
# cứng, không suy luận lâm sàng phức tạp. Mỗi care-gap có "muc_do" (cao/trung
# binh/thap) tự chọn theo mức ảnh hưởng nếu bị bỏ sót, và "ly_do" giải thích
# ngắn để bác sĩ hiểu vì sao hệ thống nêu ra.


def _parse_vn_date(s: Optional[str]) -> Optional[_dt.date]:
    """Parse ngày dạng dd/mm/yyyy (BẮT BUỘC đủ năm — khớp đúng hành vi
    parseVNDate() ở App.jsx, không suy diễn năm khi thiếu)."""
    if not s or not isinstance(s, str):
        return None
    m = re.match(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$", s)
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return _dt.date(y, mo, d)
    except ValueError:
        return None


def _days_since(date_str: Optional[str], reference: Optional[_dt.date] = None) -> Optional[int]:
    """Số ngày từ date_str tới reference (mặc định: hôm nay). None nếu không parse được."""
    d = _parse_vn_date(date_str)
    if d is None:
        return None
    ref = reference or _dt.date.today()
    return (ref - d).days


def detect_care_gaps(report: dict, egfr: Optional[int] = None) -> list:
    """
    Quét report tìm các khoảng trống dữ liệu theo guideline cơ bản. Trả về
    list các dict {muc_do, tieu_de, ly_do}. KHÔNG quyết định lâm sàng — chỉ
    nêu "thiếu gì", để bác sĩ tự quyết định có cần bổ sung hay không.

    Danh sách kiểm tra hiện tại (Tấn/Ngân rà soát + bổ sung khi cần):
      1. Suy tim/NT-proBNP cao nhưng không có lần đo NT-proBNP nào sau ra viện
      2. Có Creatinin nhưng thiếu tuổi/giới -> không tính được eGFR
      3. Van cơ học nhưng không đủ số lần đo INR để đánh giá ổn định/TTR
      4. Có chỉ định phẫu thuật/can thiệp nhưng không có lần siêu âm tim nào
         SAU mổ để xác nhận kết quả
      5. Đã ra viện quá 30 ngày nhưng lần xét nghiệm/siêu âm gần nhất còn
         trước đó quá lâu (gợi ý: nên tái khám)
    """
    gaps = []
    labs = report.get("xet_nghiem_key") or report.get("xet_nghiem_meta") or []
    txt = _gather_text(report)
    info = report.get("thong_tin_benh_nhan") or {}
    discharge_date = info.get("ngay_ra_vien")

    def lab_dates(key: str):
        item = next((l for l in labs if (l.get("key") or "").strip().upper() == key.upper()), None)
        return item, (item.get("trendDates") if item else None)

    # 1. Suy tim / NT-proBNP cao nhưng chưa đo lại sau ra viện
    nt_item, nt_dates = lab_dates("NT-proBNP")
    suy_tim_nghi_ngo = _text_has_any_positive(txt, CV_KEYWORDS["suy_tim"]) or (
        nt_item is not None and (nt_item.get("rawVal") or 0) > 900
    )
    if suy_tim_nghi_ngo:
        has_post_discharge_nt = False
        if nt_dates and discharge_date:
            discharge_d = _parse_vn_date(discharge_date)
            for ds in nt_dates:
                d = _parse_vn_date(ds)
                if d and discharge_d and d > discharge_d:
                    has_post_discharge_nt = True
                    break
        if not has_post_discharge_nt:
            gaps.append({
                "muc_do": "trung_binh",
                "tieu_de": "Chưa đo lại NT-proBNP sau ra viện",
                "ly_do": "Hồ sơ có dấu hiệu nghi ngờ suy tim nhưng không thấy lần đo "
                         "NT-proBNP nào SAU ngày ra viện để xác nhận xu hướng hồi phục.",
            })

    # 2. Có Creatinin nhưng thiếu tuổi/giới -> không tính được eGFR
    creat_item, _ = lab_dates("Creatinin")
    if creat_item is not None and egfr is None:
        gaps.append({
            "muc_do": "trung_binh",
            "tieu_de": "Có Creatinin nhưng chưa tính được eGFR",
            "ly_do": "Thiếu tuổi hoặc giới tính trong hồ sơ — cần đủ cả 2 cùng "
                     "Creatinin để áp dụng công thức CKD-EPI 2021.",
        })

    # 3. Van cơ học nhưng không đủ số lần đo INR
    if _is_mechanical_valve(report):
        inr_item, inr_dates = lab_dates("INR")
        n_inr = len(inr_item.get("trend") or []) if inr_item else 0
        if n_inr < 3:
            gaps.append({
                "muc_do": "cao",
                "tieu_de": "Chưa đủ số lần đo INR để đánh giá TTR (% thời gian trong đích)",
                "ly_do": f"Van cơ học cần theo dõi INR định kỳ; hồ sơ hiện chỉ có "
                         f"{n_inr} lần đo, cần tối thiểu 3 lần để ước tính độ ổn định.",
            })

    # 4. Có phẫu thuật/can thiệp nhưng không có siêu âm SAU mổ
    surgery_date = (report.get("phau_thuat") or {}).get("ngay")
    if surgery_date:
        echo_list = (report.get("sieu_am_tim") or {}).get("lan_kham") or []
        surgery_d = _parse_vn_date(surgery_date)
        has_post_op_echo = False
        if surgery_d:
            for e in echo_list:
                ed = _parse_vn_date(e.get("ngay"))
                if ed and ed >= surgery_d:
                    has_post_op_echo = True
                    break
        if not has_post_op_echo:
            gaps.append({
                "muc_do": "cao",
                "tieu_de": "Chưa có siêu âm tim sau phẫu thuật để xác nhận kết quả",
                "ly_do": "Hồ sơ có ghi nhận phẫu thuật/can thiệp nhưng không thấy lần "
                         "siêu âm tim nào từ ngày mổ trở đi.",
            })

    # 5. Ra viện đã lâu nhưng lần xét nghiệm gần nhất quá xa
    discharge_days_ago = _days_since(discharge_date)
    if discharge_days_ago is not None and discharge_days_ago > 30:
        all_dates = []
        for l in labs:
            for d in (l.get("trendDates") or []):
                pd = _parse_vn_date(d)
                if pd:
                    all_dates.append(pd)
        if all_dates:
            most_recent = max(all_dates)
            discharge_d = _parse_vn_date(discharge_date)
            if discharge_d and most_recent <= discharge_d:
                gaps.append({
                    "muc_do": "thap",
                    "tieu_de": "Đã ra viện hơn 30 ngày, chưa có xét nghiệm tái khám mới",
                    "ly_do": f"Ra viện {discharge_days_ago} ngày trước, nhưng xét nghiệm "
                             f"gần nhất trong hồ sơ vẫn từ trước/đúng ngày ra viện.",
                })

    return gaps


# ═══════════════════════════════════════════════════════════════════════════
# TTR — TIME IN THERAPEUTIC RANGE (mục 9-B4): % thời gian INR trong đích
# ═══════════════════════════════════════════════════════════════════════════
# Phương pháp: % ĐƠN GIẢN (số lần đo trong đích / tổng số lần đo) — KHÔNG dùng
# Rosendaal (nội suy tuyến tính theo thời gian thực) ở bản này, vì cần
# trendDates đủ chính xác (ngày cụ thể, không phải nhãn như "ra viện") để nội
# suy đúng khoảng cách thời gian giữa 2 lần đo. Đã quan sát trong dữ liệu thật
# (MOCK_REPORT ở App.jsx) trendDates của INR có giá trị "ra viện" lẫn ngày cụ
# thể — không đồng nhất để làm Rosendaal tin cậy. Ghi rõ phương pháp trong
# output để không gây hiểu lầm là TTR chuẩn quốc tế đầy đủ.
TTR_TARGET_MIN = 2.0
TTR_TARGET_MAX = 3.0
TTR_LOW_THRESHOLD_PERCENT = 65  # ngưỡng kinh điển trong y văn — Tấn/Ngân xác nhận lại


def compute_ttr(inr_values: list, target_min: float = TTR_TARGET_MIN,
                 target_max: float = TTR_TARGET_MAX) -> Optional[dict]:
    """
    Tính TTR bằng phương pháp % đơn giản. Trả None nếu không đủ dữ liệu (cần
    tối thiểu 2 lần đo — 1 lần đo không phản ánh được "thời gian trong đích").

    LƯU Ý (phát hiện qua test edge case): lọc bỏ giá trị INR không hợp lệ
    (âm, hoặc NaN nếu có) trước khi tính — không dựa vào hành vi tình cờ của
    so sánh NaN trong Python (NaN <= x luôn False, nên NaN vô tình bị loại
    khỏi "trong đích" nhưng KHÔNG bị loại khỏi mẫu số len(inr_values), làm
    sai tỉ lệ %). Trong thực tế dữ liệu từ Claude (JSON) không có NaN, nhưng
    vẫn lọc rõ ràng để code không phụ thuộc vào hành vi ngẫu nhiên này.
    """
    valid_values = [v for v in (inr_values or []) if isinstance(v, (int, float)) and v == v and v > 0]
    if len(valid_values) < 2:
        return None
    inr_values = valid_values
    in_range = [v for v in inr_values if target_min <= v <= target_max]
    pct = round(len(in_range) / len(inr_values) * 100, 1)
    out_of_range = [
        {"gia_tri": v, "huong": "duoi_dich" if v < target_min else "tren_dich"}
        for v in inr_values if not (target_min <= v <= target_max)
    ]
    return {
        "phuong_phap": "Tỷ lệ % đơn giản (số lần đo trong đích / tổng số lần đo). "
                        "KHÔNG phải phương pháp Rosendaal (nội suy thời gian thực), "
                        "vì cần ngày đo chính xác đồng nhất cho mọi điểm.",
        "ttr_percent": pct,
        "so_lan_do": len(inr_values),
        "so_lan_trong_dich": len(in_range),
        "dich_dieu_tri": f"{target_min}-{target_max}",
        "cac_lan_ngoai_dich": out_of_range,
        "canh_bao_thap": pct < TTR_LOW_THRESHOLD_PERCENT,
        "dien_giai": (
            f"TTR {pct}% dưới ngưỡng {TTR_LOW_THRESHOLD_PERCENT}% — chống đông chưa ổn "
            f"định, cần xem lại liều/tuân thủ điều trị."
            if pct < TTR_LOW_THRESHOLD_PERCENT else
            f"TTR {pct}% đạt ngưỡng ổn định tham khảo ({TTR_LOW_THRESHOLD_PERCENT}%)."
        ),
        "nhan": "Hỗ trợ quyết định — cần bác sĩ xác nhận",
    }


# ─── HÀM TỔNG: chạy toàn bộ rule engine ───────────────────────────────────────
def evaluate(report: dict) -> dict:
    """Điểm vào duy nhất. main.py gọi hàm này sau Bước 1 (LLM extraction)."""
    screens = run_priority_screens(report)
    safety = check_drug_safety(report.get("thuoc_cuoi_ky", []), screens["egfr"], screens["context"])
    trends = build_trend_facts(report)

    # Thang điểm nguy cơ (CHA2DS2-VASc + HAS-BLED) — tất định, không qua LLM.
    labs = report.get("xet_nghiem_key") or []
    inr_item = next((l for l in labs if (l.get("key") or "").strip().upper() == "INR"), None)
    inr_trend = inr_item.get("trend") if inr_item else None

    risk_scores = {
        "cha2ds2_vasc": compute_cha2ds2_vasc(report),
        "has_bled": compute_has_bled(report, screens["egfr"], inr_trend),
    }

    ttr = compute_ttr(inr_trend) if inr_trend else None
    care_gaps = detect_care_gaps(report, screens["egfr"])

    return {
        "egfr": screens["egfr"],
        "priority_findings": screens["findings"],
        "drug_safety": safety,
        "trend_facts": trends["trend_facts"],
        "risk_scores": risk_scores,
        "ttr": ttr,
        "care_gaps": care_gaps,
    }


# ─── TEST nhanh khi chạy trực tiếp ────────────────────────────────────────────
if __name__ == "__main__":
    demo = {
        "thong_tin_benh_nhan": {"tuoi": 62, "gioi_tinh": "Nam"},
        "chan_doan_chinh": "Sau PT thay van ĐMC. Suy tim.",
        "tien_su_benh": "",
        "dau_hieu_sinh_ton": {"ha_tt": 120, "ha_ttr": 70, "nhip_tho": 18, "spo2": 97, "lactate": 1.4, "nhiet_do": 36.8},
        "xet_nghiem_key": [
            {"key": "Creatinin", "rawVal": 77, "trend": [74, 77, 77], "unit": "µmol/L"},
            {"key": "K+", "rawVal": 3.82, "trend": [3.34, 5.1, 3.82], "unit": "mmol/L"},
            {"key": "Na+", "rawVal": 131, "trend": [133, 127, 131], "unit": "mmol/L"},
            {"key": "CRP", "rawVal": 42.3, "trend": [241.4, 106.6, 42.3], "unit": "mg/L"},
            {"key": "NT-proBNP", "rawVal": 2280, "trend": [317, 2280], "unit": "pg/mL"},
        ],
        "thuoc_cuoi_ky": [
            {"ten_thuoc": "Vincerol 1mg (Acenocoumarol)"},
            {"ten_thuoc": "Medoxasol 500mg (Levofloxacin)"},
            {"ten_thuoc": "Forxiga 10mg (Dapagliflozin)"},
        ],
    }
    import json
    print(json.dumps(evaluate(demo), ensure_ascii=False, indent=2))
