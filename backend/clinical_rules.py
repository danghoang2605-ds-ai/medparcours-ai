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
import re as _re
from datetime import date as _date


# ─── DÒNG THỜI GIAN: phân 3 giai đoạn (1 trước mổ, 2 nội trú, 3 ngoại trú) ─────
def _parse_vn_date(s):
    if not s:
        return None
    m = _re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", str(s))
    if not m:
        return None
    try:
        return _date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    except ValueError:
        return None


def compute_phase_info(report: dict) -> dict:
    """Xác định bệnh nhân nội trú hay ngoại trú + giai đoạn hiện tại + mốc tương đối."""
    surg = _parse_vn_date(report.get("phau_thuat", {}).get("ngay"))
    discharge = _parse_vn_date(report.get("thong_tin_benh_nhan", {}).get("ngay_ra_vien"))
    echo_dates = [_parse_vn_date(s.get("ngay")) for s in report.get("sieu_am_tim", {}).get("lan_kham", [])]
    lab_dates = [_parse_vn_date(l.get("ngay")) for l in report.get("xet_nghiem_key", [])]
    all_dates = [d for d in echo_dates + lab_dates if d]
    current = max(all_dates) if all_dates else (discharge or surg)
    is_outpatient = bool(discharge and current and current >= discharge)
    days_post_op = (current - surg).days if (surg and current) else None
    days_post_dc = (current - discharge).days if (discharge and current) else None
    # Giai đoạn hiện tại của bệnh nhân
    if is_outpatient:
        current_phase = 3
    elif surg and current and current >= surg:
        current_phase = 2
    else:
        current_phase = 1
    return {
        "surg": surg, "discharge": discharge, "current": current,
        "is_outpatient": is_outpatient, "current_phase": current_phase,
        "days_post_op": days_post_op, "days_post_discharge": days_post_dc,
    }


def phase_of_date(date_str, info) -> Optional[int]:
    d = _parse_vn_date(date_str)
    if not d or not info.get("surg"):
        return None
    if d < info["surg"]:
        return 1
    if info.get("discharge") and d > info["discharge"]:
        return 3
    return 2


# ─── BẢN ĐỒ BIỆT DƯỢC VIỆT -> HOẠT CHẤT GỐC ───────────────────────────────────
BRAND_TO_GENERIC = {
    "vincerol": "acenocoumarol", "sintrom": "acenocoumarol", "coumadin": "warfarin",
    "medoxasol": "levofloxacin", "tavanic": "levofloxacin", "ciprobay": "ciprofloxacin",
    "forxiga": "dapagliflozin", "jardiance": "empagliflozin",
    "agifuros": "furosemid", "lasix": "furosemid", "takizd": "furosemid",
    "buflan": "cefoperazone", "pantoloc": "pantoprazole", "nexium": "esomeprazole",
    "betaloc": "metoprolol", "concor": "bisoprolol", "lipitor": "atorvastatin",
    "glucophage": "metformin", "aldactone": "spironolactone", "cordarone": "amiodarone",
}

# Hoạt chất -> nhóm dược lý
GENERIC_GROUPS = {
    "acenocoumarol": ["khang_vitamin_k"], "warfarin": ["khang_vitamin_k"],
    "levofloxacin": ["fluoroquinolon"], "ciprofloxacin": ["fluoroquinolon"],
    "furosemid": ["loi_tieu_quai"], "dapagliflozin": ["sglt2i"], "empagliflozin": ["sglt2i"],
    "pantoprazole": ["ppi"], "esomeprazole": ["ppi"], "cefoperazone": ["cephalosporin"],
    "metformin": ["biguanid"], "spironolactone": ["loi_tieu_giu_kali"],
    "metoprolol": ["chen_beta"], "bisoprolol": ["chen_beta"],
    "atorvastatin": ["statin"], "simvastatin": ["statin"],
    "amiodarone": ["chong_loan_nhip"], "clarithromycin": ["macrolid"],
    "erythromycin": ["macrolid"], "ibuprofen": ["nsaid"], "diclofenac": ["nsaid"],
    "enalapril": ["acei"], "lisinopril": ["acei"],
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
    {"a": "statin", "b": "macrolid", "muc": "warning",
     "hau_qua": "Tăng nồng độ statin, nguy cơ đau cơ và tiêu cơ vân.",
     "de_xuat": "Tạm ngừng statin trong đợt kháng sinh.",
     "nguon": "Tương tác statin-macrolid"},
    {"a": "chen_beta", "b": "chong_loan_nhip", "muc": "warning",
     "hau_qua": "Cộng gộp ức chế tim, nguy cơ nhịp chậm, block nhĩ thất.",
     "de_xuat": "Theo dõi nhịp tim, điện tâm đồ.",
     "nguon": "Tương tác chẹn beta-chống loạn nhịp"},
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
]

