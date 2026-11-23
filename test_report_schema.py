"""normalize_report: malformed AI output must not crash the pipeline, and valid
reports must pass through unchanged."""
import copy
import json
import math
import random

import pytest

import report_merge
from cde.engine import evaluate_v2
from report_schema import normalize_report, to_number
from test_main import MOCK_REPORT


def test_valid_report_is_unchanged_and_idempotent():
    n = normalize_report(copy.deepcopy(MOCK_REPORT))
    # The only change allowed on a valid report: filling in a missing lab display value.
    stripped = copy.deepcopy(n)
    for lab in stripped.get("xet_nghiem_key", []):
        orig = next(x for x in MOCK_REPORT["xet_nghiem_key"] if x.get("key") == lab["key"])
        if "val" not in orig:
            lab.pop("val")
    assert stripped == MOCK_REPORT
    assert normalize_report(n) == n


@pytest.mark.parametrize("raw,expected", [
    (2, 2), (2.5, 2.5), ("2.5 mg/L", 2.5), ("1,5", 1.5), ("EF 44%", 44), ("N/A", None),
    (None, None), (True, None), (float("nan"), None), ([], None),
])
def test_to_number(raw, expected):
    assert to_number(raw) == expected


def test_typical_model_mistakes_are_repaired():
    r = normalize_report({
        "thong_tin_benh_nhan": {"tuoi": "62 tuổi", "gioi_tinh": ["Nam"], "so_benh_an": 25019647},
        "chan_doan_chinh": ["Hẹp van ĐMC", "Suy tim"],
        "xet_nghiem_meta": {"key": "INR", "rawVal": "2,25", "trend": "1.2", "trendDates": "27/09"},
        "sieu_am_tim": {"lan_kham": [{"ngay": "30/09", "ef": "50%"}, "free text echo note", 7]},
        "canh_bao_nguy_co": "INR dao động mạnh",
        "dau_hieu_sinh_ton": {"spo2": "97%", "nhiet_do": None},
        "problem_status": "đang ổn",
        "thuoc_cuoi_ky": [{"ten_thuoc": {"brand": "Vincerol"}, "keo_dai": "true"}],
    })
    assert r["thong_tin_benh_nhan"]["tuoi"] == 62
    assert r["thong_tin_benh_nhan"]["gioi_tinh"] == "Nam"
    assert r["thong_tin_benh_nhan"]["so_benh_an"] == "25019647"
    assert r["chan_doan_chinh"] == "Hẹp van ĐMC; Suy tim"
    assert r["xet_nghiem_meta"] == [{"key": "INR", "rawVal": 2.25, "trend": [1.2], "trendDates": ["27/09"], "val": "2.25"}]
    assert [e.get("ef") for e in r["sieu_am_tim"]["lan_kham"]] == [50, None]
    assert r["sieu_am_tim"]["lan_kham"][1]["ghi_chu"] == "free text echo note"
    assert r["canh_bao_nguy_co"] == [{"mo_ta": "INR dao động mạnh"}]
    assert r["dau_hieu_sinh_ton"]["spo2"] == 97
    assert r["problem_status"] == {"hien_tai": [], "da_qua": []}
    assert r["thuoc_cuoi_ky"][0] == {"ten_thuoc": "brand: Vincerol", "keo_dai": True}


def test_output_is_strict_json():
    r = normalize_report({"xet_nghiem_meta": [{"rawVal": float("nan"), "trend": [float("inf"), 1]}],
                          "sieu_am_tim": {"lan_kham": [{"phase": float("nan")}]}})
    json.dumps(r, allow_nan=False)


def _mutations(report, seed, n):
    weird = [None, "", 0, -1, "abc", [], {}, "N/A", "1,5", "2.5 mg/L", float("nan"), True,
             [None], {"x": 1}, 1e12, [1, "a", {}], {"a": [1]}]
    rnd = random.Random(seed)

    def paths(o, p=()):
        yield p
        if isinstance(o, dict):
            for k, v in o.items():
                yield from paths(v, p + (k,))
        elif isinstance(o, list):
            for i, v in enumerate(o[:8]):
                yield from paths(v, p + (i,))

    all_paths = [p for p in paths(report) if p]
    for _ in range(n):
        r = copy.deepcopy(report)
        for _ in range(rnd.randint(1, 6)):
            p, o = rnd.choice(all_paths), r
            try:
                for k in p[:-1]:
                    o = o[k]
                if rnd.random() < 0.4:
                    del o[p[-1]]          # the model left a field out entirely
                else:
                    o[p[-1]] = copy.deepcopy(rnd.choice(weird))
            except (KeyError, IndexError, TypeError):
                pass
        yield r


def test_rule_engine_and_merge_survive_malformed_reports():
    reports = list(_mutations(MOCK_REPORT, seed=42, n=400))
    for a, b in zip(reports, reversed(reports)):
        evaluate_v2(a)
        merged = normalize_report(report_merge.merge_reports(normalize_report(a), normalize_report(b)))
        evaluate_v2(merged)
        json.dumps(merged, allow_nan=False)


def test_english_male_gets_male_egfr_in_priority_screens():
    # Regression: run_priority_screens checked `"nam" in sex.lower()`, so "Male"
    # was scored as female and could cross the "Suy thận nặng" (eGFR < 30) line.
    from clinical_rules import run_priority_screens
    def screens(sex):
        out = run_priority_screens({"thong_tin_benh_nhan": {"tuoi": 70, "gioi_tinh": sex},
                                    "xet_nghiem_key": [{"key": "Creatinin", "rawVal": 190}]})
        return sorted(str(x) for x in out.values())
    assert screens("Nam") == screens("Male")
    assert screens("Nữ") == screens("Female")


def test_no_sepsis_all_clear_without_measurements():
    from clinical_rules import run_priority_screens
    names = [f["ten"] for f in run_priority_screens({"thong_tin_benh_nhan": {"tuoi": 60}})["findings"]]
    assert "Không dấu hiệu sốc nhiễm khuẩn" not in names
    full = run_priority_screens({"dau_hieu_sinh_ton": {"nhiet_do": 36.8, "lactate": 1.2, "ha_tt": 120, "ha_ttr": 70}})
    assert any(f["ten"] == "Không dấu hiệu sốc nhiễm khuẩn" and "None" not in f["ly_do"] for f in full["findings"])


def test_lab_rows_missing_display_value_or_key_are_completed():
    r = normalize_report({"xet_nghiem_key": [{"rawVal": 2.25, "unit": ""}, {"rawVal": 116, "unit": "g/L", "desc": "Hemoglobin"}]})
    assert r["xet_nghiem_key"][0] == {"rawVal": 2.25, "unit": "", "val": "2.25", "key": "?"}
    assert r["xet_nghiem_key"][1]["val"] == "116 g/L" and r["xet_nghiem_key"][1]["key"] == "Hemoglobin"
