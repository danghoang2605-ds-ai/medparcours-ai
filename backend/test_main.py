"""
test_main.py — Script test tự động cho backend MedParcours AI.

CHẠY: pytest test_main.py -v
(cần requirements-dev.txt: pip install -r requirements-dev.txt)

THIẾT KẾ: mock call_claude() ở mọi test cần gọi Anthropic API, để:
  1. Không tốn token thật khi chạy CI/test lặp lại nhiều lần.
  2. Test được nhanh, không phụ thuộc mạng/rate limit.
  3. Tách rõ "test logic pipeline" (ở đây) khỏi "test chất lượng output LLM"
     (không tự động hóa được, cần Tấn/Ngân đọc thật).
"""
import os
import json
import io
from unittest.mock import patch, MagicMock

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-real")

import pytest
import anthropic
from fastapi.testclient import TestClient

import main


# ─── FIXTURE: mock Claude trả JSON report hợp lệ ─────────────────────────────
MOCK_REPORT = {
    "thong_tin_benh_nhan": {
        "ho_ten": "NGUYEN VAN TEST", "tuoi": 62, "gioi_tinh": "Nam",
        "so_benh_an": "TEST-001",
        "ngay_vao_vien": "24/09/2025", "ngay_ra_vien": "03/10/2025",
    },
    "chan_doan_chinh": "Sau PT thay van DMC co hoc On-X. Rung nhi. Tang huyet ap.",
    "tien_su_benh": "Khong ghi nhan dai thao duong.",
    "phau_thuat": {"ngay": "26/09/2025", "phuong_phap": "Thay van DMC co hoc On-X"},
    "sieu_am_tim": {"lan_kham": [{"ngay": "30/09/2025", "ef": 58}]},
    "dau_hieu_sinh_ton": {"ha_tt": 120, "ha_ttr": 70, "nhip_tho": 18, "spo2": 97},
    "xet_nghiem_key": [
        {"key": "Creatinin", "rawVal": 77, "trend": [74, 77, 77],
         "trendDates": ["27/09/2025", "29/09/2025", "03/10/2025"], "unit": "umol/L"},
        {"key": "INR", "rawVal": 2.25, "trend": [1.24, 5.97, 2.25],
         "trendDates": ["26/09/2025", "29/09/2025", "03/10/2025"], "unit": ""},
    ],
    "thuoc_cuoi_ky": [{"ten_thuoc": "Vincerol 1mg (Acenocoumarol)"}],
}


def _fake_claude_response(text: str, in_tok=8000, out_tok=200):
    fake_resp = MagicMock()
    fake_resp.content = [MagicMock(text=text)]
    fake_resp.usage.input_tokens = in_tok
    fake_resp.usage.output_tokens = out_tok
    return fake_resp


@pytest.fixture
def mock_anthropic():
    """Mock Anthropic.messages.create — nhận diện Bước 1 (REPORT_SYSTEM) vs
    Bước 3 (TREND_SYSTEM) vs /chat (CHAT_SYSTEM) DỰA VÀO NỘI DUNG system prompt
    thay vì đếm thứ tự gọi tuyệt đối — để test gọi /analyze_text NHIỀU LẦN
    (vd test_idempotent) vẫn luôn trả đúng JSON report ở mỗi lần, không lệch
    theo bộ đếm toàn cục."""
    call_log = []

    def fake_create(**kwargs):
        call_log.append(kwargs)
        system = kwargs.get("system")
        system_text = system[0]["text"] if isinstance(system, list) else (system or "")
        if "báo cáo JSON có cấu trúc" in system_text:
            # Bước 1: REPORT_SYSTEM yêu cầu trả JSON report
            return _fake_claude_response(json.dumps(MOCK_REPORT, ensure_ascii=False))
        return _fake_claude_response("Ket qua phan tich xu huong (mock).")

    with patch.object(anthropic.Anthropic, "messages", create=True) as m:
        m.create = fake_create
        yield call_log


@pytest.fixture
def client():
    return TestClient(main.app)


# ─── 1. /health ───────────────────────────────────────────────────────────
def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "service" in data
    assert data["status"] == "ok"