# ─── THUỐC PHÙ HỢP GUIDELINE (gắn nhãn xanh) ──────────────────────────────────
FAVORABLE_RULES = [
    {"generic": "dapagliflozin", "dieu_kien": "suy_tim",
     "note": "SGLT2i được ESC khuyến cáo cho bệnh nhân suy tim, cải thiện tiên lượng.",
     "nguon": "ESC suy tim 2025",
     "caution_if": "ha_natri",
     "caution_note": "Bệnh nhân đang hạ natri máu: SGLT2i có thể gây lợi niệu thẩm thấu làm "
                     "rối loạn điện giải nặng hơn. Theo dõi sát natri máu khi dùng."},
]


# ─── HÀM TÍNH eGFR (CKD-EPI 2021, không yếu tố chủng tộc) ──────────────────────
def compute_egfr(creatinine_umol: Optional[float], age: Optional[int], sex_male: bool) -> Optional[int]:
    if not creatinine_umol or not age:
        return None
    scr = creatinine_umol / 88.4  # mg/dL
    k = 0.9 if sex_male else 0.7
    alpha = -0.302 if sex_male else -0.241
    egfr = 142 * (min(scr / k, 1) ** alpha) * (max(scr / k, 1) ** -1.200) * (0.9938 ** age)
    if not sex_male:
        egfr *= 1.012
    return round(egfr)


def egfr_detail(creatinine_umol: Optional[float], age: Optional[int], sex_male: bool) -> Optional[dict]:
    """Trả về toàn bộ thông tin để hiển thị minh bạch công thức và đầu vào."""
    if not creatinine_umol or not age:
        return {
            "value": None,
            "formula": "CKD-EPI 2021 (race-free)",
            "thieu": "Thiếu Creatinin hoặc tuổi để tính eGFR.",
            "creatinine_umol": creatinine_umol,
            "age": age,
            "sex": "Nam" if sex_male else "Nữ",
        }
    scr_mgdl = creatinine_umol / 88.4
    k = 0.9 if sex_male else 0.7
    alpha = -0.302 if sex_male else -0.241
    value = compute_egfr(creatinine_umol, age, sex_male)
    return {
        "value": value,
        "formula": "eGFR = 142 x min(Scr/k, 1)^a x max(Scr/k, 1)^-1.200 x 0.9938^Tuoi" + (" x 1.012 (nu)" if not sex_male else ""),
        "ten_cong_thuc": "CKD-EPI 2021 (race-free)",
        "creatinine_umol": round(creatinine_umol, 1),
        "creatinine_mgdl": round(scr_mgdl, 2),
        "age": age,
        "sex": "Nam" if sex_male else "Nữ",
        "k": k,
        "alpha": alpha,
        "scr_div_k": round(scr_mgdl / k, 3),
        "dien_giai": (f"Scr {round(scr_mgdl,2)} mg/dL ({round(creatinine_umol,1)} umol/L), "
                      f"tuoi {age}, gioi {'Nam' if sex_male else 'Nu'} "
                      f"(k={k}, a={alpha}) -> eGFR {value} mL/phut/1.73m2"),
    }


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
    Trả về interactions, renal_flags, favorable.
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
                entry = {"thuoc": m["generic"], **rule}
                # Cross-check nguy cơ: nếu bệnh cảnh có điều kiện thận trọng -> gắn cảnh báo
                if rule.get("caution_if") and context.get(rule["caution_if"]):
                    entry["than_trong"] = rule["caution_note"]
                favorable.append(entry)

    return {"interactions": interactions, "renal_flags": renal_flags, "favorable": favorable}


