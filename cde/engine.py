"""
engine.py — Điểm vào mới của Clinical Decision Engine v2 (thay evaluate() cũ).

LUỒNG THỰC THI (đúng SDS mục 4):
  Layer 1 (identify_patient)
    -> Layer 4 một phần (eGFR — tính độc lập, cần trước để Layer 2 biết CKD
       có active hay không)
    -> Layer 2 (classify_profiles — trả active_profiles, CÓ THỂ nhiều profile)
    -> Layer 3 (is_applicable — lọc indicator nào được mở khóa)
    -> Layer 4 phần còn lại (CHỈ tính nếu applicable — vd không tính TTR cho
       bệnh nhân không thuộc profile nào theo dõi bằng INR)
    -> Layer 5 (gắn cảnh báo/ngưỡng — TÁI DÙNG nguyên các hàm cũ, chúng đã
       đúng, chỉ đổi NƠI gọi)
    -> trả JSON cho Layer 6 (LLM diễn đạt ở Bước 3 — main.py, không đổi)

TƯƠNG THÍCH NGƯỢC: output vẫn giữ các field cũ (egfr, priority_findings,
drug_safety, trend_facts, risk_scores, ttr, care_gaps) để main.py/App.jsx
KHÔNG cần sửa ngay trong vòng này (đúng SDS mục 7). Field MỚI duy nhất:
"active_profiles" — frontend có thể bắt đầu dùng dần, không bắt buộc ngay.
"""
import sys
import os

# File này cần chạy được CẢ 2 CÁCH:
#   (1) Trực tiếp: `python engine.py` (để test/đối chiếu, xem cuối file)
#   (2) Import như package: `from cde.engine import evaluate_v2` (main.py thật)
# 2 cách này cần style import khác nhau trong Python, nên thử relative import
# (package) trước, fallback sang absolute import (chạy trực tiếp) nếu lỗi.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from clinical_rules import (
    compute_egfr, check_drug_safety, run_priority_screens, build_trend_facts,
    compute_cha2ds2_vasc, compute_has_bled, compute_ttr, detect_care_gaps,
    _gather_text,
)
try:
    from .disease_classifier import classify_profiles, has_profile
    from .indicators import is_applicable
    from .anticoagulation_targets import (
        SIMPLE_TARGETS, get_mechanical_valve_target, classify_anticoagulant,
    )
    from .icd_groups import classify_icd_groups, has_icd_group
    from .universal_indicators import (
        assess_vital_signs, detect_risk_factors, check_baseline_labs_completeness,
        compute_score2_applicability,
    )
    from .antithrombotic_priority import evaluate_antithrombotic_regimen
except ImportError:
    from disease_classifier import classify_profiles, has_profile
    from indicators import is_applicable
    from anticoagulation_targets import (
        SIMPLE_TARGETS, get_mechanical_valve_target, classify_anticoagulant,
    )
    from icd_groups import classify_icd_groups, has_icd_group
    from universal_indicators import (
        assess_vital_signs, detect_risk_factors, check_baseline_labs_completeness,
        compute_score2_applicability,
    )
    from antithrombotic_priority import evaluate_antithrombotic_regimen


