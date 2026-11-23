"""Normalize an AI-extracted report to the shapes the rule engine and UI expect.

The model usually follows the JSON schema in REPORT_SYSTEM, but not always:
a number may come back as "2.5 mg/L", a list as a single string, an object as
null. Every downstream consumer assumed the happy path, so one odd value used
to crash the whole analysis (HTTP 500) after the API call was already paid for.

normalize_report() is pure and idempotent: valid reports pass through unchanged.
"""
from __future__ import annotations

import math
import re

# Fields whose values are numbers (or None when missing/unreadable).
NUMERIC = {
    "rawVal", "ef", "grad_max", "grad_tb", "crp", "wbc", "so_luong", "vien_moi_ngay", "uu_tien",
    "tuoi", "ha_tt", "ha_ttr", "mach", "nhiet_do", "nhip_tho", "spo2", "lactate",
}
BOOLEAN = {"canh_bao", "latest", "keo_dai"}
SCALAR_ANY = {"phase", "id"}          # number or string are both legitimate
NUM_LIST = {"trend"}
STR_LIST = {"trendDates"}

# Top-level layout.
TEXT_FIELDS = ("chan_doan_chinh", "ly_do_vao_vien", "tien_su_benh", "tom_tat_toan_canh")
DICT_FIELDS = ("thong_tin_benh_nhan", "phau_thuat", "dau_hieu_sinh_ton", "xet_nghiem_truoc_mo",
               "ket_luan_giai_doan")
LIST_OF_DICTS = ("dien_bien_lam_sang", "vital_signs", "xet_nghiem_meta", "xet_nghiem_key",
                 "canh_bao_nguy_co", "clinical_takeaway", "ly_luan_lam_sang", "hanh_dong_uu_tien",
                 "thuoc_cuoi_ky")

_NUM_RE = re.compile(r"[-+]?\d+(?:[.,]\d+)?")


def to_number(v):
    """2 -> 2, "2.5 mg/L" -> 2.5, "1,5" -> 1.5, junk -> None."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v if math.isfinite(v) else None
    if isinstance(v, str):
        m = _NUM_RE.search(v)
        if not m:
            return None
        n = float(m.group(0).replace(",", "."))
        return int(n) if n.is_integer() and "." not in m.group(0) and "," not in m.group(0) else n
    return None


def to_text(v):
    """Scalar -> str; None stays None; lists/dicts are flattened to readable text."""
    if v is None or isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, (int, float)):
        return "" if isinstance(v, float) and not math.isfinite(v) else str(v)
    if isinstance(v, list):
        return "; ".join(t for t in (to_text(x) for x in v) if t)
    if isinstance(v, dict):
        return "; ".join(f"{k}: {t}" for k, t in ((k, to_text(x)) for k, x in v.items()) if t)
    return str(v)


def _value(key, v):
    if key in NUMERIC:
        return to_number(v)
    if key in BOOLEAN:
        return v if isinstance(v, bool) else bool(v) if isinstance(v, (int, float)) else str(v).strip().lower() in {"true", "1", "yes", "co", "có"}
    if key in NUM_LIST:
        items = v if isinstance(v, list) else [v]
        return [n for n in (to_number(x) for x in items) if n is not None]
    if key in STR_LIST:
        items = v if isinstance(v, list) else ([] if v is None else [v])
        return [to_text(x) for x in items if x is not None]
    if key in SCALAR_ANY:
        if isinstance(v, str) or (isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)):
            return v
        return to_text(v)
    # Inside a record item every other field is plain text (nested data is flattened).
    return to_text(v)


def _dict(v):
    return {str(k): _value(str(k), x) for k, x in v.items()} if isinstance(v, dict) else {}


def _list_of_dicts(v, text_key="mo_ta"):
    if isinstance(v, dict):
        v = [v]
    if not isinstance(v, list):
        v = [] if v in (None, "") else [v]
    out = []
    for item in v:
        if isinstance(item, dict):
            out.append(_dict(item))
        elif isinstance(item, str) and item.strip():
            out.append({text_key: item})       # keep the content rather than drop it
    return out


def normalize_report(report) -> dict:
    if not isinstance(report, dict):
        return {}
    r = dict(report)
    for k in TEXT_FIELDS:
        if k in r:
            r[k] = to_text(r[k]) or ""
    for k in DICT_FIELDS:
        if k in r:
            r[k] = _dict(r[k])
    text_keys = {"clinical_takeaway": "txt", "hanh_dong_uu_tien": "viec", "thuoc_cuoi_ky": "ten_thuoc",
                 "ly_luan_lam_sang": "noi_dung"}
    for k in LIST_OF_DICTS:
        if k in r:
            r[k] = _list_of_dicts(r[k], text_keys.get(k, "mo_ta"))
    if "sieu_am_tim" in r:
        raw = r["sieu_am_tim"] if isinstance(r["sieu_am_tim"], dict) else {}
        sa = _dict({k: v for k, v in raw.items() if k != "lan_kham"})
        sa["lan_kham"] = _list_of_dicts(raw.get("lan_kham"), "ghi_chu")
        r["sieu_am_tim"] = sa
    if "problem_status" in r:
        ps = r["problem_status"] if isinstance(r["problem_status"], dict) else {}
        r["problem_status"] = {k: _list_of_dicts(ps.get(k), "ten") for k in ("hien_tai", "da_qua")}
    info = r.get("thong_tin_benh_nhan")
    if isinstance(info, dict) and info.get("so_benh_an") is not None:
        info["so_benh_an"] = to_text(info["so_benh_an"]).strip()
    return r
