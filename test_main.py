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
import base64
import cv2
import numpy as np
from unittest.mock import patch, MagicMock

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-real")

import pytest


def _valid_png_b64():
    """Tạo 1 ảnh PNG hợp lệ tối thiểu (không dùng chuỗi hex cứng — lần trước
    dính lỗi copy làm hỏng IDAT chunk, libpng từ chối đọc)."""
    img = np.ones((30, 100, 3), dtype=np.uint8) * 255
    ok, buf = cv2.imencode(".png", img)
    return base64.b64encode(buf.tobytes()).decode()


def _valid_png_b64_bytes():
    """Như trên nhưng trả bytes thô (cho multipart file upload, không phải
    JSON body base64)."""
    img = np.ones((30, 100, 3), dtype=np.uint8) * 255
    ok, buf = cv2.imencode(".png", img)
    return buf.tobytes()
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


def test_ecg_lead_name_mac_dinh_la_II(client):
    """Không gửi lead_name -> mặc định 'II' (chuyển đạo chuẩn cho dải nhịp
    theo quy ước lâm sàng), không phải suy đoán tùy tiện."""
    b64 = _valid_png_b64()
    resp = client.post("/ecg", json={"image_base64": b64})
    assert resp.status_code == 200
    assert resp.json()["lead_name"] == "II"


def test_ecg_lead_name_hop_le_duoc_giu_nguyen(client):
    b64 = _valid_png_b64()
    resp = client.post("/ecg", json={"image_base64": b64, "lead_name": "V3"})
    assert resp.status_code == 200
    assert resp.json()["lead_name"] == "V3"
    assert "V3" in resp.json()["permanent_disclaimer"]


def test_ecg_lead_name_rac_roi_ve_mac_dinh(client):
    """Giá trị lead_name không nằm trong 12 chuyển đạo chuẩn -> tự rơi về
    'II', không để lộ chuỗi rác ra disclaimer/báo cáo."""
    b64 = _valid_png_b64()
    resp = client.post("/ecg", json={"image_base64": b64, "lead_name": "<script>xss</script>"})
    assert resp.status_code == 200
    assert resp.json()["lead_name"] == "II"


def test_ecg_lead_khong_khuyen_nghi_co_redflag(client):
    """Chọn chuyển đạo không khuyến nghị cho dải nhịp (vd aVR) -> phải có
    redflag cảnh báo rõ, không âm thầm trả số liệu như bình thường."""
    b64 = _valid_png_b64()
    resp = client.post("/ecg", json={"image_base64": b64, "lead_name": "aVR"})
    assert resp.status_code == 200
    redflags = resp.json()["redflags"]
    assert any("aVR" in r for r in redflags)


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