def evaluate_v2(report: dict) -> dict:
    """Điểm vào mới. main.py có thể đổi sang gọi hàm này thay cho
    clinical_rules.evaluate() khi đã test xong (xem ghi chú cuối file)."""

    # ── Layer 4 (một phần, độc lập): eGFR phải có trước để Layer 2 biết CKD
    info = report.get("thong_tin_benh_nhan", {}) or {}
    labs = report.get("xet_nghiem_key") or []
    lab_of = lambda key: next((l for l in labs if l.get("key") == key), None)
    creat = lab_of("Creatinin")
    creat_val = creat.get("rawVal") if creat else None
    egfr = compute_egfr(
        creat_val, info.get("tuoi"),
        "nam" in (info.get("gioi_tinh") or "").lower(),
    )

    # ── Layer 2: Disease Classifier — danh sách profile active (0..N) ────────
    active_profiles = classify_profiles(report, egfr=egfr)

    # ── Layer 4 phần còn lại + Layer 5: CHỈ tính/trả nếu applicable ──────────
    indicators_out = {}

    if is_applicable("egfr", active_profiles) and egfr is not None:
        indicators_out["egfr"] = {"gia_tri": egfr, "don_vi": "mL/phut/1.73m2"}

    inr_item = next((l for l in labs if (l.get("key") or "").strip().upper() == "INR"), None)
    inr_trend = inr_item.get("trend") if inr_item else None

    if is_applicable("cha2ds2_vasc", active_profiles):
        indicators_out["cha2ds2_vasc"] = compute_cha2ds2_vasc(report)

    if is_applicable("has_bled", active_profiles):
        indicators_out["has_bled"] = compute_has_bled(report, egfr, inr_trend)

    # ── Phân loại thuốc chống đông: DOAC -> ẩn hoàn toàn INR/TTR ─────────────
    drugs = report.get("thuoc_cuoi_ky", []) or []
    anticoag = classify_anticoagulant(drugs)
    indicators_out["anticoagulant_status"] = anticoag

    # ── TTR + ngưỡng INR: CHỈ tính khi (1) applicable theo profile, (2) có đủ
    # dữ liệu INR, VÀ (3) thuốc đang dùng là VKA (không phải DOAC) ──────────
    if is_applicable("ttr", active_profiles) and inr_trend and not anticoag["an_inr_ttr"]:
        text_chan_doan = (
            (report.get("chan_doan_chinh") or "") + " " +
            (report.get("tien_su_benh") or "") + " " +
            ((report.get("phau_thuat") or {}).get("phuong_phap") or "")
        )
        ef_percent = None
        echo_visits = (report.get("sieu_am_tim") or {}).get("lan_kham") or []
        if echo_visits:
            ef_percent = echo_visits[-1].get("ef")

        is_mech_valve = has_profile(active_profiles, "valve_disease", "mechanical")
        # Đang hậu phẫu nội trú: đã có ngày mổ NHƯNG chưa có ngày ra viện —
        # liều chống đông giai đoạn này thường chưa ổn định (còn dò liều),
        # TTR tính trên các điểm đo hậu phẫu chỉ mang tính tham khảo.
        is_postop = bool((report.get("phau_thuat") or {}).get("ngay")) and not report.get("ngay_ra_vien")

        if is_mech_valve:
            # ── Van cơ học: phân tầng đầy đủ theo ESC/EACTS + AHA/ACC ───────
            mech = get_mechanical_valve_target(text_chan_doan, ef_percent)
            indicators_out["inr_target_detail"] = mech
            # Dùng ESC/EACTS làm mặc định tính TTR (an toàn hơn, ngưỡng luôn
            # >= AHA/ACC trừ ngoại lệ On-X) — CHỈ khi đủ dữ liệu xác định.
            esc = mech.get("esc_eacts_2021")
            if esc and esc.get("target_min") is not None:
                ttr_result = compute_ttr(inr_trend, esc["target_min"], esc["target_max"], is_postop=is_postop)
                if ttr_result:
                    ttr_result["nguon_nguong"] = "ESC/EACTS 2021 — " + esc["ghi_chu"]
                indicators_out["ttr"] = ttr_result
            elif esc and esc.get("chi_la_diem_don"):
                # Guideline chỉ ghi 1 điểm mục tiêu, không ghi khoảng dao động
                # -> KHÔNG tự suy diễn khoảng để tính TTR (xem ghi_chu).
                indicators_out["ttr"] = None
                indicators_out["ttr_khong_tinh_duoc_ly_do"] = [esc["ghi_chu"]]
            else:
                # Thiếu dữ liệu (vị trí van/thế hệ van không xác định) — KHÔNG
                # tự đoán ngưỡng, không tính TTR. Trả lý do rõ ràng để frontend
                # hiện "chưa xác định" thay vì số liệu sai.
                indicators_out["ttr"] = None
                indicators_out["ttr_khong_tinh_duoc_ly_do"] = mech.get("thieu_du_lieu")
        else:
            # ── Sửa van / van sinh học / không liên quan van: ngưỡng đơn giản
            subtype = next((p["subtype"] for p in active_profiles if p["profile_id"] == "valve_disease"), None)
            target = SIMPLE_TARGETS.get(subtype) or SIMPLE_TARGETS["native_disease"]
            indicators_out["inr_target_detail"] = {"subtype_ap_dung": subtype or "native_disease", **target}
            ttr_result = compute_ttr(inr_trend, target["target_min"], target["target_max"], is_postop=is_postop)
            if ttr_result:
                ttr_result["nguon_nguong"] = target["nguon"]
            indicators_out["ttr"] = ttr_result

    # ── care_gaps + drug_safety + priority_findings: GIỮ NGUYÊN cách gọi cũ,
    # chưa tách theo profile trong vòng này (xem SDS mục 6 — phạm vi vòng 1
    # chỉ làm 3 profile core, các hàm cross-cutting này để vòng sau) ────────
    screens = run_priority_screens(report)
    safety = check_drug_safety(report.get("thuoc_cuoi_ky", []), egfr, screens["context"])
    trends = build_trend_facts(report)
    care_gaps = detect_care_gaps(report, egfr)

    # ── VẤN ĐỀ 2: Disease Classifier mở rộng theo 10 nhóm ICD-10 ─────────────
    # KHÁC với active_profiles (3 profile cũ, vẫn giữ để tương thích ngược),
    # active_icd_groups là khung phân loại ĐẦY ĐỦ theo guideline anh Tấn cung
    # cấp — 1 bệnh nhân có thể thuộc nhiều nhóm ICD + nhiều subtype con cùng
    # lúc (xem icd_groups.py).
    gathered_text = _gather_text(report)
    active_icd_groups = classify_icd_groups(gathered_text)

    # ── Chỉ số chung (universal) — áp dụng cho MỌI bệnh nhân, không phụ
    # thuộc nhóm ICD nào (đúng bảng "Chung" anh Tấn cung cấp) ────────────────
    vital_signs = assess_vital_signs(report.get("dau_hieu_sinh_ton"))
    risk_factors = detect_risk_factors(gathered_text, info.get("tuoi"), info.get("gioi_tinh"))
    baseline_labs = check_baseline_labs_completeness(labs)

    # SCORE2: chỉ kiểm tra applicability, KHÔNG tự tính điểm (xem lý do trong
    # universal_indicators.py — cần Tấn/Ngân xác nhận hệ số trước khi tính).
    # Lipid/HDL hiện chưa có field chuẩn riêng trong schema -> dò qua xet_nghiem_key.
    chol_item = lab_of("Cholesterol") or lab_of("LDL")
    hdl_item = lab_of("HDL")
    score2 = compute_score2_applicability(
        info.get("tuoi"), info.get("gioi_tinh"),
        risk_factors["yeu_to_nguy_co"].get("hut_thuoc"),
        (report.get("dau_hieu_sinh_ton") or {}).get("ha_tt"),
        chol_item.get("rawVal") if chol_item else None,
        hdl_item.get("rawVal") if hdl_item else None,
    )

    # ── Quy tắc ưu tiên đa thuốc chống huyết khối (Vấn đề 2, mục 10) ─────────
    # Cross-cutting — không gắn vào 1 profile/nhóm ICD cụ thể, vì tương tác
    # xảy ra GIỮA các nhóm bệnh khác nhau (van cơ học x mạch vành).
    is_mech_valve_for_antithrombotic = has_profile(active_profiles, "valve_disease", "mechanical")
    has_pci_acs = has_icd_group(active_icd_groups, "I20_tim_thieu_mau_cuc_bo")
    antithrombotic = evaluate_antithrombotic_regimen(
        report.get("thuoc_cuoi_ky", []), is_mech_valve_for_antithrombotic, has_pci_acs,
    )

    return {
        # ── Field cũ, giữ tương thích ngược 100% ──────────────────────────
        "egfr": egfr,
        "priority_findings": screens["findings"],
        "drug_safety": safety,
        "trend_facts": trends["trend_facts"],
        "risk_scores": {
            "cha2ds2_vasc": indicators_out.get("cha2ds2_vasc"),
            "has_bled": indicators_out.get("has_bled"),
        },
        "ttr": indicators_out.get("ttr"),
        "care_gaps": care_gaps,
        # ── Field mới (Vấn đề 1) ───────────────────────────────────────────
        "active_profiles": active_profiles,
        "indicators_applicable": list(indicators_out.keys()),
        "anticoagulant_status": indicators_out.get("anticoagulant_status"),
        "inr_target_detail": indicators_out.get("inr_target_detail"),
        "ttr_khong_tinh_duoc_ly_do": indicators_out.get("ttr_khong_tinh_duoc_ly_do"),
        # ── Field mới (Vấn đề 2) ───────────────────────────────────────────
        "active_icd_groups": active_icd_groups,
        "vital_signs": vital_signs,
        "risk_factors": risk_factors,
        "baseline_labs": baseline_labs,
        "score2_applicability": score2,
        "antithrombotic_priority": antithrombotic,
    }


