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


class TestTextToSpeech:
    def test_thanh_cong_tai_ve_dung_audio_tu_audio_link(self, monkeypatch):
        """Cấu trúc response ĐÃ XÁC NHẬN THẬT qua log thực tế — /tts-service
        /v2/grpc KHÔNG trả file nhị phân trực tiếp như tài liệu mô tả, mà
        trả JSON có object.playlist[0].audio_link (link cache tạm 24h trên
        domain khác) — phải tải thêm 1 bước GET mới có audio thật."""
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        post_resp = MagicMock()
        post_resp.raise_for_status = lambda: None
        post_resp.json.return_value = {
            "message": "IDG-00000000",
            "object": {
                "code": "success",
                "playlist": [{"audio_link": "https://ic-smartvoice.vnpt.vn/text-speech/x/fake.wav", "idx": "1"}],
                "text_id": "abc123",
                "version": "2.0.0",
            },
        }
        fake_audio = b"RIFF....WAVEfmt fake audio bytes here"
        get_resp = MagicMock()
        get_resp.raise_for_status = lambda: None
        get_resp.content = fake_audio
        with patch.object(vnpt_client.requests, "post", return_value=post_resp), \
             patch.object(vnpt_client.requests, "get", return_value=get_resp) as mock_get:
            result = c.text_to_speech("Xin chào bác sĩ", voice_gender="female", region="north")
        assert result == fake_audio
        mock_get.assert_called_once_with("https://ic-smartvoice.vnpt.vn/text-speech/x/fake.wav", timeout=30)

    def test_ghep_dung_tham_so_region_gioi_tinh_mien(self, monkeypatch):
        """region param thật của VNPT gộp giới tính+miền — kiểm tra ghép
        đúng định dạng 'female_north' trước khi gửi đi."""
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        post_resp = MagicMock()
        post_resp.raise_for_status = lambda: None
        post_resp.json.return_value = {"object": {"code": "success", "playlist": [{"audio_link": "https://x/f.wav"}]}}
        get_resp = MagicMock()
        get_resp.raise_for_status = lambda: None
        get_resp.content = b"RIFFfake"
        captured = {}
        def fake_post(url, headers=None, json=None, **kwargs):
            captured["json"] = json
            return post_resp
        with patch.object(vnpt_client.requests, "post", side_effect=fake_post), \
             patch.object(vnpt_client.requests, "get", return_value=get_resp):
            c.text_to_speech("test", voice_gender="male", region="south")
        assert captured["json"]["region"] == "male_south"

    def test_code_khac_success_raise_loi_ro(self, monkeypatch):
        """code='pending'/'error' -> chưa có audio thật, phải báo lỗi rõ
        thay vì cố tải audio_link rỗng/không tồn tại."""
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        fake_resp = MagicMock()
        fake_resp.raise_for_status = lambda: None
        fake_resp.json.return_value = {"object": {"code": "pending"}}
        with patch.object(vnpt_client.requests, "post", return_value=fake_resp):
            with pytest.raises(vnpt_client.VNPTAPIError):
                c.text_to_speech("test")

    def test_thanh_cong_nhung_khong_co_audio_link_raise_loi(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        fake_resp = MagicMock()
        fake_resp.raise_for_status = lambda: None
        fake_resp.json.return_value = {"object": {"code": "success", "playlist": []}}
        with patch.object(vnpt_client.requests, "post", return_value=fake_resp):
            with pytest.raises(vnpt_client.VNPTAPIError):
                c.text_to_speech("test")


class TestSpeechToText:
    def test_thanh_cong_tra_ve_text(self, monkeypatch):
        """Cấu trúc response ĐÃ XÁC NHẬN THẬT từ tài liệu VNPT (mẫu output
        đầy đủ trong docx) — object.results[0].alternatives[0].transcript."""
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        fake_resp = MagicMock()
        fake_resp.raise_for_status = lambda: None
        fake_resp.json.return_value = {
            "message": "IDG-00000000",
            "object": {
                "results": [{
                    "alternatives": [{"transcript": "bệnh nhân cần tái khám tuần sau", "confidence": -1.17}],
                    "channelTag": 1.0,
                }],
                "status": "OK",
                "audio_duration": 3.5,
            },
        }
        with patch.object(vnpt_client.requests, "post", return_value=fake_resp):
            result = c.speech_to_text(b"fake-audio-bytes", "ghi_am.wav")
        assert result == "bệnh nhân cần tái khám tuần sau"

    def test_khong_co_field_text_nao_khop_raise_loi(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        fake_resp = MagicMock()
        fake_resp.raise_for_status = lambda: None
        fake_resp.json.return_value = {"object": {"results": []}}
        with patch.object(vnpt_client.requests, "post", return_value=fake_resp):
            with pytest.raises(vnpt_client.VNPTAPIError):
                c.speech_to_text(b"fake-audio-bytes")


class TestBoTokenRiengSmartVoice:
    def test_fallback_ve_bo_chung_khi_khong_dien_bo_rieng(self, monkeypatch):
        _set_env(monkeypatch)
        for k in ("VNPT_TTS_TOKEN_ID", "VNPT_TTS_TOKEN_KEY", "VNPT_TTS_ACCESS_TOKEN",
                  "VNPT_STT_TOKEN_ID", "VNPT_STT_TOKEN_KEY", "VNPT_STT_ACCESS_TOKEN"):
            monkeypatch.delenv(k, raising=False)
        c = vnpt_client.VNPTClient()
        assert c.tts_token_id == c.token_id
        assert c.stt_access_token == c.access_token

    def test_dung_dung_bo_token_rieng_khi_co_dien(self, monkeypatch):
        """Xác nhận thật: SmartVoice TTS/STT có bộ Token-id/Token-key RIÊNG
        (2 file 'Thông tin token' khác nhau từ BTC) — khi điền đủ biến
        riêng, PHẢI dùng đúng bộ đó, không dùng nhầm bộ chung."""
        _set_env(monkeypatch,
            VNPT_TTS_TOKEN_ID="tts-id-rieng", VNPT_TTS_TOKEN_KEY="tts-key-rieng", VNPT_TTS_ACCESS_TOKEN="tts-token-rieng",
            VNPT_STT_TOKEN_ID="stt-id-rieng", VNPT_STT_TOKEN_KEY="stt-key-rieng", VNPT_STT_ACCESS_TOKEN="stt-token-rieng")
        c = vnpt_client.VNPTClient()
        assert c.tts_token_id == "tts-id-rieng"
        assert c.stt_token_id == "stt-id-rieng"
        assert c.tts_token_id != c.token_id  # khác bộ chung SmartReader

        captured = {}
        def fake_post(url, headers=None, **kwargs):
            captured["headers"] = headers
            resp = MagicMock()
            resp.raise_for_status = lambda: None
            resp.json.return_value = {"object": {"code": "success", "playlist": [{"audio_link": "https://x/f.wav"}]}}
            return resp
        get_resp = MagicMock()
        get_resp.raise_for_status = lambda: None
        get_resp.content = b"RIFFfake"
        with patch.object(vnpt_client.requests, "post", side_effect=fake_post), \
             patch.object(vnpt_client.requests, "get", return_value=get_resp):
            c.text_to_speech("test")
        assert captured["headers"]["Token-id"] == "tts-id-rieng"
        assert captured["headers"]["Authorization"] == "Bearer tts-token-rieng"


class TestChongDinhDupBearer:
    def test_tu_dong_bo_chu_bearer_thua_trong_gia_tri_token(self, monkeypatch):
        """Bug thật đã xác nhận qua log thực tế: tài liệu BTC đưa token có
        sẵn chữ 'Bearer ' ở đầu, dễ bị copy nguyên dán vào biến môi trường
        -> header cuối cùng dính đúp 'Bearer Bearer ...' -> VNPT báo 401
        'Cannot convert access token to JSON'. _headers() phải tự bóc bỏ."""
        _set_env(monkeypatch, VNPT_ACCESS_TOKEN="Bearer eyJhbGciOiJSUzI1NiJ9.fake.token")
        c = vnpt_client.VNPTClient()
        h = c._headers()
        assert h["Authorization"] == "Bearer eyJhbGciOiJSUzI1NiJ9.fake.token"
        assert "Bearer Bearer" not in h["Authorization"]

    def test_khong_co_bearer_thua_van_hoat_dong_binh_thuong(self, monkeypatch):
        _set_env(monkeypatch, VNPT_ACCESS_TOKEN="eyJhbGciOiJSUzI1NiJ9.fake.token")
        c = vnpt_client.VNPTClient()
        h = c._headers()
        assert h["Authorization"] == "Bearer eyJhbGciOiJSUzI1NiJ9.fake.token"


class TestUploadFileTitle:
    def test_gui_dung_field_title_bat_buoc(self, monkeypatch):
        """Bug thật đã xác nhận qua log thực tế: addFile báo 400
        MissingServletRequestParameterException vì thiếu field 'title'
        (chỉ gửi 'file' trước đó) — phải luôn kèm title."""
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        fake_resp = MagicMock()
        fake_resp.raise_for_status = lambda: None
        fake_resp.json.return_value = {"fileId": "abc123"}
        captured = {}
        def fake_post(url, headers=None, files=None, data=None, **kwargs):
            captured["data"] = data
            return fake_resp
        with patch.object(vnpt_client.requests, "post", side_effect=fake_post):
            file_id = c._upload_file(b"fake-image-bytes", "benh_an.jpg")
        assert file_id == "abc123"
        assert captured["data"]["title"] == "benh_an.jpg"


class TestEkycOcrIdCard:
    def test_ocr_thanh_cong_tra_ve_dung_object(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        upload_resp = MagicMock()
        upload_resp.raise_for_status = lambda: None
        upload_resp.json.return_value = {"hash": "idg20260703-abc123"}
        ocr_resp = MagicMock()
        ocr_resp.raise_for_status = lambda: None
        ocr_resp.json.return_value = {"object": {"id": "001099012345", "name": "NGUYEN VAN A", "birth_day": "01/01/1990"}}
        with patch.object(vnpt_client.requests, "post", side_effect=[upload_resp, ocr_resp]):
            result = c.ocr_id_card(b"fake-cccd-image-bytes")
        assert result["id"] == "001099012345"
        assert result["name"] == "NGUYEN VAN A"

    def test_khong_co_object_raise_loi(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        upload_resp = MagicMock()
        upload_resp.raise_for_status = lambda: None
        upload_resp.json.return_value = {"hash": "idg20260703-abc123"}
        ocr_resp = MagicMock()
        ocr_resp.raise_for_status = lambda: None
        ocr_resp.json.return_value = {}
        with patch.object(vnpt_client.requests, "post", side_effect=[upload_resp, ocr_resp]):
            with pytest.raises(vnpt_client.VNPTAPIError):
                c.ocr_id_card(b"fake-cccd-image-bytes")


class TestEkycFaceLiveness:
    def test_nguoi_that_tra_ve_is_real_true(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        upload_resp = MagicMock()
        upload_resp.raise_for_status = lambda: None
        upload_resp.json.return_value = {"hash": "idg20260703-face123"}
        liveness_resp = MagicMock()
        liveness_resp.raise_for_status = lambda: None
        liveness_resp.json.return_value = {"object": {"liveness": "success", "liveness_msg": "Người thật"}}
        with patch.object(vnpt_client.requests, "post", side_effect=[upload_resp, liveness_resp]):
            result = c.face_liveness(b"fake-face-image-bytes")
        assert result["is_real"] is True
        assert result["liveness_msg"] == "Người thật"

    def test_gia_mao_tra_ve_is_real_false(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        upload_resp = MagicMock()
        upload_resp.raise_for_status = lambda: None
        upload_resp.json.return_value = {"hash": "idg20260703-face456"}
        liveness_resp = MagicMock()
        liveness_resp.raise_for_status = lambda: None
        liveness_resp.json.return_value = {"object": {"liveness": "fail", "liveness_msg": "Nghi ngờ giả mạo"}}
        with patch.object(vnpt_client.requests, "post", side_effect=[upload_resp, liveness_resp]):
            result = c.face_liveness(b"fake-face-image-bytes")
        assert result["is_real"] is False


class TestEkycCardLiveness:
    def test_the_that_tra_ve_is_real_true(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        upload_resp = MagicMock()
        upload_resp.raise_for_status = lambda: None
        upload_resp.json.return_value = {"hash": "idg-cccd-hash"}
        card_resp = MagicMock()
        card_resp.raise_for_status = lambda: None
        card_resp.json.return_value = {"object": {"liveness": "success", "liveness_msg": "Người thật"}}
        with patch.object(vnpt_client.requests, "post", side_effect=[upload_resp, card_resp]):
            result = c.card_liveness(b"fake-cccd-bytes")
        assert result["is_real"] is True

    def test_the_gia_tra_ve_is_real_false(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        upload_resp = MagicMock()
        upload_resp.raise_for_status = lambda: None
        upload_resp.json.return_value = {"hash": "idg-cccd-hash"}
        card_resp = MagicMock()
        card_resp.raise_for_status = lambda: None
        card_resp.json.return_value = {"object": {"liveness": "fail", "liveness_msg": "Nghi ngờ ảnh chụp lại"}}
        with patch.object(vnpt_client.requests, "post", side_effect=[upload_resp, card_resp]):
            result = c.card_liveness(b"fake-cccd-bytes")
        assert result["is_real"] is False


class TestEkycFaceCompare:
    def test_khop_khuon_mat_tra_ve_is_match_true(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        upload_resp = MagicMock()
        upload_resp.raise_for_status = lambda: None
        upload_resp.json.return_value = {"hash": "idg-hash"}
        compare_resp = MagicMock()
        compare_resp.raise_for_status = lambda: None
        compare_resp.json.return_value = {"object": {"msg": "MATCH"}}
        with patch.object(vnpt_client.requests, "post", side_effect=[upload_resp, upload_resp, compare_resp]):
            result = c.face_compare(b"fake-cccd-bytes", b"fake-face-bytes")
        assert result["is_match"] is True

    def test_khong_khop_khuon_mat_tra_ve_is_match_false(self, monkeypatch):
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        upload_resp = MagicMock()
        upload_resp.raise_for_status = lambda: None
        upload_resp.json.return_value = {"hash": "idg-hash"}
        compare_resp = MagicMock()
        compare_resp.raise_for_status = lambda: None
        compare_resp.json.return_value = {"object": {"msg": "NOT_MATCH"}}
        with patch.object(vnpt_client.requests, "post", side_effect=[upload_resp, upload_resp, compare_resp]):
            result = c.face_compare(b"fake-cccd-bytes", b"fake-face-bytes")
        assert result["is_match"] is False


class TestBoTokenRiengTomTat:
    def test_fallback_ve_stt_token_khi_khong_dien_bo_rieng(self, monkeypatch):
        """Bug thật đã sửa: summarize_meeting_audio() trước đây MƯỢN thẳng
        bộ STT_TOKEN thay vì có biến riêng — sửa lại có VNPT_SUMMARY_TOKEN_*
        riêng, vẫn fallback về STT_TOKEN nếu chưa điền (an toàn)."""
        _set_env(monkeypatch, VNPT_STT_TOKEN_ID="stt-id-rieng")
        c = vnpt_client.VNPTClient()
        assert c.summary_token_id == "stt-id-rieng"

    def test_dung_dung_bo_token_rieng_khi_co_dien(self, monkeypatch):
        _set_env(monkeypatch,
            VNPT_SUMMARY_TOKEN_ID="sum-id-rieng", VNPT_SUMMARY_TOKEN_KEY="sum-key-rieng",
            VNPT_SUMMARY_ACCESS_TOKEN="sum-token-rieng")
        c = vnpt_client.VNPTClient()
        assert c.summary_token_id == "sum-id-rieng"
        assert c.summary_token_id != c.stt_token_id

        captured = {}
        def fake_post(url, headers=None, **kwargs):
            captured["headers"] = headers
            resp = MagicMock()
            resp.raise_for_status = lambda: None
            resp.json.return_value = {"object": {"summary": "Tóm tắt test"}}
            return resp
        with patch.object(vnpt_client.requests, "post", side_effect=fake_post):
            c.summarize_meeting_audio(b"fake-audio")
        assert captured["headers"]["Token-id"] == "sum-id-rieng"
        assert captured["headers"]["Authorization"] == "Bearer sum-token-rieng"


class TestEkycOAuth:
    def test_khong_co_username_password_dung_access_token_tinh(self, monkeypatch):
        """Chưa cấu hình username/password -> rơi về access_token tĩnh cũ,
        không ép buộc OAuth."""
        vnpt_client._EKYC_OAUTH_CACHE.clear()
        _set_env(monkeypatch)
        c = vnpt_client.VNPTClient()
        assert c._get_ekyc_oauth_token() == c.ekyc_access_token

    def test_co_username_password_goi_oauth_lay_token_moi(self, monkeypatch):
        """Bug thật đã xác nhận qua log thực tế (401 'No permission to
        access api'): eKYC cần access_token lấy qua OAuth (username/
        password), KHÁC access_token tĩnh dùng cho SmartReader/TTS/STT."""
        vnpt_client._EKYC_OAUTH_CACHE.clear()
        _set_env(monkeypatch, VNPT_EKYC_USERNAME="bs@benhvien.vn", VNPT_EKYC_PASSWORD="matkhau123")
        c = vnpt_client.VNPTClient()
        oauth_resp = MagicMock()
        oauth_resp.raise_for_status = lambda: None
        oauth_resp.json.return_value = {"access_token": "token-that-tu-oauth", "expires_in": 3600}
        with patch.object(vnpt_client.requests, "post", return_value=oauth_resp) as mock_post:
            token = c._get_ekyc_oauth_token()
        assert token == "token-that-tu-oauth"
        assert mock_post.call_args.args[0] == f"{c.domain}/auth/oauth/token"
        assert mock_post.call_args.kwargs["json"]["username"] == "bs@benhvien.vn"

    def test_token_duoc_cache_khong_goi_oauth_lai_ngay(self, monkeypatch):
        vnpt_client._EKYC_OAUTH_CACHE.clear()
        _set_env(monkeypatch, VNPT_EKYC_USERNAME="bs@benhvien.vn", VNPT_EKYC_PASSWORD="matkhau123")
        c = vnpt_client.VNPTClient()
        oauth_resp = MagicMock()
        oauth_resp.raise_for_status = lambda: None
        oauth_resp.json.return_value = {"access_token": "token-lan-dau", "expires_in": 3600}
        with patch.object(vnpt_client.requests, "post", return_value=oauth_resp) as mock_post:
            c._get_ekyc_oauth_token()
            c._get_ekyc_oauth_token()  # gọi lần 2 ngay -> phải dùng cache, không gọi OAuth lại
        assert mock_post.call_count == 1

    def test_oauth_dung_de_goi_thuc_su_trong_ocr_id_card(self, monkeypatch):
        """Xác nhận token từ OAuth THẬT SỰ được dùng khi gọi ocr_id_card,
        không chỉ tồn tại trong _get_ekyc_oauth_token() mà không áp dụng."""
        vnpt_client._EKYC_OAUTH_CACHE.clear()
        _set_env(monkeypatch, VNPT_EKYC_USERNAME="bs@benhvien.vn", VNPT_EKYC_PASSWORD="matkhau123")
        c = vnpt_client.VNPTClient()
        oauth_resp = MagicMock()
        oauth_resp.raise_for_status = lambda: None
        oauth_resp.json.return_value = {"access_token": "token-oauth-that", "expires_in": 3600}
        upload_resp = MagicMock()
        upload_resp.raise_for_status = lambda: None
        upload_resp.json.return_value = {"hash": "idg-hash"}
        ocr_resp = MagicMock()
        ocr_resp.raise_for_status = lambda: None
        ocr_resp.json.return_value = {"object": {"name": "NGUYEN VAN A"}}
        captured = {}
        def fake_post(url, headers=None, **kwargs):
            if url.endswith("/auth/oauth/token"):
                return oauth_resp
            if "addFile" in url:
                return upload_resp
            captured["headers"] = headers
            return ocr_resp
        with patch.object(vnpt_client.requests, "post", side_effect=fake_post):
            c.ocr_id_card(b"fake-cccd-bytes")
        assert captured["headers"]["Authorization"] == "Bearer token-oauth-that"
