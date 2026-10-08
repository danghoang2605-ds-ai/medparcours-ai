"""Keyword detection for risk scores: whole-word matching, negation, and English records."""
from clinical_rules import compute_cha2ds2_vasc, compute_has_bled


def _r(dx, age=62, sex="Nam", history=""):
    return {"thong_tin_benh_nhan": {"tuoi": age, "gioi_tinh": sex},
            "chan_doan_chinh": dx, "tien_su_benh": history}


def _positives(score):
    return {i["ten"].split(" - ")[0] for i in score["chi_tiet"] if i.get("co")}


def test_valve_replacement_is_not_hypertension():
    # Regression: "tha" (hypertension abbrev.) used to match inside "thay van".
    s = compute_cha2ds2_vasc(_r("Sau phẫu thuật thay van ĐMC cơ học On-X số 23."))
    assert "H" not in _positives(s)


def test_vietnamese_hypertension_abbreviation_still_detected():
    assert "H" in _positives(compute_cha2ds2_vasc(_r("Hở hẹp chủ. THA.")))


def test_english_record_scores_like_vietnamese_record():
    vi = compute_cha2ds2_vasc(_r("Tăng huyết áp. Đái tháo đường type 2. Suy tim.", age=70, sex="Nữ"))
    en = compute_cha2ds2_vasc(_r("Hypertension. Type 2 diabetes. Heart failure.", age=70, sex="Female"))
    assert vi["tong_diem"] == en["tong_diem"] == 5


def test_english_negation_is_respected():
    s = compute_cha2ds2_vasc(_r("Atrial fibrillation. No history of stroke. Denies diabetes."))
    assert {"S2", "D"}.isdisjoint(_positives(s))


def test_english_words_do_not_trigger_vietnamese_abbreviations():
    s = compute_cha2ds2_vasc(_r("Patient states that the chest pain is better than yesterday."))
    assert s["tong_diem"] == 0


def test_has_bled_detects_english_liver_disease():
    s = compute_has_bled(_r("Cirrhosis. Mechanical mitral valve."), 90)
    assert any("gan" in i["ten"].lower() or "liver" in i["ten"].lower() for i in s["chi_tiet"] if i.get("co"))
