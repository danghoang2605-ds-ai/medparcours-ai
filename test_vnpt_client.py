"""
test_vnpt_client.py — Test vnpt_client.py bằng mock requests (KHÔNG gọi API
VNPT thật, không cần token thật) — đúng nguyên tắc "test không phụ thuộc
dịch vụ ngoài, không cần mạng" đã áp dụng xuyên suốt dự án.
"""
import os
import sys
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pytest
import vnpt_client


def _set_env(monkeypatch, **overrides):
    defaults = {
        "VNPT_TOKEN_ID": "tid-test",
        "VNPT_TOKEN_KEY": "tkey-test",
        "VNPT_ACCESS_TOKEN": "Bearer.test.token",
        "VNPT_API_DOMAIN": "https://api.idg.vnpt.vn",
    }
    defaults.update(overrides)
    for k, v in defaults.items():
        monkeypatch.setenv(k, v)


class TestVNPTClientConfig:
    def test_thieu_config_raise_loi_ro_rang(self, monkeypatch):
        monkeypatch.delenv("VNPT_TOKEN_ID", raising=False)
        monkeypatch.delenv("VNPT_TOKEN_KEY", raising=False)
        monkeypatch.delenv("VNPT_ACCESS_TOKEN", raising=False)
        with pytest.raises(vnpt_client.VNPTAPIError):
            vnpt_client.VNPTClient()

    def test_du_config_khoi_tao_thanh_cong(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        assert c.token_id == "tid-test"
        assert c.domain == "https://api.idg.vnpt.vn"

    def test_headers_co_du_4_truong_bat_buoc(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        h = c._headers()
        assert h["Authorization"] == "Bearer Bearer.test.token"
        assert h["Token-id"] == "tid-test"
        assert h["Token-key"] == "tkey-test"
        assert "mac-address" in h


class TestExtractClinicalTable:
    def test_luong_thanh_cong_upload_start_poll(self, monkeypatch):
        """Test đúng 3 bước: upload -> lấy session_id -> poll tới SUCCESS."""
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()

        upload_resp = MagicMock(status_code=200)
        upload_resp.json.return_value = {"fileId": "file-123"}
        upload_resp.raise_for_status = lambda: None

        start_resp = MagicMock(status_code=200)
        start_resp.json.return_value = {"session_id": "sess-456"}
        start_resp.raise_for_status = lambda: None

        poll_resp = MagicMock(status_code=200)
        poll_resp.json.return_value = {"status": "SUCCESS", "text": "Nội dung OCR test"}
        poll_resp.raise_for_status = lambda: None

        with patch.object(vnpt_client.requests, "post", side_effect=[upload_resp, start_resp, poll_resp]):
            text = c.extract_clinical_table(b"fake-image-bytes", "test.jpg")
        assert text == "Nội dung OCR test"

    def test_poll_status_failed_raise_loi(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        upload_resp = MagicMock(json=lambda: {"fileId": "f1"}, raise_for_status=lambda: None)
        start_resp = MagicMock(json=lambda: {"session_id": "s1"}, raise_for_status=lambda: None)
        poll_resp = MagicMock(json=lambda: {"status": "FAILED"}, raise_for_status=lambda: None)
        with patch.object(vnpt_client.requests, "post", side_effect=[upload_resp, start_resp, poll_resp]):
            with pytest.raises(vnpt_client.VNPTAPIError):
                c.extract_clinical_table(b"x", "test.jpg")

    def test_upload_khong_tra_file_id_raise_loi(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        bad_resp = MagicMock(json=lambda: {"unexpected": "shape"}, raise_for_status=lambda: None)
        with patch.object(vnpt_client.requests, "post", return_value=bad_resp):
            with pytest.raises(vnpt_client.VNPTAPIError):
                c.extract_clinical_table(b"x", "test.jpg")

    def test_poll_timeout_thi_tu_huy_phien_va_raise_loi(self, monkeypatch):
        """Nếu SmartReader mãi không SUCCESS, phải timeout (không treo vô hạn)
        và raise lỗi để main.py rơi về Claude Vision."""
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        c.POLL_TIMEOUT_SECONDS = 0.05
        c.POLL_INTERVAL_SECONDS = 0.01
        upload_resp = MagicMock(json=lambda: {"fileId": "f1"}, raise_for_status=lambda: None)
        start_resp = MagicMock(json=lambda: {"session_id": "s1"}, raise_for_status=lambda: None)
        pending_resp = MagicMock(json=lambda: {"status": "PENDING"}, raise_for_status=lambda: None)
        cancel_resp = MagicMock(json=lambda: {}, raise_for_status=lambda: None)
        calls = [upload_resp, start_resp]

        def fake_post(url, **kwargs):
            if calls:
                return calls.pop(0)
            return cancel_resp if url.endswith("/cancel") else pending_resp

        with patch.object(vnpt_client.requests, "post", side_effect=fake_post):
            with pytest.raises(vnpt_client.VNPTAPIError):
                c.extract_clinical_table(b"x", "test.jpg")


class TestChatSmartbot:
    def test_chua_trien_khai_raise_not_implemented(self, monkeypatch):
        """CỐ Ý raise NotImplementedError — xem docstring vnpt_client.py.
        Đây là hành vi ĐÚNG (chưa có tài liệu Smartbot xác thực), test này
        đảm bảo hành vi không vô tình bị đổi thành 'giả vờ thành công'."""
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        with pytest.raises(NotImplementedError):
            c.chat_smartbot([{"role": "user", "content": "test"}])


class TestAskVnptFaqBot:
    def test_thieu_bot_id_raise_loi_ro_rang(self, monkeypatch):
        _set_env(monkeypatch)
        monkeypatch.delenv("VNPT_FAQ_BOT_ID", raising=False)
        c = vnpt_client.VNPTClient()
        with pytest.raises(vnpt_client.VNPTAPIError):
            c.ask_vnpt_faq_bot("Câu hỏi test")

    def test_thanh_cong_lay_dung_text_tu_card_type_text(self, monkeypatch):
        """Đúng cấu trúc response thật từ docx: object.sb.card_data, chỉ lấy
        card có type='text', bỏ qua card khác (vd chuyen_gdv)."""
        _set_env(monkeypatch, VNPT_FAQ_BOT_ID="bot-123")
        c = vnpt_client.VNPTClient()
        fake_resp = MagicMock()
        fake_resp.raise_for_status = lambda: None
        fake_resp.json.return_value = {
            "object": {"sb": {"card_data": [
                {"type": "text", "text": "Câu trả lời 1"},
                {"type": "chuyen_gdv", "text": ""},
                {"type": "text", "text": "Câu trả lời 2"},
            ]}}
        }
        with patch.object(vnpt_client.requests, "post", return_value=fake_resp):
            answer = c.ask_vnpt_faq_bot("Câu hỏi test")
        assert answer == "Câu trả lời 1\nCâu trả lời 2"

    def test_khong_co_card_text_nao_raise_loi(self, monkeypatch):
        _set_env(monkeypatch, VNPT_FAQ_BOT_ID="bot-123")
        c = vnpt_client.VNPTClient()
        fake_resp = MagicMock()
        fake_resp.raise_for_status = lambda: None
        fake_resp.json.return_value = {"object": {"sb": {"card_data": []}}}
        with patch.object(vnpt_client.requests, "post", return_value=fake_resp):
            with pytest.raises(vnpt_client.VNPTAPIError):
                c.ask_vnpt_faq_bot("Câu hỏi test")


class TestSmartVoiceStubs:
    def test_tts_raise_not_implemented(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        with pytest.raises(NotImplementedError):
            c.text_to_speech("văn bản test")

    def test_stt_raise_not_implemented(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        with pytest.raises(NotImplementedError):
            c.speech_to_text(b"fake-audio")