# ─── SÀNG LỌC ƯU TIÊN (Sepsis / AKI / điện giải / suy tim) ────────────────────
def run_priority_screens(report: dict) -> dict:
    """So ngưỡng vital + lab, trả về findings 3 mức: critical / warning / stable."""
    v = report.get("dau_hieu_sinh_ton", {}) or {}
    labs = report.get("xet_nghiem_key") or []
    # Khớp key linh hoạt: không phân biệt hoa thường, chấp nhận biến thể tên
    # (vd Claude trả "CREATININE"/"Creatinine" thay vì "Creatinin").
    KEY_ALIASES = {
        "creatinin": ["creatinin", "creatinine", "cre"],
        "na+": ["na+", "na", "natri", "sodium", "ion natri"],
        "k+": ["k+", "k", "kali", "potassium", "ion kali"],
        "crp": ["crp", "protein phản ứng c", "c-reactive"],
        "nt-probnp": ["nt-probnp", "ntprobnp", "probnp", "bnp"],
    }
    def lab_of(key):
        aliases = KEY_ALIASES.get(key.lower(), [key.lower()])
        for l in labs:
            lk = str(l.get("key", "")).lower().strip()
            if lk == key.lower() or lk in aliases or any(a in lk for a in aliases):
                return l
        return None

    dx = (report.get("chan_doan_chinh", "") + " " + report.get("tien_su_benh", "")).lower()
    bnp = lab_of("NT-proBNP")
    na_for_ctx = lab_of("Na+")
    na_ctx_val = na_for_ctx.get("rawVal") if na_for_ctx else None
    phase_info = compute_phase_info(report)
    context = {
        "suy_tim": ("suy tim" in dx or "probnp" in dx or (bnp and bnp.get("rawVal", 0) > 900)),
        "ha_natri": (na_ctx_val is not None and na_ctx_val < 135),
        "current_phase": phase_info["current_phase"],
        "days_post_op": phase_info["days_post_op"],
    }

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
    sex_male = "nam" in report.get("thong_tin_benh_nhan", {}).get("gioi_tinh", "").lower()
    pt_age = report.get("thong_tin_benh_nhan", {}).get("tuoi")
    egfr = compute_egfr(creat_val, pt_age, sex_male)
    egfr_info = egfr_detail(creat_val, pt_age, sex_male)
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

    # Suy tim (NT-proBNP) - DIỄN GIẢI THEO GIAI ĐOẠN ĐO (không phải phase hiện tại)
    bnp_val = bnp.get("rawVal") if bnp else None
    cphase = phase_info["current_phase"]
    # Phase của CHÍNH lần đo NT-proBNP (quan trọng: giá trị cũ hậu phẫu khác giá trị ngoại trú mới)
    bnp_phase = phase_of_date(bnp.get("ngay"), phase_info) if bnp else None
    if bnp_phase is None:
        bnp_phase = cphase
    if bnp_val is not None and bnp_val > 900:
        if bnp_phase in (1, 2):
            # Đo trước/ngay sau mổ: tăng có thể do đáp ứng phẫu thuật, KHÔNG kết luận suy tim
            extra = (" Bệnh nhân hiện ở giai đoạn ngoại trú nhưng CHƯA có NT-proBNP đo lại sau xuất viện "
                     "để đánh giá suy tim hiện tại.") if cphase == 3 else ""
            add("warning", "NT-proBNP đo ở giai đoạn hậu phẫu",
                f"NT-proBNP {bnp_val} pg/mL đo ở giai đoạn hậu phẫu. Tăng NT-proBNP ngay sau mổ tim lớn "
                f"là phổ biến, có thể không phản ánh suy tim mạn, cần đối chiếu lâm sàng.{extra}", "ESC suy tim 2025")
        elif bnp_phase == 3:
            # Đo khi đã ngoại trú (giá trị mới thực sự) -> ý nghĩa lâm sàng nặng hơn
            muc = "critical" if (bnp_val > 2000 and context["suy_tim"]) else "warning"
            add(muc, "NT-proBNP vẫn tăng ở giai đoạn ngoại trú",
                f"NT-proBNP {bnp_val} pg/mL đo ở giai đoạn ngoại trú, gợi ý nguy cơ suy giảm chức năng tim, "
                f"cần đối chiếu lâm sàng và đánh giá đáp ứng điều trị.", "ESC suy tim 2025")
        else:
            add("warning", "Marker suy tim tăng", f"NT-proBNP {bnp_val} pg/mL", "ESC suy tim 2025")

    # Viêm nhiễm (CRP)
    crp = lab_of("CRP")
    crp_val = crp.get("rawVal") if crp else None
    if crp_val is not None and crp_val > 10:
        add("warning", "Phản ứng viêm còn cao", f"CRP {crp_val} mg/L (chưa về dưới 5)", "Xét nghiệm")

    # ─── TỔNG HỢP BỆNH CẢNH (clinical reasoning theo Tấn) ────────────────────
    # Không đánh giá lẻ: gom các bất thường cùng tồn tại thành một bệnh cảnh thống nhất.
    picture = []
    if context["ha_natri"]:
        picture.append("hạ natri máu")
    if egfr is not None and egfr < 60:
        picture.append("suy giảm chức năng thận")
    if k_val is not None and k_val > 5.5:
        picture.append("tăng kali máu")
    if bnp_val is not None and bnp_val > 900 and context["suy_tim"]:
        picture.append("gánh nặng suy tim (NT-proBNP tăng)")
    if crp_val is not None and crp_val > 50:
        picture.append("phản ứng viêm mạnh")
    if len(picture) >= 2:
        phase_lbl = {1: "trước can thiệp", 2: "hậu phẫu nội trú", 3: "theo dõi ngoại trú"}.get(cphase, "")
        muc = "critical" if len(picture) >= 3 else "warning"
        add(muc, "Bệnh cảnh lâm sàng phối hợp",
            f"Cùng thời điểm ({phase_lbl}) ghi nhận: {', '.join(picture)}. "
            f"Cần xử trí theo bệnh cảnh tổng thể thay vì từng chỉ số riêng lẻ, đối chiếu lâm sàng.",
            "Tổng hợp đa chỉ số")

    return {"findings": findings, "egfr": egfr, "egfr_detail": egfr_info,
            "context": context, "phase_info": phase_info}


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