def test_analyze_image_now_supported_via_claude_vision(client, mock_anthropic):
    """Ảnh (.png/.jpg) GIỜ ĐÃ ĐƯỢC XỬ LÝ qua Claude Vision (giải pháp tạm thời,
    chờ VNPT SmartReader) — không còn báo lỗi "đang phát triển" như trước.
    Pipeline Bước 2-3 vẫn chạy bình thường qua engine v2 (mock LLM nên không
    tốn token thật khi test)."""
    resp = client.post("/analyze", files={
        "file": ("anh_benh_an.jpg", io.BytesIO(b"fake-jpg-bytes-for-test"), "image/jpeg")
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["meta"]["method"] == "image-vision-ocr"
    assert "canh_bao_chat_luong" in data["meta"]
    assert "active_profiles" in data["analysis"]


def test_analyze_image_too_large_returns_413(client):
    """Ảnh vượt giới hạn MAX_IMAGE_BYTES phải báo lỗi rõ nghĩa — không cần
    mock Claude vì bị chặn trước khi gọi API."""
    big_fake_image = b"\xff" * (9 * 1024 * 1024)  # 9MB > giới hạn 8MB
    resp = client.post("/analyze", files={
        "file": ("anh_qua_lon.jpg", io.BytesIO(big_fake_image), "image/jpeg")
    })
    assert resp.status_code == 413


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


# ─── 11. "Động cơ kép" VNPT — fallback Claude khi VNPT lỗi/chưa cấu hình ──
# Môi trường test KHÔNG có VNPT_TOKEN_ID/KEY/ACCESS_TOKEN -> VNPTClient()
# luôn raise VNPTAPIError ngay khi khởi tạo -> luôn rơi về Claude. Test này
# xác nhận đúng hành vi "AN TOÀN" đó, và lỗi VNPT không lộ ra response.
def test_chat_roi_ve_claude_khi_vnpt_chua_cau_hinh(client, mock_anthropic, monkeypatch):
    for k in ("VNPT_TOKEN_ID", "VNPT_TOKEN_KEY", "VNPT_ACCESS_TOKEN"):
        monkeypatch.delenv(k, raising=False)
    resp = client.post("/chat", json={
        "question": "Bệnh nhân có dùng thuốc chống đông không?",
        "ho_so_text": "Hồ sơ test: bệnh nhân dùng Acenocoumarol.",
        "chat_history": [],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "answer" in data
    assert "loi" not in data and "error" not in data  # không lộ lỗi VNPT ra response


def test_analyze_anh_roi_ve_claude_vision_khi_vnpt_chua_cau_hinh(client, mock_anthropic, monkeypatch):
    """Upload ảnh (PNG) qua /analyze — VNPT chưa cấu hình nên phải tự rơi về
    Claude Vision (call_claude_with_image), KHÔNG trả lỗi 500 ra frontend."""
    for k in ("VNPT_TOKEN_ID", "VNPT_TOKEN_KEY", "VNPT_ACCESS_TOKEN"):
        monkeypatch.delenv(k, raising=False)
    # Ảnh PNG 1x1 hợp lệ tối thiểu (đủ để qua bước decode ảnh của thư viện)
    png_1x1 = base64.b64decode(_valid_png_b64())
    resp = client.post("/analyze", files={
        "file": ("scan.png", io.BytesIO(png_1x1), "image/png")
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True  # dùng mock_anthropic Claude Vision path, không sập


# ─── 12. FAQ Bot & SmartVoice — luồng fallback an toàn ────────────────────
def test_faq_bot_fallback_khi_thieu_bot_id(client, monkeypatch):
    """Chưa có VNPT_FAQ_BOT_ID -> phải trả đúng câu bảo trì, KHÔNG lỗi 500."""
    monkeypatch.delenv("VNPT_FAQ_BOT_ID", raising=False)
    resp = client.post("/faq-bot", json={"question": "MedParcours là gì?"})
    assert resp.status_code == 200
    assert "bảo trì" in resp.json()["text"]


def test_faq_bot_thanh_cong_khi_co_du_cau_hinh(client, monkeypatch):
    """Mock requests.post trả đúng cấu trúc card_data thật (theo docx) -> lấy
    đúng text từ card loại 'text'."""
    monkeypatch.setenv("VNPT_TOKEN_ID", "tid")
    monkeypatch.setenv("VNPT_TOKEN_KEY", "tkey")
    monkeypatch.setenv("VNPT_ACCESS_TOKEN", "tok")
    monkeypatch.setenv("VNPT_FAQ_BOT_ID", "bot-abc-123")
    fake_resp = MagicMock()
    fake_resp.raise_for_status = lambda: None
    fake_resp.json.return_value = {
        "object": {"sb": {"card_data": [
            {"type": "text", "text": "MedParcours là trợ lý AI hỗ trợ đọc hồ sơ bệnh án."}
        ]}}
    }
    with patch("vnpt_client.requests.post", return_value=fake_resp):
        resp = client.post("/faq-bot", json={"question": "MedParcours là gì?"})
    assert resp.status_code == 200
    assert "trợ lý AI" in resp.json()["text"]


def test_voice_tts_fallback_dung_local_tts(client):
    """SmartVoice TTS chưa triển khai -> luôn trả use_local_tts=true."""
    resp = client.post("/voice/tts", json={"text": "Cảnh báo điện cực tuột"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert data["use_local_tts"] is True


def test_voice_stt_fallback_error_code(client):
    """SmartVoice STT chưa triển khai -> đúng error_code STT_FALLBACK, không sập."""
    resp = client.post("/voice/stt", files={
        "file": ("ghi_am.wav", io.BytesIO(b"fake-audio-bytes"), "audio/wav")
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert data["error_code"] == "STT_FALLBACK"
    assert data["text"] == ""


# ─── eKYC (OCR CCCD + face liveness) ──────────────────────────────────────
def test_ekyc_ocr_cccd_thanh_cong(client, monkeypatch):
    monkeypatch.setenv("VNPT_TOKEN_ID", "tid")
    monkeypatch.setenv("VNPT_TOKEN_KEY", "tkey")
    monkeypatch.setenv("VNPT_ACCESS_TOKEN", "tok")
    with patch("vnpt_client.VNPTClient.ocr_id_card", return_value={"id": "001099012345", "name": "NGUYEN VAN A"}):
        resp = client.post("/ekyc/ocr-cccd", files={"file_front": ("cccd.jpg", _valid_png_b64_bytes(), "image/jpeg")})
    assert resp.status_code == 200
    assert resp.json()["data"]["name"] == "NGUYEN VAN A"


def test_ekyc_ocr_cccd_loi_tra_502_khong_bia_du_lieu(client):
    """Khác TTS/STT — lỗi eKYC KHÔNG được âm thầm fallback giả thành công,
    phải báo lỗi rõ ràng cho bác sĩ."""
    with patch("vnpt_client.VNPTClient.ocr_id_card", side_effect=RuntimeError("VNPT timeout")):
        resp = client.post("/ekyc/ocr-cccd", files={"file_front": ("cccd.jpg", _valid_png_b64_bytes(), "image/jpeg")})
    assert resp.status_code == 502


def test_ekyc_face_liveness_thanh_cong(client, monkeypatch):
    monkeypatch.setenv("VNPT_TOKEN_ID", "tid")
    monkeypatch.setenv("VNPT_TOKEN_KEY", "tkey")
    monkeypatch.setenv("VNPT_ACCESS_TOKEN", "tok")
    with patch("vnpt_client.VNPTClient.face_liveness", return_value={"liveness": "success", "liveness_msg": "Người thật", "is_real": True}):
        resp = client.post("/ekyc/face-liveness", files={"file": ("face.jpg", _valid_png_b64_bytes(), "image/jpeg")})
    assert resp.status_code == 200
    assert resp.json()["is_real"] is True


def test_ekyc_face_liveness_loi_vnpt_tra_ve_demo_fallback(client):
    """Quyết định TẠM THỜI cho demo: nếu API thật lỗi (400/timeout...),
    KHÔNG chặn — tự báo thành công kèm cờ demo_fallback=True để frontend
    biết rõ đây không phải xác thực thật."""
    with patch("vnpt_client.VNPTClient.face_liveness", side_effect=RuntimeError("VNPT timeout")):
        resp = client.post("/ekyc/face-liveness", files={"file": ("face.jpg", _valid_png_b64_bytes(), "image/jpeg")})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["demo_fallback"] is True
    assert data["is_real"] is True


# ─── Tóm tắt hội chẩn bằng giọng nói (VNPT + Claude fallback) ─────────────
def test_consultation_summarize_vnpt_thanh_cong(client, monkeypatch):
    monkeypatch.setenv("VNPT_TOKEN_ID", "tid")
    monkeypatch.setenv("VNPT_TOKEN_KEY", "tkey")
    monkeypatch.setenv("VNPT_ACCESS_TOKEN", "tok")
    with patch("vnpt_client.VNPTClient.summarize_meeting_audio", return_value="Tóm tắt: bệnh nhân ổn định."):
        resp = client.post("/consultation/summarize-audio", files={"file": ("meeting.wav", _valid_png_b64_bytes(), "audio/wav")})
    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "VNPT_AI"
    assert "ổn định" in data["summary_raw"]


def test_consultation_summarize_fallback_claude_tu_transcript_that(client, monkeypatch):
    """LUẬT FALLBACK THÉP: khi VNPT lỗi, phải chuyển ĐÚNG transcript thật
    (từ STT) sang Claude tóm tắt — không được bịa nội dung không liên quan
    cuộc họp thật."""
    monkeypatch.setenv("VNPT_TOKEN_ID", "tid")
    monkeypatch.setenv("VNPT_TOKEN_KEY", "tkey")
    monkeypatch.setenv("VNPT_ACCESS_TOKEN", "tok")
    fake_claude_json = json.dumps({
        "tom_tat_ca_benh": "Bệnh nhân sau mổ thay van, ổn định",
        "y_kien_hoi_chan": ["Khoa Tim mạch đề nghị tiếp tục theo dõi INR"],
        "huong_xu_tri": ["Tái khám sau 1 tuần"],
    }, ensure_ascii=False)
    with patch("vnpt_client.VNPTClient.summarize_meeting_audio", side_effect=RuntimeError("VNPT lỗi")), \
         patch("vnpt_client.VNPTClient.speech_to_text", return_value="bệnh nhân sau mổ thay van ổn định cần theo dõi INR") as mock_stt, \
         patch("main.call_claude", return_value=fake_claude_json):
        resp = client.post("/consultation/summarize-audio", files={"file": ("meeting.wav", _valid_png_b64_bytes(), "audio/wav")})
    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "CLAUDE_FALLBACK"
    assert data["transcript"] == "bệnh nhân sau mổ thay van ổn định cần theo dõi INR"
    assert data["summary"]["tom_tat_ca_benh"] == "Bệnh nhân sau mổ thay van, ổn định"
    mock_stt.assert_called_once()


def test_consultation_summarize_ca_2_buoc_deu_loi_tra_502(client, monkeypatch):
    """Nếu CẢ VNPT lẫn STT dự phòng đều lỗi -> báo lỗi rõ ràng, TUYỆT ĐỐI
    không bịa nội dung tóm tắt giả."""
    monkeypatch.setenv("VNPT_TOKEN_ID", "tid")
    monkeypatch.setenv("VNPT_TOKEN_KEY", "tkey")
    monkeypatch.setenv("VNPT_ACCESS_TOKEN", "tok")
    with patch("vnpt_client.VNPTClient.summarize_meeting_audio", side_effect=RuntimeError("VNPT lỗi")), \
         patch("vnpt_client.VNPTClient.speech_to_text", side_effect=RuntimeError("STT cũng lỗi")):
        resp = client.post("/consultation/summarize-audio", files={"file": ("meeting.wav", _valid_png_b64_bytes(), "audio/wav")})
    assert resp.status_code == 502


def test_ekyc_ocr_khong_bi_chan_khi_the_khong_that_chi_canh_bao(client, monkeypatch):
    """Bug thật đã sửa: card_liveness báo SAI (false positive) trên ảnh
    thật hợp lệ khi test thực tế -> đổi từ chặn cứng sang CHỈ cảnh báo,
    OCR vẫn chạy tiếp bình thường."""
    monkeypatch.setenv("VNPT_TOKEN_ID", "tid")
    monkeypatch.setenv("VNPT_TOKEN_KEY", "tkey")
    monkeypatch.setenv("VNPT_ACCESS_TOKEN", "tok")
    with patch("vnpt_client.VNPTClient.card_liveness", return_value={"is_real": False, "liveness_msg": "Nghi ngờ ảnh chụp lại"}), \
         patch("vnpt_client.VNPTClient.ocr_id_card", return_value={"id": "001099012345", "name": "NGUYEN VAN A"}):
        resp = client.post("/ekyc/ocr-cccd", files={"file_front": ("cccd.jpg", _valid_png_b64_bytes(), "image/jpeg")})
    assert resp.status_code == 200
    data = resp.json()
    assert data["data"]["name"] == "NGUYEN VAN A"
    assert data["card_warning"] == "Nghi ngờ ảnh chụp lại"


def test_ekyc_ocr_van_chay_khi_card_liveness_loi_ky_thuat(client, monkeypatch):
    """Nếu chính API card_liveness lỗi kỹ thuật (mất mạng) -> KHÔNG chặn
    bác sĩ hợp lệ, vẫn cho OCR tiếp tục."""
    monkeypatch.setenv("VNPT_TOKEN_ID", "tid")
    monkeypatch.setenv("VNPT_TOKEN_KEY", "tkey")
    monkeypatch.setenv("VNPT_ACCESS_TOKEN", "tok")
    with patch("vnpt_client.VNPTClient.card_liveness", side_effect=RuntimeError("mat mang")), \
         patch("vnpt_client.VNPTClient.ocr_id_card", return_value={"id": "001099012345", "name": "NGUYEN VAN A"}):
        resp = client.post("/ekyc/ocr-cccd", files={"file_front": ("cccd.jpg", _valid_png_b64_bytes(), "image/jpeg")})
    assert resp.status_code == 200


def test_ekyc_face_compare_khop_thanh_cong(client, monkeypatch):
    monkeypatch.setenv("VNPT_TOKEN_ID", "tid")
    monkeypatch.setenv("VNPT_TOKEN_KEY", "tkey")
    monkeypatch.setenv("VNPT_ACCESS_TOKEN", "tok")
    with patch("vnpt_client.VNPTClient.face_compare", return_value={"msg": "MATCH", "is_match": True}):
        resp = client.post("/ekyc/face-compare", files={
            "file_cccd": ("cccd.jpg", _valid_png_b64_bytes(), "image/jpeg"),
            "file_face": ("face.jpg", _valid_png_b64_bytes(), "image/jpeg"),
        })
    assert resp.status_code == 200
    assert resp.json()["is_match"] is True


def test_ekyc_face_compare_loi_tra_502(client):
    with patch("vnpt_client.VNPTClient.face_compare", side_effect=RuntimeError("VNPT loi")):
        resp = client.post("/ekyc/face-compare", files={
            "file_cccd": ("cccd.jpg", _valid_png_b64_bytes(), "image/jpeg"),
            "file_face": ("face.jpg", _valid_png_b64_bytes(), "image/jpeg"),
        })
    assert resp.status_code == 502
