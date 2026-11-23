"""Property-based tests (Hypothesis) for merging a follow-up document into a record.

Instead of a few hand-picked examples, these state rules that must hold for ANY
pair of reports and let Hypothesis search for counterexamples.
"""
import copy
import json

from hypothesis import given, settings, strategies as st, HealthCheck

import report_merge
from clinical_rules import run_priority_screens
from report_schema import normalize_report

text = st.text(alphabet="abcdefghij ", min_size=1, max_size=12).filter(lambda s: s.strip())
date = st.sampled_from(["01/01/2026", "02/02/2026", "03/03/2026"])
lab = st.fixed_dictionaries({"key": st.sampled_from(["INR", "CRP", "Creatinin", "Na+"]),
                             "rawVal": st.floats(0.1, 300, allow_nan=False), "ngay": date})
event = st.fixed_dictionaries({"ngay": date, "mo_ta": text})
echo = st.fixed_dictionaries({"ngay": date, "ef": st.integers(20, 80)})
vitals = st.fixed_dictionaries({"spo2": st.integers(80, 100), "nhip_tho": st.integers(10, 35),
                                "ha_tt": st.integers(70, 180), "lactate": st.floats(0.5, 6, allow_nan=False),
                                "nhiet_do": st.floats(36, 40.5, allow_nan=False)})
action = st.fixed_dictionaries({"uu_tien": st.integers(1, 4), "viec": text})
report = st.fixed_dictionaries({
    "thong_tin_benh_nhan": st.fixed_dictionaries({"so_benh_an": st.just("BA-1"), "ho_ten": text}),
    "chan_doan_chinh": text,
    "xet_nghiem_key": st.lists(lab, max_size=4),
    "dien_bien_lam_sang": st.lists(event, max_size=3),
    "sieu_am_tim": st.fixed_dictionaries({"lan_kham": st.lists(echo, max_size=3)}),
    "dau_hieu_sinh_ton": vitals,
    "hanh_dong_uu_tien": st.lists(action, min_size=1, max_size=3),
    "clinical_takeaway": st.lists(st.fixed_dictionaries({"txt": text, "loai": st.just("watch")}), min_size=1, max_size=2),
    "problem_status": st.fixed_dictionaries({"hien_tai": st.lists(st.fixed_dictionaries({"ten": text}), min_size=1, max_size=2),
                                             "da_qua": st.lists(st.fixed_dictionaries({"ten": text}), max_size=2)}),
})
cfg = settings(max_examples=150, deadline=None, suppress_health_check=list(HealthCheck))
HISTORY_LISTS = ["xet_nghiem_key", "dien_bien_lam_sang"]


@cfg
@given(old=report, new=report)
def test_nothing_from_the_new_document_is_silently_dropped(old, new):
    merged = report_merge.merge_reports(old, new)
    for key, value in new.items():
        if key in HISTORY_LISTS:
            for item in value:
                assert item in merged[key], f"{key}: new item lost"
        elif key == "sieu_am_tim":
            for item in value["lan_kham"]:
                assert item in merged["sieu_am_tim"]["lan_kham"]
        elif key == "thong_tin_benh_nhan":
            for k, v in value.items():
                assert merged[key][k] == v
        elif key == "problem_status":
            assert merged[key]["hien_tai"] == value["hien_tai"]
            for item in value["da_qua"]:
                assert item in merged[key]["da_qua"]
        else:
            assert merged.get(key) == value, f"{key}: still shows the OLD document's value"


@cfg
@given(old=report, new=report)
def test_history_from_the_old_record_is_kept(old, new):
    merged = report_merge.merge_reports(old, new)
    for key in HISTORY_LISTS:
        for item in old[key]:
            assert item in merged[key]
    for item in old["problem_status"]["da_qua"]:
        assert item in merged["problem_status"]["da_qua"]


@cfg
@given(r=report)
def test_merging_the_same_document_twice_changes_nothing(r):
    once = report_merge.merge_reports(r, r)
    assert report_merge.merge_reports(once, r) == once
    for key in HISTORY_LISTS:
        assert once[key] == r[key]   # nothing appended when the document is already in the record


@cfg
@given(r=report)
def test_merging_an_empty_document_loses_nothing(r):
    assert report_merge.merge_reports(r, {}) == r


@cfg
@given(old=report, new=report)
def test_merge_does_not_mutate_inputs(old, new):
    a, b = copy.deepcopy(old), copy.deepcopy(new)
    report_merge.merge_reports(old, new)
    assert (old, new) == (a, b)


def test_critical_vitals_from_a_follow_up_visit_trigger_an_alert():
    old = {"dau_hieu_sinh_ton": {"spo2": 97, "nhip_tho": 16}}
    new = {"dau_hieu_sinh_ton": {"spo2": 85, "nhip_tho": 28}}
    merged = normalize_report(report_merge.merge_reports(old, new))
    names = [f["ten"] for f in run_priority_screens(merged)["findings"]]
    assert "Suy hô hấp" in names