# ─── HÀM TỔNG: chạy toàn bộ rule engine ───────────────────────────────────────
def normalize_clinical_labels(report: dict) -> dict:
    """Chuẩn hóa nhãn lâm sàng cứng theo yêu cầu chuyên môn (Tấn):
    - EF >= 50% luôn là 'normal' (không bao giờ 'high'/cảnh báo).
    - INR ở bệnh nhân van cơ học: mục tiêu 2.0-3.0, gán status theo mục tiêu này.
    Sửa trực tiếp trên report['xet_nghiem_key'] và trả lại report.
    """
    diag = (str(report.get("chan_doan_chinh", "")) + " "
            + str(report.get("phau_thuat", {}).get("phuong_phap", "")) + " "
            + str(report.get("tien_su_benh", ""))).lower()
    mechanical_valve = any(k in diag for k in
                           ["van cơ học", "van co hoc", "on-x", "onx", "st jude", "thay van"])

    for lab in report.get("xet_nghiem_key", []):
        key = str(lab.get("key", "")).upper().strip()
        raw = lab.get("rawVal")
        try:
            raw = float(raw) if raw is not None else None
        except (TypeError, ValueError):
            raw = None

        # EF: >= 50 luôn bình thường
        if key in ("EF", "PHÂN SUẤT TỐNG MÁU", "LVEF") and raw is not None:
            lab["status"] = "normal" if raw >= 50 else "low"

        # INR van cơ học: mục tiêu 2.0-3.0
        if key == "INR" and mechanical_valve and raw is not None:
            lab["normal"] = "2.0-3.0"
            lab["muc_tieu_van_co_hoc"] = True
            if raw < 2.0:
                lab["status"] = "low"
            elif raw > 3.0:
                lab["status"] = "high"
            else:
                lab["status"] = "normal"

    report["_benh_nhan_van_co_hoc"] = mechanical_valve
    return report


def evaluate(report: dict) -> dict:
    """Điểm vào duy nhất. main.py gọi hàm này sau Bước 1 (LLM extraction)."""
    normalize_clinical_labels(report)
    screens = run_priority_screens(report)
    safety = check_drug_safety(report.get("thuoc_cuoi_ky", []), screens["egfr"], screens["context"])
    trends = build_trend_facts(report)
    return {
        "egfr": screens["egfr"],
        "egfr_detail": screens.get("egfr_detail"),
        "priority_findings": screens["findings"],
        "drug_safety": safety,
        "trend_facts": trends["trend_facts"],
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
