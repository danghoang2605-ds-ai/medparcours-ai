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


# Cache access_token OAuth cho eKYC ở cấp MODULE (không phải instance) —
# nhiều request backend có thể tạo VNPTClient() mới mỗi lần gọi, cache ở
# instance sẽ vô nghĩa (luôn mất khi tạo instance mới). Cache ở module để
# dùng lại token trong cùng tiến trình cho tới khi hết hạn thật.
_EKYC_OAUTH_CACHE = {}


class VNPTAPIError(Exception):
    """Lỗi khi gọi API VNPT — main.py bắt lỗi này (và mọi Exception khác) để
    tự động rơi về Claude, không để lộ ra ngoài cho bác sĩ thấy."""
    pass


def _raise_with_body(resp: "requests.Response") -> None:
    """
    Thay cho resp.raise_for_status() thuần — VNPT thường trả kèm nội dung
    JSON giải thích lý do lỗi cụ thể (vd "token expired", "invalid client")
    trong response body, nhưng raise_for_status() mặc định KHÔNG in ra nội
    dung đó, chỉ báo mã lỗi HTTP chung chung (vd "401 Unauthorized") — không
    đủ để chẩn đoán. Hàm này bắt lỗi rồi ném lại KÈM body thật, in ra log
    console để debug nhanh hơn nhiều so với chỉ có mã lỗi.
    """
    try:
        resp.raise_for_status()
    except requests.HTTPError as e:
        body_preview = (resp.text or "")[:500]
        raise requests.HTTPError(
            f"{e} — Nội dung phản hồi từ VNPT: {body_preview}", response=resp
        ) from None