# ─── TEST: so sánh output v2 với evaluate() cũ trên cùng input ────────────────
# CHƯA THAY main.py gọi hàm này — chạy file này trực tiếp để đối chiếu kết quả
# với clinical_rules.evaluate() trước, đảm bảo risk_scores/ttr/egfr/care_gaps
# giống hệt (chỉ thêm active_profiles), rồi mới đổi main.py sau khi Đăng xác
# nhận kết quả khớp.
if __name__ == "__main__":
    import json
    import clinical_rules

    demo_valve = {
        "thong_tin_benh_nhan": {"tuoi": 62, "gioi_tinh": "Nam"},
        "chan_doan_chinh": "Sau PT thay van ĐMC cơ học On-X. Rung nhĩ.",
        "tien_su_benh": "",
        "dau_hieu_sinh_ton": {"ha_tt": 120, "ha_ttr": 70, "nhip_tho": 18, "spo2": 97, "lactate": 1.4, "nhiet_do": 36.8},
        "xet_nghiem_key": [
            {"key": "Creatinin", "rawVal": 77, "trend": [74, 77, 77], "unit": "µmol/L"},
            {"key": "INR", "rawVal": 2.4, "trend": [1.8, 2.4, 2.9], "unit": ""},
        ],
        "thuoc_cuoi_ky": [{"ten_thuoc": "Vincerol 1mg (Acenocoumarol)"}],
    }

    demo_valve_repair = {
        "thong_tin_benh_nhan": {"tuoi": 68, "gioi_tinh": "Nam"},
        "chan_doan_chinh": "Hở van hai lá nhiều, đã sửa van. Không phải van cơ học.",
        "tien_su_benh": "",
        "dau_hieu_sinh_ton": {},
        "xet_nghiem_key": [
            {"key": "INR", "rawVal": 1.8, "trend": [1.5, 1.8], "unit": ""},
        ],
        "thuoc_cuoi_ky": [],
    }

    print("=== Bệnh nhân van cơ học + rung nhĩ (đúng cả 2 profile) ===")
    print(json.dumps(evaluate_v2(demo_valve), ensure_ascii=False, indent=2))

    print("\n=== Bệnh nhân sửa van (KHÔNG phải van cơ học) — kiểm tra TTR/INR target ===")
    out = evaluate_v2(demo_valve_repair)
    print(json.dumps(out, ensure_ascii=False, indent=2))
    print("\nactive_profiles:", out["active_profiles"])
    print("KỲ VỌNG: profile valve_disease active với subtype='repair' (KHÔNG phải 'mechanical')")
