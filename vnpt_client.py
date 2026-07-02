"""
vnpt_client.py — SDK gọi API VNPT AI (SmartReader, Smartbot).

═══════════════════════════════════════════════════════════════════════════
QUAN TRỌNG — ĐỌC TRƯỚC KHI DÙNG:

1) SmartReader: domain + 5 endpoint + tên header dưới đây đã XÁC NHẬN THẬT
   qua việc đọc trực tiếp file Postman collection do BTC cung cấp
   ("API OCR -Hackathon.postman_collection.json") ở 1 phiên làm việc trước.
   TUY NHIÊN — tên field cụ thể bên trong JSON request/response (vd tên
   field trả về sau khi upload, tên field chứa bảng kết quả OCR) KHÔNG được
   xác nhận lại trong phiên viết code này (không có quyền truy cập lại file
   Postman đó ngay lúc này). Những chỗ này được đánh dấu rõ bằng comment
   "GIẢ ĐỊNH — CẦN XÁC NHẬN LẠI". Chạy thử 1 lần với Postman/curl thật trước
   khi tin tưởng hoàn toàn.

2) Smartbot: KHÔNG có bất kỳ tài liệu kỹ thuật thật nào (endpoint, format
   request/response, cách xác thực) được xác nhận ở bất kỳ phiên làm việc
   nào trước đây — kể cả trong Project Materials hiện tại lẫn lịch sử chat.
   Hàm chat_smartbot() dưới đây CỐ Ý raise NotImplementedError ngay lập tức
   thay vì đoán bừa 1 endpoint không có thật — nếu đoán sai, lỗi sẽ khó phát
   hiện hơn (vẫn "chạy" nhưng trả sai/rỗng) so với báo lỗi rõ ràng ngay từ
   đầu. Vì main.py bọc mọi lời gọi vnpt_client trong try/except rồi tự động
   rơi về Claude, hàm này raise lỗi ngay là HÀNH VI ĐÚNG và AN TOÀN cho tới
   khi có tài liệu Smartbot thật — không phải bug.

3) Header `mac-address`: thấy trong Postman collection thật nhưng KHÔNG có
   giải thích trong tài liệu Word đi kèm. Đây là điểm bất thường cho 1 API
   cloud chạy trên server (Hugging Face Space không có "địa chỉ MAC" theo
   nghĩa thông thường) — nghi ngờ đây là artifact copy từ ứng dụng desktop,
   có thể server không thực sự validate giá trị này. Đọc từ biến môi trường
   VNPT_MAC_ADDRESS, mặc định 1 chuỗi giả nếu không có — CẦN TEST THỰC TẾ để
   biết server có từ chối request nếu thiếu/sai header này hay không.
═══════════════════════════════════════════════════════════════════════════
"""
import os
import time
import mimetypes
from typing import Optional

import requests


class VNPTAPIError(Exception):
    """Lỗi khi gọi API VNPT — main.py bắt lỗi này (và mọi Exception khác) để
    tự động rơi về Claude, không để lộ ra ngoài cho bác sĩ thấy."""
    pass