class VNPTClient:
    """
    SDK gọi API VNPT AI. Đọc cấu hình từ biến môi trường, KHÔNG hard-code
    token vào code — đúng nguyên tắc bảo mật đã áp dụng xuyên suốt dự án
    (giống ANTHROPIC_API_KEY).

    Biến môi trường cần có (SmartReader + FAQ Bot):
      VNPT_TOKEN_ID      — Token-id (header xác thực)
      VNPT_TOKEN_KEY      — Token-key (header xác thực)
      VNPT_API_DOMAIN     — mặc định https://api.idg.vnpt.vn nếu không đặt
      VNPT_MAC_ADDRESS    — header mac-address (xem cảnh báo ở đầu file)
      VNPT_ACCESS_TOKEN   — chuỗi Bearer JWT dùng thẳng (KHÔNG cần gọi thêm
                             /oauth/token — token BTC cấp đã là access_token
                             cuối, xác nhận ở phiên đọc Postman trước)

    Biến môi trường RIÊNG cho SmartVoice (TTS/STT) — TÙY CHỌN:
      VNPT_TTS_TOKEN_ID / VNPT_TTS_TOKEN_KEY / VNPT_TTS_ACCESS_TOKEN
      VNPT_STT_TOKEN_ID / VNPT_STT_TOKEN_KEY / VNPT_STT_ACCESS_TOKEN
      XÁC NHẬN THẬT từ tài liệu BTC: SmartVoice có bộ Token-id/Token-key
      RIÊNG cho TTS và STT (2 file "Thông tin token" khác nhau, Token-id
      2 bên khác nhau ở vài ký tự cuối) — KHÔNG dùng chung bộ với
      SmartReader như giả định ban đầu. Nếu 3 biến riêng này chưa điền,
      tự động rơi về dùng bộ VNPT_TOKEN_ID/KEY/ACCESS_TOKEN chung ở trên
      (an toàn — vẫn chạy được nếu thực tế 1 số môi trường VNPT cấp chung).
    """

    DEFAULT_DOMAIN = "https://api.idg.vnpt.vn"
    # Thời gian tối đa chờ SmartReader xử lý xong 1 file trước khi coi là
    # timeout và ném lỗi cho main.py rơi về Claude Vision — không để bác sĩ
    # chờ vô thời hạn. Tăng từ 60s lên 240s: bệnh án thật nhiều trang/bảng
    # phức tạp cần nhiều thời gian xử lý hơn ảnh đơn giản — 60s trước đây
    # dễ timeout oan cho hồ sơ dài, rơi về Claude Vision không cần thiết.
    POLL_TIMEOUT_SECONDS = 240
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
        # Bộ token riêng cho SmartVoice — fallback về bộ chung nếu chưa điền.
        self.tts_token_id = os.environ.get("VNPT_TTS_TOKEN_ID", "").strip() or self.token_id
        self.tts_token_key = os.environ.get("VNPT_TTS_TOKEN_KEY", "").strip() or self.token_key
        self.tts_access_token = os.environ.get("VNPT_TTS_ACCESS_TOKEN", "").strip() or self.access_token
        self.stt_token_id = os.environ.get("VNPT_STT_TOKEN_ID", "").strip() or self.token_id
        self.stt_token_key = os.environ.get("VNPT_STT_TOKEN_KEY", "").strip() or self.token_key
        self.stt_access_token = os.environ.get("VNPT_STT_ACCESS_TOKEN", "").strip() or self.access_token
        # Bộ token riêng cho eKYC (OCR CCCD + nhận diện khuôn mặt) — cùng
        # pattern đã xác nhận đúng cho TTS/STT (mỗi sản phẩm VNPT thường có
        # bộ Token-id/Token-key riêng, dù cùng domain api.idg.vnpt.vn).
        self.ekyc_token_id = os.environ.get("VNPT_EKYC_TOKEN_ID", "").strip() or self.token_id
        self.ekyc_token_key = os.environ.get("VNPT_EKYC_TOKEN_KEY", "").strip() or self.token_key
        self.ekyc_access_token = os.environ.get("VNPT_EKYC_ACCESS_TOKEN", "").strip() or self.access_token
        # eKYC có KIẾN TRÚC XÁC THỰC KHÁC HẲN SmartReader/TTS/STT — xác
        # nhận thật qua lỗi 401 "No permission to access api" (mã lỗi
        # NGHĨA LÀ token hợp lệ về ĐỊNH DẠNG nhưng KHÔNG có quyền, khác hẳn
        # "TOKEN INVALID"). Tài liệu BTC có riêng mục "API lấy access token
        # bảo mật dựa vào tài khoản" — eKYC cần username/password (KHÁC
        # access_token tĩnh) gọi POST /auth/oauth/token để lấy access_token
        # MỚI trước khi gọi bất kỳ API eKYC nào. Nếu chưa cấu hình username/
        # password, tự rơi về access_token tĩnh cũ (không phá vỡ nếu hóa ra
        # không cần OAuth thật).
        self.ekyc_username = os.environ.get("VNPT_EKYC_USERNAME", "").strip()
        self.ekyc_password = os.environ.get("VNPT_EKYC_PASSWORD", "").strip()
        self.ekyc_client_id = os.environ.get("VNPT_EKYC_CLIENT_ID", "clientapp").strip()
        # "password" là giá trị CỐ ĐỊNH ghi thẳng trong template Postman mẫu
        # của BTC (client_secret: "password") — không phải secret riêng
        # từng đội (BTC chỉ cấp username/password tài khoản, không cấp
        # riêng client_secret) — dùng làm default để không bắt buộc phải
        # thêm thêm 1 biến môi trường nữa.
        self.ekyc_client_secret = os.environ.get("VNPT_EKYC_CLIENT_SECRET", "password").strip()
        # Bộ token riêng cho tóm tắt cuộc họp (eval-emotion-service) — path
        # domain KHÁC hẳn stt-service (dùng cho STT thường), theo đúng
        # pattern đã xác nhận: mỗi sản phẩm VNPT thường có bộ Token-id/
        # Token-key riêng dù cùng domain api.idg.vnpt.vn. Trước đây MƯỢN
        # tạm bộ STT_TOKEN cho tính năng này — sửa lại có biến riêng, vẫn
        # fallback về STT_TOKEN rồi về bộ chung nếu chưa điền (an toàn).
        self.summary_token_id = os.environ.get("VNPT_SUMMARY_TOKEN_ID", "").strip() or self.stt_token_id
        self.summary_token_key = os.environ.get("VNPT_SUMMARY_TOKEN_KEY", "").strip() or self.stt_token_key
        self.summary_access_token = os.environ.get("VNPT_SUMMARY_ACCESS_TOKEN", "").strip() or self.stt_access_token

    def _get_ekyc_oauth_token(self) -> str:
        """
        Lấy access_token eKYC qua OAuth (POST /auth/oauth/token với
        username/password) nếu đã cấu hình — cache lại trong bộ nhớ tiến
        trình, tự gọi lại khi hết hạn (trừ hao 60s an toàn trước
        expires_in thật). Nếu CHƯA cấu hình username/password, trả về
        access_token tĩnh cũ (self.ekyc_access_token) — không ép buộc
        OAuth nếu chưa rõ có cần hay không.
        """
        if not self.ekyc_username or not self.ekyc_password:
            print("[eKYC OAuth] CHƯA cấu hình VNPT_EKYC_USERNAME/PASSWORD — dùng access_token tĩnh cũ (có thể không đủ quyền cho eKYC).")
            return self.ekyc_access_token
        now = time.time()
        cached = _EKYC_OAUTH_CACHE.get("token")
        expires_at = _EKYC_OAUTH_CACHE.get("expires_at", 0)
        if cached and now < expires_at:
            print("[eKYC OAuth] Dùng access_token đã cache từ lần lấy OAuth trước (chưa hết hạn).")
            return cached
        print(f"[eKYC OAuth] Đang gọi {self.domain}/auth/oauth/token với username={self.ekyc_username!r} để lấy access_token mới...")
        payload = {
            "username": self.ekyc_username, "password": self.ekyc_password,
            "client_id": self.ekyc_client_id, "grant_type": "password",
            "client_secret": self.ekyc_client_secret,
        }
        resp = requests.post(f"{self.domain}/auth/oauth/token",
                              headers={"Content-Type": "application/json"}, json=payload, timeout=20)
        _raise_with_body(resp)
        data = resp.json()
        token = data.get("access_token")
        if not token:
            raise VNPTAPIError(f"OAuth eKYC không trả về access_token. Response: {data}")
        print("[eKYC OAuth] Lấy access_token MỚI thành công qua OAuth, sẽ dùng cho request eKYC tiếp theo.")
        expires_in = int(data.get("expires_in") or 3600)
        _EKYC_OAUTH_CACHE["token"] = token
        _EKYC_OAUTH_CACHE["expires_at"] = now + max(expires_in - 60, 60)
        return token

    def _headers(self, content_type: Optional[str] = "application/json",
                 token_id: Optional[str] = None, token_key: Optional[str] = None,
                 access_token: Optional[str] = None) -> dict:
        tok = access_token or self.access_token
        # Phòng lỗi dính đúp "Bearer" — tài liệu "Thông tin token" của BTC
        # đưa chuỗi token ĐÃ CÓ SẴN chữ "Bearer " ở đầu, dễ bị copy nguyên
        # cả chữ đó dán vào biến môi trường. Nếu vậy, header cuối cùng sẽ
        # thành "Authorization: Bearer Bearer eyJ..." — VNPT báo lỗi 401
        # "Cannot convert access token to JSON" (đã xác nhận thật qua log
        # thực tế). Tự động bóc bỏ nếu phát hiện dính sẵn, không phụ thuộc
        # người điền biến môi trường phải nhớ bỏ đúng.
        if tok.lower().startswith("bearer "):
            tok = tok[7:].strip()
        h = {
            "Authorization": f"Bearer {tok}",
            "Token-id": token_id or self.token_id,
            "Token-key": token_key or self.token_key,
            "mac-address": self.mac_address,
        }
        if content_type:
            h["Content-Type"] = content_type
        return h

    # ─── SMARTREADER — OCR bảng biểu bất đồng bộ (5.1/5.2) ─────────────────

    def _upload_file(self, file_bytes: bytes, filename: str) -> str:
        """
        POST /file-service/v1/addFile — bước 1: tải file lên, lấy file_hash
        để dùng cho bước OCR.

        BUG THẬT ĐÃ SỬA: field response đúng là "hash" (xác nhận qua tài
        liệu docx "Tài liệu API bóc tách văn bản hành chính nâng cao" +
        nhiều tài liệu giấy tờ khác, đều cùng 1 mẫu response addFile) —
        trước đây code tìm "fileId" (không tồn tại trong bất kỳ response
        thật nào), khiến bước upload LUÔN trả về rỗng, làm hỏng toàn bộ
        luồng SmartReader OCR ngay từ bước đầu tiên.
        """
        url = f"{self.domain}/file-service/v1/addFile"
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        files = {"file": (filename, file_bytes, mime)}
        # "title" là form field BẮT BUỘC — xác nhận thật qua lỗi 400 thực tế
        # (MissingServletRequestParameterException: title parameter is
        # missing). Dùng tên file làm title mặc định, hợp lý nhất khi
        # không có tiêu đề riêng nào khác được cung cấp.
        data_fields = {"title": filename}
        # Không gửi Content-Type thủ công khi dùng multipart — để `requests`
        # tự sinh boundary đúng chuẩn.
        headers = self._headers(content_type=None)
        resp = requests.post(url, headers=headers, files=files, data=data_fields, timeout=30)
        _raise_with_body(resp)
        data = resp.json()
        file_hash = (data.get("object") or {}).get("hash")
        if not file_hash:
            raise VNPTAPIError(f"Upload SmartReader không trả về hash. Response: {data}")
        return file_hash

    def _start_ocr_session(self, file_hash: str, file_type: str) -> str:
        """
        POST /rpa-service/aidigdoc/v1/integration/ocr/scan-table — bước 2:
        khởi tạo phiên OCR bất đồng bộ, trả về session_id để poll kết quả.

        Request body và cách bọc response ĐÃ XÁC NHẬN THẬT qua Postman
        collection "API OCR - Hackathon" (mẫu request có file_type: "pdf"
        tường minh — xác nhận SmartReader NHẬN PDF làm input trực tiếp,
        không chỉ ảnh). Trước đây code gửi sai field (file_id thay vì
        file_hash), THIẾU hoàn toàn file_type/token/client_session/details
        (bắt buộc), và đọc sai vị trí response (thiếu bọc "object") — sửa
        lại đúng theo bằng chứng thật.
        """
        url = f"{self.domain}/rpa-service/aidigdoc/v1/integration/ocr/scan-table"
        payload = {
            "file_hash": file_hash,
            "file_type": file_type,
            "token": f"medparcours-{int(time.time())}",  # chuỗi bất kỳ để tra log phía VNPT, KHÔNG phải access_token
            "client_session": f"medparcours-{int(time.time())}",
            "details": True,
            "exporter": "json",
        }
        resp = requests.post(url, headers=self._headers(), json=payload, timeout=30)
        _raise_with_body(resp)
        data = resp.json()
        session_id = (data.get("object") or {}).get("session_id")
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
            _raise_with_body(resp)
            data = resp.json()
            obj = data.get("object") or {}
            status = (obj.get("status") or "").upper()
            last_status = status
            if status == "SUCCESS":
                return obj
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

        file_type: xác nhận thật SmartReader NHẬN PDF làm input trực tiếp
        (không chỉ ảnh) — mẫu request thật trong Postman collection có
        "file_type": "pdf" tường minh. Suy ra từ đuôi file, mặc định "pdf"
        nếu không nhận diện được.
        """
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "pdf"
        file_type = ext if ext in ("pdf", "png", "jpg", "jpeg") else "pdf"
        file_hash = self._upload_file(file_bytes, filename)
        session_id = self._start_ocr_session(file_hash, file_type)
        result = self._poll_ocr_result(session_id)  # đã là "object" (bỏ lớp bọc ngoài), không cần bóc thêm
        # Tên field chứa text/bảng kết quả cuối — GIẢ ĐỊNH, CẦN XÁC NHẬN LẠI
        # (chưa thấy mẫu response ĐẦY ĐỦ cho scan-table/result trong tài
        # liệu, chỉ xác nhận được request + wrapping "object" cho status).
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
        _raise_with_body(resp)
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

    # ─── SMARTVOICE (TTS/STT) — endpoint ĐÃ XÁC THỰC ────────────────────────
    # Tìm được trong Project Materials: Text_To_Speech (General/gRPC)
    # postman_collection.json + Speech to Text collection.postman_collection
    # .json + 2 file .docx mô tả API. Domain giống hệt SmartReader
    # (api.idg.vnpt.vn) — dùng chung self.domain/_headers() đã có, không
    # cần class/token riêng.
    #
    # TTS có 3 biến thể: v1/v2 "standard" là BẤT ĐỒNG BỘ (trả text_id, phải
    # gọi thêm /check-status để lấy audio sau — polling phức tạp, phù hợp
    # đọc bài dài). Dùng "v2/grpc" (ĐỒNG BỘ, trả file audio ngay trong 1
    # request) — đúng nhu cầu đọc cảnh báo ngắn tức thì trong app, không cần
    # polling.

    def text_to_speech(self, text: str, voice_gender: str = "female", region: str = "north") -> bytes:
        """
        Chuyển văn bản thành giọng nói, trả về bytes audio (wav) — dùng
        endpoint đồng bộ /tts-service/v2/grpc (trả file ngay, không cần
        polling như 2 endpoint "standard" khác).

        region param thật của VNPT gộp giới tính+miền thành 1 chuỗi (vd
        "female_north") — voice_gender/region ở đây chỉ là tham số tiện cho
        code gọi, tự ghép lại đúng định dạng VNPT cần bên trong hàm.
        """
        region_param = f"{voice_gender}_{region}"
        payload = {
            "text": text,
            "model": "news",
            "region": region_param,
            "speed": "1",
            "domain": "general",
        }
        resp = requests.post(f"{self.domain}/tts-service/v2/grpc",
            headers=self._headers(token_id=self.tts_token_id, token_key=self.tts_token_key, access_token=self.tts_access_token),
            json=payload, timeout=30)
        _raise_with_body(resp)
        # Cấu trúc response ĐÃ XÁC NHẬN THẬT qua log thực tế (khác tài liệu
        # mô tả "output trả ra file audio" — thực tế v2/grpc CŨNG trả JSON
        # giống endpoint "standard", không trả file nhị phân trực tiếp):
        #   {"message":"IDG-00000000","object":{"code":"success","playlist":
        #    [{"audio_link":"https://ic-smartvoice.vnpt.vn/.../xxx.wav",...}],
        #    "text_id":"...","version":"2.0.0"},...}
        # "code" khác "success" (vd "pending"/"error") -> chưa có audio, báo
        # lỗi rõ thay vì cố tải link rỗng.
        data = resp.json()
        obj = data.get("object") or {}
        code = obj.get("code")
        if code != "success":
            raise VNPTAPIError(f"TTS chưa có audio (code={code}). Toàn bộ phản hồi: {resp.text[:500]}")
        playlist = obj.get("playlist") or []
        audio_link = playlist[0].get("audio_link") if playlist else None
        if not audio_link:
            raise VNPTAPIError(f"TTS báo thành công nhưng không có audio_link. Phản hồi: {resp.text[:500]}")
        # audio_link là file cache tạm (24h) trên domain KHÁC (ic-smartvoice
        # .vnpt.vn, không phải api.idg.vnpt.vn) — tải về ngay để trả bytes
        # cho main.py, không cần thêm header xác thực (link tải công khai
        # theo đúng mô hình Media Server đã mô tả trong tài liệu BTC).
        audio_resp = requests.get(audio_link, timeout=30)
        audio_resp.raise_for_status()
        return audio_resp.content

    def speech_to_text(self, audio_bytes: bytes, filename: str = "recording.wav", timeout: int = 30) -> str:
        """
        Giải băng audio thành text — dùng endpoint đồng bộ
        /stt-service/v1/grpc/standard (multipart form-data, field
        'audioFile'), phù hợp file ghi âm ngắn (lời dặn bác sĩ trong app,
        <=10MB). File dài hơn nên dùng bản .../grpc/async/standard (chưa
        cần trong use case hiện tại — lời dặn thường chỉ vài chục giây).

        timeout mặc định 30s đủ cho lời dặn ngắn — khi hàm này được dùng
        làm FALLBACK cho tóm tắt hội chẩn (audio có thể dài vài phút),
        main.py truyền timeout dài hơn (khớp với timeout của
        summarize_meeting_audio) để tránh cả 2 lớp fallback cùng timeout ở
        đúng 30s và fail đồng loạt cho file dài.
        """
        mime = mimetypes.guess_type(filename)[0] or "audio/wav"
        files = {"audioFile": (filename, audio_bytes, mime)}
        data = {"clientSession": f"medparcours-{int(time.time())}"}
        headers = self._headers(content_type=None, token_id=self.stt_token_id, token_key=self.stt_token_key, access_token=self.stt_access_token)  # multipart tự sinh boundary
        resp = requests.post(f"{self.domain}/stt-service/v1/grpc/standard", headers=headers, files=files, data=data, timeout=timeout)
        _raise_with_body(resp)
        result = resp.json()
        # Cấu trúc response ĐÃ XÁC NHẬN THẬT từ tài liệu VNPT (mẫu output
        # đầy đủ trong docx mô tả API STT):
        #   {"message":"IDG-00000000","object":{"results":[{"alternatives":
        #    [{"transcript":"...","confidence":-1.17}],"channelTag":1.0}],
        #    "status":"OK","audio_duration":91.2}}
        # Text thật nằm ở object.results[0].alternatives[0].transcript —
        # KHÁC hoàn toàn với các field đã đoán trước đó (result.text/
        # result.data.text...) khi chưa có mẫu response thật.
        try:
            results = (result.get("object") or {}).get("results") or []
            text = results[0]["alternatives"][0]["transcript"]
        except (IndexError, KeyError, TypeError):
            text = None
        if not text:
            raise VNPTAPIError(f"STT trả về nhưng không tìm thấy nội dung transcript. Response: {result}")
        return text

    # ─── EKYC — OCR CCCD + nhận diện khuôn mặt (Đề án 06 / eKYC) ───────────
    # Endpoint ĐÃ XÁC THỰC từ Postman collection "API eKYC App - Hackathon".
    # Lưu ý: file-service ở đây dùng path KHÁC SmartReader — không có
    # "/v1/" (SmartReader: /file-service/v1/addFile, eKYC:
    # /file-service/addFile) — 2 phiên bản khác nhau của cùng dịch vụ, xác
    # nhận đúng qua Postman, không phải lỗi đánh máy.

    def _ekyc_upload_file(self, file_bytes: bytes, filename: str, title: str) -> str:
        url = f"{self.domain}/file-service/addFile"
        mime = mimetypes.guess_type(filename)[0] or "image/jpeg"
        files = {"file": (filename, file_bytes, mime)}
        data = {"title": title, "description": title}
        headers = self._headers(content_type=None, token_id=self.ekyc_token_id, token_key=self.ekyc_token_key, access_token=self._get_ekyc_oauth_token())
        resp = requests.post(url, headers=headers, files=files, data=data, timeout=30)
        _raise_with_body(resp)
        data = resp.json()
        img_hash = data.get("hash") or data.get("fileId") or (data.get("data") or {}).get("hash")
        if not img_hash:
            raise VNPTAPIError(f"Upload eKYC không trả về hash ảnh. Response: {data}")
        return img_hash

    def ocr_id_card(self, img_front_bytes: bytes, img_back_bytes: bytes = None) -> dict:
        """
        OCR trích xuất thông tin từ ảnh CCCD/CMND — dùng POST /ai/v1/ocr/id.
        Chỉ trích xuất thông tin IN TRÊN THẺ (họ tên, số CCCD, ngày sinh...)
        — KHÔNG tra cứu liên thông cơ sở dữ liệu quốc gia thật (không có
        quyền truy cập CSDL đó), chỉ đọc đúng chữ in trên ảnh thẻ.
        """
        client_session = f"medparcours-{int(time.time())}"
        img_front_hash = self._ekyc_upload_file(img_front_bytes, "cccd_front.jpg", "cccd_front")
        payload = {"img_front": img_front_hash, "step_id": 0, "validate_postcode": False,
                   "crop_param": "0,0", "client_session": client_session, "token": ""}
        if img_back_bytes:
            payload["img_back"] = self._ekyc_upload_file(img_back_bytes, "cccd_back.jpg", "cccd_back")
        headers = self._headers(token_id=self.ekyc_token_id, token_key=self.ekyc_token_key, access_token=self._get_ekyc_oauth_token())
        resp = requests.post(f"{self.domain}/ai/v1/ocr/id", headers=headers, json=payload, timeout=30)
        _raise_with_body(resp)
        data = resp.json()
        obj = data.get("object") or data
        if not obj:
            raise VNPTAPIError(f"OCR CCCD không trả về dữ liệu. Response: {data}")
        return obj

    def face_liveness(self, img_bytes: bytes) -> dict:
        """
        Kiểm tra ảnh khuôn mặt có phải người thật (chống giả mạo bằng ảnh
        chụp lại/video) — dùng POST /ai/v1/face/liveness. Trả về
        {"liveness": "success"/"fail", "liveness_msg": "Người thật"/...}.
        CHỈ xác định "có phải người thật đang đứng trước camera hay không",
        KHÔNG xác nhận danh tính (không so khớp với ảnh CCCD) — đó là bước
        face/compare riêng, chưa cần trong use case hiện tại (chỉ cần xác
        nhận có bác sĩ thật đang thao tác, không cần khớp đúng ai).
        """
        client_session = f"medparcours-{int(time.time())}"
        img_hash = self._ekyc_upload_file(img_bytes, "face.jpg", "face")
        payload = {"img": img_hash, "token": "", "client_session": client_session}
        headers = self._headers(token_id=self.ekyc_token_id, token_key=self.ekyc_token_key, access_token=self._get_ekyc_oauth_token())
        resp = requests.post(f"{self.domain}/ai/v1/face/liveness", headers=headers, json=payload, timeout=30)
        _raise_with_body(resp)
        data = resp.json()
        obj = data.get("object") or {}
        return {
            "liveness": obj.get("liveness"),
            "liveness_msg": obj.get("liveness_msg"),
            "is_real": obj.get("liveness") == "success",
        }

    def card_liveness(self, img_bytes: bytes) -> dict:
        """
        Kiểm tra ảnh CCCD/CMND có phải chụp TRỰC TIẾP từ thẻ thật hay không
        (chống giả mạo bằng ảnh chụp lại màn hình/bản photocopy) — dùng
        POST /ai/v1/card/liveness. Nên gọi hàm này TRƯỚC ocr_id_card(), để
        từ chối sớm ảnh giả mạo thay vì OCR ra thông tin từ 1 ảnh không
        đáng tin cậy.
        """
        client_session = f"medparcours-{int(time.time())}"
        img_hash = self._ekyc_upload_file(img_bytes, "cccd_check.jpg", "cccd_check")
        payload = {"img": img_hash, "token": "", "client_session": client_session, "crop_param": "0,0"}
        headers = self._headers(token_id=self.ekyc_token_id, token_key=self.ekyc_token_key, access_token=self._get_ekyc_oauth_token())
        resp = requests.post(f"{self.domain}/ai/v1/card/liveness", headers=headers, json=payload, timeout=30)
        _raise_with_body(resp)
        data = resp.json()
        obj = data.get("object") or {}
        return {
            "liveness": obj.get("liveness"),
            "liveness_msg": obj.get("liveness_msg"),
            "is_real": obj.get("liveness") == "success",
        }

    def face_compare(self, img_cccd_bytes: bytes, img_face_bytes: bytes) -> dict:
        """
        So khớp khuôn mặt vừa chụp (ảnh từ camera) với ảnh chân dung trên
        CCCD — xác nhận ĐÚNG NGƯỜI đang ký duyệt là chủ thẻ, không chỉ "có
        người thật đứng trước camera" (đó là face_liveness, kiểm tra khác).
        Dùng POST /ai/v1/face/compare.
        """
        client_session = f"medparcours-{int(time.time())}"
        img_front_hash = self._ekyc_upload_file(img_cccd_bytes, "cccd_front.jpg", "cccd_front_compare")
        img_face_hash = self._ekyc_upload_file(img_face_bytes, "face.jpg", "face_compare")
        payload = {"img_front": img_front_hash, "img_face": img_face_hash,
                   "client_session": client_session, "token": ""}
        headers = self._headers(token_id=self.ekyc_token_id, token_key=self.ekyc_token_key, access_token=self._get_ekyc_oauth_token())
        resp = requests.post(f"{self.domain}/ai/v1/face/compare", headers=headers, json=payload, timeout=30)
        _raise_with_body(resp)
        data = resp.json()
        obj = data.get("object") or {}
        return {
            "msg": obj.get("msg"),
            "is_match": obj.get("msg") == "MATCH",
        }

    # ─── TÓM TẮT CUỘC HỌP (VNPT iSense / eval-emotion-service) ─────────────
    # Endpoint ĐÃ XÁC THỰC từ "VNPT Smart Voice_Tài liệu mô tả API Tóm tắt
    # cuộc gọi.docx" — "2 trong 1": nhận thẳng file audio, TỰ làm STT + tóm
    # tắt bên trong VNPT, không cần tôi tự ghép speech_to_text() + gọi tóm
    # tắt riêng như dự kiến ban đầu.
    #
    # LƯU Ý: "Khuyến nghị thông số kỹ thuật" trong tài liệu ghi audio nên
    # dài 3-10 giây — không rõ đây là giới hạn CHUNG cho mọi API SmartVoice
    # hay chỉ áp dụng cho STT/TTS câu ngắn. Với ghi âm hội chẩn (thường vài
    # phút), main.py PHẢI có fallback an toàn nếu VNPT từ chối audio dài
    # (xem summarize_consultation_audio trong main.py).

    def summarize_meeting_audio(self, audio_bytes: bytes, filename: str = "meeting.wav",
                                 template: str = "detail_summary", max_num_speakers: int = 2) -> str:
        """
        Tóm tắt trực tiếp từ file audio cuộc họp/hội chẩn — dùng POST
        /eval-emotion-service/v1/conversation/summary-meeting.
        template: "detail_summary" (tóm tắt chi tiết) — có thể đổi thành
        "bullet_point_highlights"/"action_items"/"decisions" tùy nhu cầu.
        """
        mime = mimetypes.guess_type(filename)[0] or "audio/wav"
        files = {"file": (filename, audio_bytes, mime)}
        data = {"maxNumSpeakers": str(max_num_speakers), "languageCode": "vi-VN", "template": template}
        headers = self._headers(content_type=None, token_id=self.summary_token_id, token_key=self.summary_token_key, access_token=self.summary_access_token)
        resp = requests.post(f"{self.domain}/eval-emotion-service/v1/conversation/summary-meeting",
                              headers=headers, files=files, data=data, timeout=60)
        _raise_with_body(resp)
        result = resp.json()
        summary = (result.get("object") or {}).get("summary")
        if not summary:
            raise VNPTAPIError(f"Tóm tắt VNPT không trả về nội dung. Response: {result}")
        return summary
