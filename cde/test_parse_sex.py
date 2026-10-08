"""Sex parsing must work for Vietnamese and English records (affects eGFR and CHA2DS2-VASc)."""
import pytest
from clinical_rules import parse_sex, compute_cha2ds2_vasc, compute_egfr
from cde.engine import evaluate_v2


@pytest.mark.parametrize("raw,expected", [
    ("Nam", "male"), ("nam giới", "male"), ("Male", "male"), ("M", "male"),
    ("Nữ", "female"), ("nữ giới", "female"), ("Female", "female"), ("F", "female"),
    ("", None), (None, None), ("Không rõ", None), ("unknown", None),
])
def test_parse_sex(raw, expected):
    assert parse_sex(raw) == expected


def test_female_is_not_read_as_male():
    # Regression: the old check `"nam" in sex.lower()` and `/nam/i` never matched
    # "Male", so English records were treated as female.
    assert parse_sex("Female") == "female"
    assert parse_sex("Male") == "male"


def _report(sex):
    return {"thong_tin_benh_nhan": {"tuoi": 62, "gioi_tinh": sex},
            "xet_nghiem_key": [{"key": "Creatinin", "rawVal": 90}]}


def test_egfr_identical_for_vietnamese_and_english_sex_labels():
    assert evaluate_v2(_report("Nam"))["egfr"] == evaluate_v2(_report("Male"))["egfr"]
    assert evaluate_v2(_report("Nữ"))["egfr"] == evaluate_v2(_report("Female"))["egfr"]
    assert evaluate_v2(_report("Male"))["egfr"] == compute_egfr(90, 62, True)


def test_cha2ds2vasc_sex_point_for_english_female():
    vi = compute_cha2ds2_vasc(_report("Nữ"))
    en = compute_cha2ds2_vasc(_report("Female"))
    assert vi["tong_diem"] == en["tong_diem"] == 1
    assert compute_cha2ds2_vasc(_report("Male"))["tong_diem"] == 0