class VNPTClient:
    """
    SDK gọi API VNPT AI. Đọc cấu hình từ biến môi trường, KHÔNG hard-code
    token vào code — đúng nguyên tắc bảo mật đã áp dụng xuyên suốt dự án
    (giống ANTHROPIC_API_KEY).

    Biến môi trường cần có:
      VNPT_TOKEN_ID      — Token-id (header xác thực)
      VNPT_TOKEN_KEY      — Token-key (header xác thực)
      VNPT_API_DOMAIN     — mặc định https://api.idg.vnpt.vn nếu không đặt
      VNPT_MAC_ADDRESS    — header mac-address (xem cảnh báo ở đầu file)
      VNPT_ACCESS_TOKEN   — chuỗi Bearer JWT dùng thẳng (KHÔNG cần gọi thêm
                             /oauth/token — token BTC cấp đã là access_token
                             cuối, xác nhận ở phiên đọc Postman trước)
    """

    DEFAULT_DOMAIN = "https://api.idg.vnpt.vn"
    # Thời gian tối đa chờ SmartReader xử lý xong 1 file trước khi coi là
    # timeout và ném lỗi cho main.py rơi về Claude Vision — không để bác sĩ
    # chờ vô thời hạn.
    POLL_TIMEOUT_SECONDS = 60
    POLL_INTERVAL_SECONDS = 2

    def __init__(self):
        self.token_id = os.environ.get("VNPT_TOKEN_ID", "").strip()
        self.token_key = os.environ.get("VNPT_TOKEN_KEY", "").strip()
        self.access_token = os.environ.get("VNPT_ACCESS_TOKEN", "").strip()
        self.mac_address = os.environ.get("VNPT_MAC_ADDRESS", "00:00:00:00:00:00").strip()
        self.domain = os.environ.get("VNPT_API_DOMAIN", self.DEFAULT_DOMAIN).strip().rstrip("/")
        if not self.token_id or not self.token_key or not self.access_token:
            raise VNPTAPIError(
                "Thiếu cấu hình VNPT (VNPT_TOKEN_ID/VNPT_TOKEN_KEY/VNPT_ACCESS_TOKEN "
                "chưa được đặt trong biến môi trường)."
            )

    def _headers(self, content_type: Optional[str] = "application/json") -> dict:
        h = {
            "Authorization": f"Bearer {self.access_token}",
            "Token-id": self.token_id,
            "Token-key": self.token_key,
            "mac-address": self.mac_address,
        }
        if content_type:
            h["Content-Type"] = content_type
        return h

    # ─── SMARTREADER — OCR bảng biểu bất đồng bộ (5.1/5.2) ─────────────────

    def _upload_file(self, file_bytes: bytes, filename: str) -> str:
        """
        POST /file-service/v1/addFile — bước 1: tải file lên, lấy file_id để
        dùng cho bước OCR. Endpoint đã xác nhận thật; tên field trong
        response body là GIẢ ĐỊNH — CẦN XÁC NHẬN LẠI (thường VNPT trả dạng
        {"fileId": "...", ...} hoặc bọc trong {"data": {"fileId": "..."}} —
        code dưới đây thử cả 2 dạng, ưu tiên dạng phẳng trước).
        """
        url = f"{self.domain}/file-service/v1/addFile"
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        files = {"file": (filename, file_bytes, mime)}
        # Không gửi Content-Type thủ công khi dùng multipart — để `requests`
        # tự sinh boundary đúng chuẩn.
        headers = self._headers(content_type=None)
        resp = requests.post(url, headers=headers, files=files, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        file_id = data.get("fileId") or (data.get("data") or {}).get("fileId")
        if not file_id:
            raise VNPTAPIError(f"Upload SmartReader không trả về fileId. Response: {data}")
        return file_id

    def _start_ocr_session(self, file_id: str) -> str:
        """
        POST /rpa-service/aidigdoc/v1/integration/ocr/scan-table — bước 2:
        khởi tạo phiên OCR bất đồng bộ, trả về session_id để poll kết quả.
        Tên field request/response — GIẢ ĐỊNH, CẦN XÁC NHẬN LẠI.
        """
        url = f"{self.domain}/rpa-service/aidigdoc/v1/integration/ocr/scan-table"
        resp = requests.post(url, headers=self._headers(), json={"file_id": file_id}, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        session_id = data.get("session_id") or (data.get("data") or {}).get("session_id")
        if not session_id:
            raise VNPTAPIError(f"Khởi tạo phiên OCR không trả về session_id. Response: {data}")
        return session_id

    def _poll_ocr_result(self, session_id: str) -> dict:
        """
        POST /rpa-service/aidigdoc/v1/integration/ocr/scan-table/result —
        bước 3: lặp gọi tới khi trạng thái SUCCESS, timeout sau
        POLL_TIMEOUT_SECONDS để không treo request của bác sĩ vô thời hạn.
        """
        url = f"{self.domain}/rpa-service/aidigdoc/v1/integration/ocr/scan-table/result"
        deadline = time.monotonic() + self.POLL_TIMEOUT_SECONDS
        last_status = None
        while time.monotonic() < deadline:
            resp = requests.post(url, headers=self._headers(), json={"session_id": session_id}, timeout=20)
            resp.raise_for_status()
            data = resp.json()
            status = (data.get("status") or (data.get("data") or {}).get("status") or "").upper()
            last_status = status
            if status == "SUCCESS":
                return data
            if status in ("FAILED", "ERROR"):
                raise VNPTAPIError(f"SmartReader báo lỗi xử lý (status={status}). Response: {data}")
            time.sleep(self.POLL_INTERVAL_SECONDS)
        # Hết thời gian chờ — hủy phiên cho sạch (không chặn lỗi nếu cancel
        # cũng thất bại, đây chỉ là dọn dẹp phụ, không phải luồng chính).
        try:
            self._cancel_ocr_session(session_id)
        except Exception:
            pass
        raise VNPTAPIError(
            f"SmartReader xử lý quá {self.POLL_TIMEOUT_SECONDS}s không xong "
            f"(trạng thái cuối: {last_status}) — coi như lỗi để rơi về Claude Vision."
        )

    def _cancel_ocr_session(self, session_id: str) -> None:
        """POST .../scan-table/cancel — dọn phiên khi timeout/không cần nữa."""
        url = f"{self.domain}/rpa-service/aidigdoc/v1/integration/ocr/scan-table/cancel"
        requests.post(url, headers=self._headers(), json={"session_id": session_id}, timeout=10)

    def extract_clinical_table(self, file_bytes: bytes, filename: str) -> str:
        """
        Hàm chính gọi từ main.py: nhận bytes 1 file ảnh/PDF hồ sơ, trả về
        TEXT thuần đã OCR (bảng biểu được dựng lại dạng text có cấu trúc) —
        text này sau đó được đẩy tiếp vào pipeline trích xuất JSON hiện có
        (call_claude với REPORT_SYSTEM), KHÔNG thay thế bước đó.

        Raise VNPTAPIError (hoặc bất kỳ Exception nào từ requests — timeout,
        lỗi mạng, lỗi HTTP) nếu thất bại ở bất kỳ bước nào — main.py bắt lỗi
        này để rơi về Claude Vision, không để lộ lỗi VNPT ra ngoài.

        LƯU Ý QUAN TRỌNG (đã ghi trong tài liệu BTC, xác nhận thật):
        SmartReader KHÔNG đọc được chữ viết tay — đơn thuốc/ghi chú tay bác
        sĩ Việt Nam rất phổ biến trong bệnh án thật sẽ đọc sai hoặc rỗng.
        Đây là lý do bắt buộc giữ Claude Vision làm fallback, không phải
        tùy chọn.
        """
        file_id = self._upload_file(file_bytes, filename)
        session_id = self._start_ocr_session(file_id)
        result = self._poll_ocr_result(session_id)
        # Tên field chứa text/bảng kết quả cuối — GIẢ ĐỊNH, CẦN XÁC NHẬN LẠI.
        text = (
            result.get("text")
            or result.get("content")
            or (result.get("data") or {}).get("text")
            or (result.get("data") or {}).get("content")
        )
        if not text:
            raise VNPTAPIError(f"SmartReader trả SUCCESS nhưng không có nội dung text. Response: {result}")
        return text

    # ─── SMARTBOT nâng cao (4.2) — CHƯA CÓ TÀI LIỆU XÁC THỰC ───────────────

    def chat_smartbot(self, messages: list) -> str:
        """
        CỐ Ý CHƯA TRIỂN KHAI — xem cảnh báo mục 2 ở đầu file. Không có bất
        kỳ tài liệu kỹ thuật thật nào (endpoint, request/response format,
        cách xác thực) được xác nhận cho Smartbot 4.2 ở bất kỳ đâu trong dự
        án. Viết code đoán bừa endpoint sẽ tệ hơn là báo lỗi rõ ràng — lỗi
        đoán sai có thể "chạy" nhưng âm thầm trả sai/rỗng, khó phát hiện.

        main.py bọc lời gọi hàm này trong try/except và tự động rơi về
        Claude — nên raise ngay ở đây là HÀNH VI ĐÚNG, không phải bug, cho
        tới khi có tài liệu Smartbot thật (Postman collection hoặc tài
        liệu kỹ thuật chính thức từ BTC) để cập nhật lại hàm này.
        """
        raise NotImplementedError(
            "chat_smartbot() chưa triển khai — chưa có tài liệu kỹ thuật Smartbot "
            "đã xác thực (endpoint/format request-response). Cần Postman collection "
            "hoặc tài liệu chính thức từ BTC trước khi code phần này."
        )

    # ─── FAQ BOT — VNPT Smartbot dạng streaming (endpoint ĐÃ XÁC THỰC) ─────
    # Khác chat_smartbot() ở trên: endpoint NÀY đã xác nhận thật qua đúng 3
    # tài liệu BTC cấp (docx "Tài liệu tích hợp Smartbot dạng streaming",
    # pptx "Hướng dẫn khởi tạo kịch bản", Postman collection "API Hackathon
    # track 1"). Dùng cho 1 bot FAQ ĐỘC LẬP (hỏi đáp chung về sản phẩm,
    # KHÔNG phải MedAmi lâm sàng — xem quyết định kiến trúc đã thống nhất).
    #
    # Phần DUY NHẤT còn thiếu để chạy thật: bot_id (phải tạo bot FAQ trên
    # console-smartbot.vnpt.vn theo đúng pptx hướng dẫn trước, sau đó điền
    # VNPT_FAQ_BOT_ID vào biến môi trường — KHÔNG đoán giá trị này).

    FAQ_BOT_ENDPOINT = "https://assistant-stream.vnpt.vn/v1/conversation"

    def ask_vnpt_faq_bot(self, question: str, sender_id: str = "user_test") -> str:
        """
        Gửi 1 câu hỏi tới bot FAQ VNPT Smartbot, trả về nội dung text phản
        hồi (ghép các card loại "text" trong "card_data" theo đúng thứ tự,
        bỏ qua card ảnh/carousel — panel FAQ hiện tại chỉ hiển thị text).

        Raise VNPTAPIError nếu thiếu bot_id hoặc gọi API lỗi — main.py bắt
        lỗi này để trả về câu trả lời bảo trì mặc định, không để lộ ra
        ngoài cho bác sĩ thấy dạng lỗi kỹ thuật.
        """
        bot_id = os.environ.get("VNPT_FAQ_BOT_ID", "").strip()
        if not bot_id:
            # TODO(Đăng): tạo bot FAQ trên console-smartbot.vnpt.vn theo
            # đúng "Hướng dẫn khởi tạo kịch bản.pptx" (mục "Tạo Bot dùng
            # kịch bản, ý định, thực thể" hoặc "Tạo Bot dùng GenAI" nếu
            # muốn áp dụng RAG cho FAQ), sau đó điền VNPT_FAQ_BOT_ID.
            raise VNPTAPIError(
                "Thiếu VNPT_FAQ_BOT_ID — cần tạo bot FAQ trên console-smartbot.vnpt.vn "
                "trước (xem Hướng_dẫn_khởi_tạo_kịch_bản.pptx), rồi điền biến môi trường."
            )

        payload = {
            "bot_id": bot_id,
            "sender_id": sender_id,
            "text": question,
            "input_channel": "livechat",
            "session_id": sender_id,  # đơn giản hóa: 1 sender = 1 session liên tục
            "metadata": {"button_variables": []},
        }
        resp = requests.post(self.FAQ_BOT_ENDPOINT, headers=self._headers(), json=payload, timeout=20)
        resp.raise_for_status()
        data = resp.json()

        # Cấu trúc response theo đúng ví dụ trong docx: object.sb.card_data
        # là 1 list các card, mỗi card có "type" ("text"/"image"/"carousel"/
        # "quickreply"/"chuyen_gdv") — chỉ lấy text từ card loại "text".
        card_data = (
            (data.get("object") or {}).get("sb", {}).get("card_data")
            or data.get("card_data")
            or []
        )
        texts = [c.get("text", "") for c in card_data if c.get("type") == "text" and c.get("text")]
        if not texts:
            raise VNPTAPIError(f"FAQ bot không trả về nội dung text nào. Response: {data}")
        return "\n".join(texts)

    # ─── SMARTVOICE (TTS/STT) — CHƯA CÓ ENDPOINT XÁC THỰC ──────────────────
    # Tài liệu BTC cấp cho SmartVoice ("API_SmartVoice", "APT_SmartVoice")
    # CHỈ chứa chuỗi token (Bearer JWT) — KHÔNG có URL endpoint, KHÔNG có
    # format request/response cho TTS/STT. Giống chat_smartbot(), viết code
    # đoán bừa URL sẽ tệ hơn báo lỗi rõ ràng ngay từ đầu.

    def text_to_speech(self, text: str) -> bytes:
        """
        CỐ Ý CHƯA TRIỂN KHAI.
        TODO(Đăng): điền endpoint TTS thật (đang xin BTC) + xác nhận định
        dạng phản hồi (binary audio stream hay URL file audio) rồi cập nhật
        hàm này. main.py sẽ tự trả use_local_tts=true cho tới lúc đó, Web
        Speech API của trình duyệt đảm nhiệm thay.
        """
        raise NotImplementedError(
            "text_to_speech() chưa triển khai — tài liệu SmartVoice hiện chỉ có token, "
            "chưa có endpoint/format request-response xác thực. Cần tài liệu kỹ thuật "
            "đầy đủ từ BTC trước khi code phần này."
        )

    def speech_to_text(self, audio_bytes: bytes, filename: str = "recording.wav") -> str:
        """
        CỐ Ý CHƯA TRIỂN KHAI.
        TODO(Đăng): điền endpoint STT thật (đang xin BTC) + xác nhận cách
        gửi audio (multipart form-data hay base64) rồi cập nhật hàm này.
        main.py sẽ tự trả error_code="STT_FALLBACK" cho tới lúc đó.
        """
        raise NotImplementedError(
            "speech_to_text() chưa triển khai — tài liệu SmartVoice hiện chỉ có token, "
            "chưa có endpoint/format request-response xác thực. Cần tài liệu kỹ thuật "
            "đầy đủ từ BTC trước khi code phần này."
        )
