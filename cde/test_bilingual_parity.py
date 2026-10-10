"""An English report and the equivalent Vietnamese report must get the same
clinical profiles, ICD groups and risk scores from the deterministic engine."""
from cde.engine import evaluate_v2


def _report(info, dx, history):
    return {
        "thong_tin_benh_nhan": info,
        "chan_doan_chinh": dx,
        "tien_su_benh": history,
        "xet_nghiem_meta": [{"key": "Creatinin", "rawVal": 110}, {"key": "INR", "rawVal": 2.4}],
    }


VI = _report({"tuoi": 70, "gioi_tinh": "Nữ"},
             "Sau phẫu thuật thay van hai lá cơ học. Rung nhĩ. Suy tim. Tăng huyết áp.",
             "Đái tháo đường type 2. Không ghi nhận đột quỵ.")
EN = _report({"tuoi": 70, "gioi_tinh": "Female"},
             "Status post mechanical mitral valve replacement. Atrial fibrillation. Heart failure. Hypertension.",
             "Type 2 diabetes. No history of stroke.")


def _profiles(r):
    return sorted((p.get("profile_id") or p.get("id") or str(p), p.get("subtype")) for p in r["active_profiles"])


def _groups(r):
    return sorted(g["icd_group"] for g in r.get("active_icd_groups", []))


def _score(r, key):
    return ((r.get("risk_scores") or {}).get(key) or {}).get("tong_diem")


def test_same_profiles():
    assert _profiles(evaluate_v2(VI)) == _profiles(evaluate_v2(EN))


def test_same_icd_groups():
    assert _groups(evaluate_v2(VI)) == _groups(evaluate_v2(EN))


def test_same_egfr_and_scores():
    vi, en = evaluate_v2(VI), evaluate_v2(EN)
    assert vi["egfr"] == en["egfr"]
    assert _score(vi, "cha2ds2_vasc") == _score(en, "cha2ds2_vasc") is not None
    assert _score(vi, "has_bled") == _score(en, "has_bled")


def test_vietnamese_word_order_mechanical_valve_is_detected():
    # "thay van hai lá cơ học" puts the valve name between "van" and "cơ học".
    subtypes = {p["subtype"] for p in evaluate_v2(VI)["active_profiles"] if p["profile_id"] == "valve_disease"}
    assert subtypes == {"mechanical"}