# ─── 2. /analyze_text — pipeline đầy đủ ──────────────────────────────────
def test_analyze_text_success(client, mock_anthropic):
    resp = client.post("/analyze_text", json={
        "ho_so_text": "Noi dung benh an test du dai de vuot nguong toi thieu " * 10,
        "pages": 1,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "thong_tin_benh_nhan" in data["report"]
    assert "xet_nghiem_key" in data["report"]


def test_analyze_text_trend_matched_length(client, mock_anthropic):
    """LUẬT 26 (đã có từ trước): nếu có nhiều lần đo, trend & trendDates phải
    cùng độ dài — kiểm tra MOCK_REPORT (fixture) tự thỏa điều kiện này, để
    phát hiện sớm nếu ai sửa fixture mà quên giữ tính nhất quán."""
    resp = client.post("/analyze_text", json={
        "ho_so_text": "Noi dung benh an test du dai de vuot nguong toi thieu " * 10,
        "pages": 1,
    })
    data = resp.json()
    for lab in data["report"]["xet_nghiem_key"]:
        if lab.get("trend") and lab.get("trendDates"):
            assert len(lab["trend"]) == len(lab["trendDates"]), \
                f"Lab {lab['key']}: trend va trendDates khong cung do dai"


def test_analyze_text_too_short_returns_422(client, mock_anthropic):
    """Hồ sơ quá ngắn (dưới MIN_TOTAL_CHARS) phải bị chặn rõ ràng, KHÔNG gọi
    Claude lãng phí token cho nội dung không đủ phân tích."""
    resp = client.post("/analyze_text", json={"ho_so_text": "qua ngan", "pages": 1})
    assert resp.status_code == 422
    assert resp.json()["success"] is False


# ─── 3. risk_scores (CHA2DS2-VASc/HAS-BLED) qua pipeline đầy đủ ──────────
def test_risk_scores_present_and_consistent(client, mock_anthropic):
    resp = client.post("/analyze_text", json={
        "ho_so_text": "Noi dung benh an test du dai de vuot nguong toi thieu " * 10,
        "pages": 1,
    })
    rs = resp.json()["analysis"]["risk_scores"]
    assert "cha2ds2_vasc" in rs and "has_bled" in rs
    cv = rs["cha2ds2_vasc"]
    assert 0 <= cv["tong_diem"] <= cv["thang_diem_toi_da"]
    # Ca mẫu có van cơ học -> phải có cảnh báo bối cảnh
    assert cv["mechanical_valve"] is True
    assert "VAN CƠ HỌC" in cv["canh_bao_boi_canh"] or "van co hoc" in cv["canh_bao_boi_canh"].lower()


def test_risk_scores_negation_not_false_positive(client, mock_anthropic):
    """Hồi quy: 'không ghi nhận đái tháo đường' KHÔNG được tính là có ĐTĐ.
    Đây là lỗi thật đã phát hiện và sửa trong quá trình phát triển — giữ test
    này để không bị quay lại lỗi cũ nếu có ai sửa _text_has_any_positive sai."""
    resp = client.post("/analyze_text", json={
        "ho_so_text": "Noi dung benh an test du dai de vuot nguong toi thieu " * 10,
        "pages": 1,
    })
    cv = resp.json()["analysis"]["risk_scores"]["cha2ds2_vasc"]
    dtd_item = next(it for it in cv["chi_tiet"] if "Đái tháo đường" in it["ten"])
    assert dtd_item["co"] is False


# ─── 4. TTR ────────────────────────────────────────────────────────────────
def test_ttr_present_when_inr_trend_exists(client, mock_anthropic):
    resp = client.post("/analyze_text", json={
        "ho_so_text": "Noi dung benh an test du dai de vuot nguong toi thieu " * 10,
        "pages": 1,
    })
    ttr = resp.json()["analysis"]["ttr"]
    assert ttr is not None
    assert 0 <= ttr["ttr_percent"] <= 100
    assert ttr["so_lan_do"] == 3  # MOCK_REPORT có 3 lần đo INR


# ─── 5. care_gaps ──────────────────────────────────────────────────────────
def test_care_gaps_is_list(client, mock_anthropic):
    resp = client.post("/analyze_text", json={
        "ho_so_text": "Noi dung benh an test du dai de vuot nguong toi thieu " * 10,
        "pages": 1,
    })
    gaps = resp.json()["analysis"]["care_gaps"]
    assert isinstance(gaps, list)
    for g in gaps:
        assert g["muc_do"] in ("cao", "trung_binh", "thap")
        assert "tieu_de" in g and "ly_do" in g


# ─── 6. drug_safety (interactions, renal_flags, duplicate_groups) ────────
def test_drug_safety_duplicate_groups(client, mock_anthropic):
    """Test riêng qua clinical_rules trực tiếp (không qua HTTP) để kiểm soát
    chính xác input — 2 chẹn beta khác hoạt chất phải bị gắn cờ trùng nhóm."""
    import clinical_rules as cr
    result = cr.check_drug_safety(
        drugs=[{"ten_thuoc": "Concor (Bisoprolol)"}, {"ten_thuoc": "Betaloc (Metoprolol)"}],
        egfr=80, context={},
    )
    assert len(result["duplicate_groups"]) == 1
    dg = result["duplicate_groups"][0]
    assert dg["nhom"] == "chen_beta"


# ─── 7. /ecg/synthetic + /ecg ─────────────────────────────────────────────
def test_ecg_synthetic(client):
    resp = client.get("/ecg/synthetic")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["columns_with_signal"] > data["width"] * 0.9  # ảnh sạch tự sinh phải đọc được >90%
    assert data["is_synthetic"] is True
    assert "tổng hợp" in data["disclaimer"].lower() or "giả" in data["disclaimer"].lower()


def test_ecg_synthetic_heart_rate_mức_2(client):
    """Mức 2: pipeline calibration + R-peaks + heart rate phải tính ra đúng
    (sai số nhỏ, do làm tròn số nhịp) cho nhịp tim mục tiêu đã mô phỏng."""
    resp = client.get("/ecg/synthetic?heart_rate_bpm=100")
    data = resp.json()
    assert resp.status_code == 200
    assert data["calibration"]["px_per_mm"] is not None
    assert data["calibration"]["do_tin_cay"] == "cao"
    assert data["heart_rate"]["bpm_avg"] is not None
    assert abs(data["heart_rate"]["bpm_avg"] - 100) < 5  # sai số làm tròn n_beats
    assert data["heart_rate"]["uoc_luong"] is True


def test_ecg_invalid_base64_returns_400(client):
    resp = client.post("/ecg", json={"image_base64": "khong-phai-base64-hop-le"})
    assert resp.status_code == 400


# ─── 8. /chat ──────────────────────────────────────────────────────────────
def test_chat_success(client, mock_anthropic):
    resp = client.post("/chat", json={
        "question": "Bệnh nhân có biến chứng gì?",
        "ho_so_text": json.dumps(MOCK_REPORT, ensure_ascii=False),
        "chat_history": [],
    })
    assert resp.status_code == 200
    assert "answer" in resp.json()


# ─── 9. /analyze — đa định dạng (PDF/Word/Excel/PowerPoint) ──────────────
def test_analyze_docx_success(client, mock_anthropic):
    from docx import Document
    doc = Document()
    doc.add_paragraph(
        "Benh nhan test upload qua file Word, can du dai de vuot qua nguong toi "
        "thieu cua he thong phan tich benh an. Chan doan: rung nhi, tang huyet ap, "
        "suy tim. Tien su: da dat stent dong mach vanh nam 2024. Hien dang dieu tri "
        "chong dong duong INR muc tieu 2.0 den 3.0."
    )
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    resp = client.post("/analyze", files={
        "file": ("test.docx", buf, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    })
    assert resp.status_code == 200
    assert resp.json()["success"] is True


def test_analyze_image_not_yet_supported(client):
    """Ảnh (.png/.jpg) chưa hỗ trợ OCR — phải trả lỗi RÕ NGHĨA, không phải
    lỗi server chung 'Chỉ chấp nhận PDF' (bug đã phát hiện và sửa)."""
    resp = client.post("/analyze", files={
        "file": ("anh.jpg", io.BytesIO(b"fake-jpg-bytes"), "image/jpeg")
    })
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "OCR" in detail or "ocr" in detail.lower()


def test_analyze_corrupt_docx_returns_400_not_500(client):
    """File .docx giả (bytes rác) phải trả 400 rõ nghĩa, KHÔNG crash 500."""
    resp = client.post("/analyze", files={
        "file": ("fake.docx", io.BytesIO(b"day khong phai file docx thuc"),
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    })
    assert resp.status_code == 400


# ─── 10. Idempotent: chạy nhiều lần liên tiếp không lỗi ──────────────────
def test_idempotent_three_runs(client, mock_anthropic):
    for _ in range(3):
        resp = client.post("/analyze_text", json={
            "ho_so_text": "Noi dung benh an test du dai de vuot nguong toi thieu " * 10,
            "pages": 1,
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True
