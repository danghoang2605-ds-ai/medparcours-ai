"""
database.py — Lưu trữ hồ sơ bệnh nhân LÂU DÀI, độc lập với vòng đời container
Hugging Face Space (Space free tier KHÔNG giữ filesystem qua các lần restart).

DÙNG TURSO (libSQL — SQLite-compatible, hosted, miễn phí) thay vì SQLite file
cục bộ — vì file cục bộ trên Space sẽ mất khi container restart/sleep, đúng
hành vi mặc định "ephemeral disk" của Hugging Face Spaces free tier.

THIẾT KẾ SCHEMA — quyết định quan trọng cần giải thích rõ:
  CHỈ lưu "report" (dữ liệu thô đã trích từ AI ở Bước 1), KHÔNG lưu
  "analysis" (kết quả evaluate_v2() — eGFR, CHA2DS2-VASc, ngưỡng INR...).
  Lý do: analysis LUÔN tính lại được từ report bất cứ lúc nào qua rule
  engine (cde/engine.py) — đây đúng nguyên tắc "rule engine tất định,
  không lưu trạng thái dẫn xuất" đã theo suốt dự án. Khi lấy hồ sơ cũ ra,
  backend tự chạy lại evaluate_v2(report) — tự động hưởng lợi nếu sau này
  rule engine được sửa/mở rộng (vd thêm thang điểm GRACE/TIMI), không cần
  migrate dữ liệu cũ.

  "report" được lưu dưới dạng JSON text nguyên khối (KHÔNG tách thành nhiều
  cột/bảng SQL chi tiết theo từng trường) — vì schema JSON do AI (Claude)
  sinh ra qua REPORT_SYSTEM có thể thay đổi nhẹ theo các lần sửa prompt;
  tách cứng thành cột SQL sẽ vỡ ngay khi schema đổi, đòi hỏi migration liên
  tục. Chỉ tách riêng các trường cần TÌM KIẾM/ĐỊNH DANH (số bệnh án, tên,
  thời điểm cập nhật) thành cột SQL — phần còn lại giữ nguyên linh hoạt.

TÍNH NĂNG "CẬP NHẬT HỒ SƠ THEO THỜI GIAN THỰC":
  Khi bác sĩ tải thêm tài liệu mới cho 1 bệnh nhân ĐÃ CÓ trong hệ thống
  (nhận diện qua so_benh_an), tài liệu mới được Claude trích xuất thành
  report_moi (JSON có cấu trúc), rồi GỘP (merge) với report cũ đã lưu —
  không tạo bản ghi tách biệt, không ghi đè mất dữ liệu cũ. Xem
  merge_reports() để biết chi tiết logic gộp.
"""
import os
import json
from datetime import datetime, timezone
from typing import Optional

try:
    import libsql_client
except ImportError:
    libsql_client = None  # cho phép import module này dù chưa cài lib (vd môi trường test cũ)


# ─── Kết nối — Turso (production) hoặc SQLite file local (dev/test) ──────────
def _get_db_url() -> str:
    """
    Production: đọc TURSO_DATABASE_URL từ biến môi trường (Hugging Face Space
    Secrets). Dev/test: nếu không có biến môi trường này, rơi về file SQLite
    cục bộ trong thư mục hiện tại — để chạy test/dev KHÔNG CẦN tài khoản
    Turso thật, đúng nguyên tắc "test không phụ thuộc dịch vụ ngoài, không
    cần mạng" đã áp dụng xuyên suốt dự án (mock_anthropic, v.v.).

    .strip() BẮT BUỘC — đã xác nhận qua log lỗi thật trên Hugging Face Space:
    "Forbidden control character detected in headers. Potential header
    injection attack." Đây xảy ra khi giá trị Secret bị dính ký tự xuống
    dòng/khoảng trắng ẩn ở đầu/cuối (rất dễ xảy ra khi copy-paste 1 chuỗi
    JWT dài từ giao diện web Turso vào ô nhập Secret) — thư viện HTTP nội
    bộ TỪ CHỐI gửi request nếu header chứa ký tự điều khiển, đúng cơ chế an
    toàn chống header injection của chuẩn HTTP. Không phải lỗi sai giá trị,
    chỉ là thừa ký tự vô hình không nhìn thấy được trên giao diện Secrets.
    """
    url = os.environ.get("TURSO_DATABASE_URL")
    if url:
        return url.strip()
    return "file:" + os.path.join(os.path.dirname(os.path.abspath(__file__)), "medparcours_dev.db")


def _get_auth_token() -> Optional[str]:
    """.strip() bắt buộc — xem lý do đầy đủ trong _get_db_url()."""
    token = os.environ.get("TURSO_AUTH_TOKEN")
    return token.strip() if token else None  # None hợp lệ với file: local (không cần token)


def get_client():
    """Tạo 1 client mới mỗi lần gọi — đơn giản, an toàn cho FastAPI sync
    handler (không cần quản lý connection pool phức tạp cho quy mô hackathon).
    Trả None nếu thiếu thư viện libsql_client (báo lỗi rõ ràng ở nơi gọi,
    không silent fail).

    BUG NGHIÊM TRỌNG ĐÃ SỬA (xác nhận qua log thật trên Hugging Face Space):
    libsql_client TỰ ĐỘNG đổi tiền tố "libsql://" thành "wss://" (WebSocket
    Secure) — xem libsql_client/config.py: `if scheme == "libsql": scheme =
    "wss"`. Trên môi trường container của Hugging Face Space, kết nối
    WebSocket ra ngoài bị lỗi handshake ngay từ bước đầu:
        "400, message='Invalid response status', url='wss://...turso.io'"
    Đây KHÔNG PHẢI lỗi sai token/URL — nếu token sai, Turso trả lỗi 401 rõ
    ràng, không phải lỗi 400 ở tầng bắt tay kết nối. Token đúng, chỉ là
    giao thức WebSocket không hoạt động ổn định trong môi trường này.

    GIẢI PHÁP: Turso hỗ trợ CẢ HAI giao thức cho cùng 1 database — chỉ cần
    đổi tiền tố URL từ "libsql://" thành "https://" để ép dùng HTTP thay vì
    WebSocket (xem libsql_client/http.py — class riêng cho giao thức HTTP).
    HTTP ổn định hơn nhiều trong container có proxy/network sandbox hạn chế.
    """
    if libsql_client is None:
        raise RuntimeError(
            "Thiếu thư viện libsql_client — chạy: pip install libsql-client --break-system-packages"
        )
    url = _get_db_url()
    token = _get_auth_token()
    if url.startswith("file:"):
        return libsql_client.create_client_sync(url)
    if url.startswith("libsql://"):
        url = "https://" + url[len("libsql://"):]
    return libsql_client.create_client_sync(url, auth_token=token)


def init_db():
    """Tạo bảng nếu chưa có — gọi 1 lần lúc khởi động app (xem main.py
    startup event). An toàn để gọi nhiều lần (CREATE TABLE IF NOT EXISTS)."""
    client = get_client()
    try:
        client.execute("""
            CREATE TABLE IF NOT EXISTS patients (
                so_benh_an TEXT PRIMARY KEY,
                ho_ten TEXT,
                report_json TEXT NOT NULL,
                so_lan_cap_nhat INTEGER NOT NULL DEFAULT 1,
                tao_luc TEXT NOT NULL,
                cap_nhat_luc TEXT NOT NULL
            )
        """)
        client.execute("""
            CREATE TABLE IF NOT EXISTS patient_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                so_benh_an TEXT NOT NULL,
                report_json_truoc_khi_gop TEXT,
                nguon_tai_lieu_moi TEXT,
                thoi_diem TEXT NOT NULL
            )
        """)
        # feedback: bác sĩ đánh dấu 1 nhận định của hệ thống là sai/chưa
        # chuẩn kèm ghi chú ngắn — khép vòng phản hồi (Tính nâng cấp). Chỉ
        # GHI NHẬN, không tự động sửa gì — cần người rà lại thủ công.
        client.execute("""
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                so_benh_an TEXT,
                muc TEXT NOT NULL,
                noi_dung TEXT NOT NULL,
                ghi_chu TEXT,
                thoi_diem TEXT NOT NULL
            )
        """)
        # ten_hien_thi: tên hiển thị TÙY CHỌN do bác sĩ tự đặt để cá nhân hóa
        # quản lý (vd "Ông A - phòng 302"), TÁCH RIÊNG khỏi ho_ten (tên do AI
        # trích xuất từ tài liệu). Tách riêng CỐ Ý — nếu dùng chung 1 cột,
        # mỗi lần "Cập nhật hồ sơ" (update_patient_with_new_document) ghi đè
        # ho_ten theo tài liệu mới sẽ vô tình xóa mất tên tùy chỉnh của bác sĩ.
        # ALTER TABLE không có cú pháp "IF NOT EXISTS" cho cột trên SQLite/
        # libSQL cũ — bọc try/except để an toàn khi init_db() chạy lại nhiều
        # lần (vd mỗi lần Space khởi động lại) mà cột đã tồn tại từ trước.
        try:
            client.execute("ALTER TABLE patients ADD COLUMN ten_hien_thi TEXT")
        except Exception:
            pass  # Cột đã tồn tại từ lần init_db() trước — bỏ qua, không phải lỗi thật.
        # nhom_benh: nhãn nhóm bệnh cảnh (vd "Bệnh van tim, Rung nhĩ") tính 1
        # lần lúc lưu/cập nhật hồ sơ, dùng cho bộ lọc "theo loại bệnh" ở trang
        # Lịch sử — KHÔNG tính lại mỗi lần list_patients() (sẽ chậm nếu phải
        # parse report_json đầy đủ cho mọi hồ sơ mỗi lần load danh sách).
        try:
            client.execute("ALTER TABLE patients ADD COLUMN nhom_benh TEXT")
        except Exception:
            pass
    finally:
        client.close()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _classify_nhom_benh(report: dict) -> str:
    """
    Tính nhãn nhóm bệnh cảnh (vd "Bệnh van tim, Rung nhĩ") để lưu kèm hồ sơ,
    dùng cho bộ lọc "theo loại bệnh" ở trang Lịch sử — tái dùng ĐÚNG bộ phân
    loại tất định đã có (cde/disease_classifier.py), không viết lại logic
    riêng. Lỗi bất kỳ (report thiếu field, chưa đủ dữ liệu...) trả về chuỗi
    rỗng thay vì chặn việc lưu hồ sơ — phân loại chỉ là tiện ích phụ, không
    phải điều kiện bắt buộc để lưu.
    """
    try:
        from cde.disease_classifier import classify_profiles
        profiles = classify_profiles(report)
        names = [p["ten_hien_thi"] for p in profiles if p.get("ten_hien_thi")]
        return ", ".join(dict.fromkeys(names))  # dedupe giữ thứ tự
    except Exception:
        return ""


def save_feedback(so_benh_an: str, muc: str, noi_dung: str, ghi_chu: str = "") -> dict:
    """Ghi nhận 1 phản hồi 'báo sai/góp ý' từ bác sĩ — chỉ lưu lại, không tự
    động sửa gì. so_benh_an có thể rỗng (feedback không gắn hồ sơ cụ thể)."""
    client = get_client()
    try:
        client.execute(
            "INSERT INTO feedback (so_benh_an, muc, noi_dung, ghi_chu, thoi_diem) VALUES (?, ?, ?, ?, ?)",
            [so_benh_an or "", muc, noi_dung, ghi_chu or "", _now_iso()],
        )
        return {"success": True}
    finally:
        client.close()


def get_patient_history(so_benh_an: str, limit: int = 5) -> list:
    """Lấy các bản ghi report_json TRƯỚC lần gộp gần nhất (patient_history) —
    dùng để so sánh thuốc/chẩn đoán giữa lần cập nhật hiện tại và trước đó."""
    client = get_client()
    try:
        rs = client.execute(
            "SELECT report_json_truoc_khi_gop, nguon_tai_lieu_moi, thoi_diem FROM patient_history "
            "WHERE so_benh_an = ? ORDER BY thoi_diem DESC LIMIT ?",
            [so_benh_an, limit],
        )
        out = []
        for r in rs.rows:
            try:
                out.append({"report": json.loads(r[0]) if r[0] else None, "nguon": r[1], "thoi_diem": r[2]})
            except Exception:
                continue
        return out
    finally:
        client.close()


# ─── CRUD hồ sơ ────────────────────────────────────────────────────────────
def save_new_patient(report: dict) -> dict:
    """
    Lưu hồ sơ MỚI (lần đầu tiên quét cho bệnh nhân này). Nếu so_benh_an đã
    tồn tại, KHÔNG ghi đè — trả về thông báo rõ ràng để frontend hỏi bác sĩ
    có muốn "cập nhật" (gộp) thay vì tạo mới hay không, tránh mất dữ liệu cũ
    do nhầm lẫn.
    """
    info = report.get("thong_tin_benh_nhan", {}) or {}
    so_benh_an = (info.get("so_benh_an") or "").strip()
    if not so_benh_an:
        return {"success": False, "error": "Hồ sơ không có số bệnh án — không thể lưu lâu dài."}

    client = get_client()
    try:
        existing = client.execute(
            "SELECT so_benh_an FROM patients WHERE so_benh_an = ?", [so_benh_an]
        )
        if existing.rows:
            return {
                "success": False,
                "error": "da_ton_tai",
                "message": f"Số bệnh án {so_benh_an} đã có hồ sơ lưu trữ. "
                           f"Dùng tính năng 'Cập nhật hồ sơ' để bổ sung tài liệu mới, "
                           f"không tạo bản ghi mới (tránh trùng lặp/mất dữ liệu cũ).",
            }
        now = _now_iso()
        nhom_benh = _classify_nhom_benh(report)
        client.execute(
            "INSERT INTO patients (so_benh_an, ho_ten, report_json, so_lan_cap_nhat, tao_luc, cap_nhat_luc, nhom_benh) "
            "VALUES (?, ?, ?, 1, ?, ?, ?)",
            [so_benh_an, info.get("ho_ten", ""), json.dumps(report, ensure_ascii=False), now, now, nhom_benh],
        )
        return {"success": True, "so_benh_an": so_benh_an, "so_lan_cap_nhat": 1}
    finally:
        client.close()


def get_patient(so_benh_an: str) -> Optional[dict]:
    """Lấy report đã lưu theo số bệnh án. Trả None nếu chưa từng lưu —
    KHÔNG raise lỗi, để nơi gọi tự quyết định xử lý (vd hồ sơ demo cũ chưa
    từng qua database vẫn hoạt động bình thường, không bị coi là lỗi)."""
    client = get_client()
    try:
        rs = client.execute(
            "SELECT report_json, so_lan_cap_nhat, tao_luc, cap_nhat_luc FROM patients WHERE so_benh_an = ?",
            [so_benh_an],
        )
        if not rs.rows:
            return None
        row = rs.rows[0]
        return {
            "report": json.loads(row[0]),
            "so_lan_cap_nhat": row[1],
            "tao_luc": row[2],
            "cap_nhat_luc": row[3],
        }
    finally:
        client.close()


def delete_patient(so_benh_an: str) -> dict:
    """
    Xóa VĨNH VIỄN 1 hồ sơ đã lưu (bảng patients) và toàn bộ lịch sử gộp tài
    liệu của hồ sơ đó (bảng patient_history) — không có "thùng rác"/khôi
    phục, đúng với việc đây là thao tác bác sĩ chủ động xác nhận (frontend
    bắt buộc xác nhận qua mpConfirm trước khi gọi endpoint này).

    KHÔNG áp dụng cho 2 hồ sơ demo (Nguyễn Văn A/B) — chúng hard-code trong
    App.jsx (HISTORY), không đi qua database, nên không có gì để xóa ở đây.
    """
    client = get_client()
    try:
        existing = client.execute(
            "SELECT so_benh_an FROM patients WHERE so_benh_an = ?", [so_benh_an]
        )
        if not existing.rows:
            return {"success": False, "error": "khong_ton_tai",
                    "message": f"Không tìm thấy hồ sơ lưu trữ cho số bệnh án {so_benh_an}."}
        client.execute("DELETE FROM patient_history WHERE so_benh_an = ?", [so_benh_an])
        client.execute("DELETE FROM patients WHERE so_benh_an = ?", [so_benh_an])
        return {"success": True, "so_benh_an": so_benh_an}
    finally:
        client.close()


def list_patients(limit: int = 50) -> list:
    """Danh sách hồ sơ đã lưu, mới cập nhật gần nhất lên đầu — dùng cho màn
    hình "Lịch sử bệnh án" thay thế 2 hồ sơ demo hard-code cũ."""
    client = get_client()
    try:
        rs = client.execute(
            "SELECT so_benh_an, ho_ten, so_lan_cap_nhat, tao_luc, cap_nhat_luc, ten_hien_thi, nhom_benh "
            "FROM patients ORDER BY cap_nhat_luc DESC LIMIT ?",
            [limit],
        )
        return [
            {"so_benh_an": r[0], "ho_ten": r[5] or r[1], "ho_ten_goc": r[1],
             "ten_hien_thi": r[5], "so_lan_cap_nhat": r[2],
             "tao_luc": r[3], "cap_nhat_luc": r[4], "nhom_benh": r[6] or ""}
            for r in rs.rows
        ]
    finally:
        client.close()


def rename_patient(so_benh_an: str, ten_moi: str) -> dict:
    """
    Đổi TÊN HIỂN THỊ (ten_hien_thi) cho 1 hồ sơ đã lưu — mục đích cá nhân hóa
    quản lý (vd bác sĩ ghi thêm "phòng 302" hoặc biệt danh dễ nhớ), KHÔNG
    đụng tới ho_ten gốc do AI trích xuất từ tài liệu. ten_moi rỗng/khoảng
    trắng -> coi như "bỏ tên tùy chỉnh", quay về hiển thị ho_ten gốc.
    """
    ten_moi = (ten_moi or "").strip()
    client = get_client()
    try:
        existing = client.execute(
            "SELECT so_benh_an FROM patients WHERE so_benh_an = ?", [so_benh_an]
        )
        if not existing.rows:
            return {"success": False, "error": "khong_ton_tai",
                    "message": f"Không tìm thấy hồ sơ lưu trữ cho số bệnh án {so_benh_an}."}
        client.execute(
            "UPDATE patients SET ten_hien_thi = ? WHERE so_benh_an = ?",
            [ten_moi or None, so_benh_an],
        )
        return {"success": True, "so_benh_an": so_benh_an, "ten_hien_thi": ten_moi or None}
    finally:
        client.close()


# ─── Gộp hồ sơ (tính năng "cập nhật theo thời gian thực") ────────────────────
def merge_reports(report_cu: dict, report_moi: dict) -> dict:
    """
    Gộp report_moi (vừa trích từ tài liệu mới upload) VÀO report_cu (đã lưu
    trong database) — trả về report đã gộp, KHÔNG sửa report_cu tại chỗ
    (immutable, để patient_history giữ đúng bản "trước khi gộp").

    NGUYÊN TẮC GỘP (quan trọng, ảnh hưởng an toàn dữ liệu y tế):
      1. Các mảng theo THỜI GIAN (xet_nghiem_key, sieu_am_tim.lan_kham,
         dien_bien_lam_sang, canh_bao_nguy_co) -> NỐI THÊM (concat), không
         ghi đè — đúng bản chất "thêm tài liệu mới" chứ không phải "viết
         lại" toàn bộ. Loại trùng nếu 2 bản ghi giống hệt nhau (cùng ngày +
         cùng nội dung) để tránh nhân đôi nếu bác sĩ lỡ tải trùng tài liệu.
      2. Các trường ĐƠN (thong_tin_benh_nhan, chan_doan_chinh...) -> ưu tiên
         giá trị MỚI nếu report_moi có giá trị khác null/rỗng, GIỮ giá trị
         CŨ nếu report_moi để trống cho trường đó (không ghi đè mất thông
         tin cũ chỉ vì tài liệu mới không nhắc lại đầy đủ).
      3. KHÔNG tự suy luận/tính toán gì thêm ở bước gộp này — chỉ gộp dữ
         liệu thô. Rule engine (cde/engine.py) sẽ tự chạy lại trên report đã
         gộp để tính toán đúng (eGFR, ngưỡng INR...) dựa trên TOÀN BỘ dữ
         liệu đã gộp, không phải tính riêng rồi cộng kết quả.
    """
    merged = json.loads(json.dumps(report_cu))  # deep copy, không sửa report_cu gốc

    # ── 1. Trường đơn: ưu tiên giá trị mới nếu có, giữ cũ nếu mới để trống ──
    SINGLE_VALUE_KEYS = [
        "chan_doan_chinh", "tien_su_benh", "phau_thuat",
    ]
    for key in SINGLE_VALUE_KEYS:
        new_val = report_moi.get(key)
        if new_val not in (None, "", [], {}):
            merged[key] = new_val

    # thong_tin_benh_nhan: gộp theo từng field con, không ghi đè cả object
    if report_moi.get("thong_tin_benh_nhan"):
        merged.setdefault("thong_tin_benh_nhan", {})
        for k, v in report_moi["thong_tin_benh_nhan"].items():
            if v not in (None, ""):
                merged["thong_tin_benh_nhan"][k] = v

    # ── 2. Mảng theo thời gian: nối thêm, loại trùng theo (ngay + nội dung) ─
    ARRAY_KEYS_WITH_DATE = ["xet_nghiem_key", "dien_bien_lam_sang", "canh_bao_nguy_co"]
    for key in ARRAY_KEYS_WITH_DATE:
        old_list = merged.get(key) or []
        new_list = report_moi.get(key) or []
        if not new_list:
            continue
        existing_signatures = {json.dumps(item, sort_keys=True, ensure_ascii=False) for item in old_list}
        for item in new_list:
            sig = json.dumps(item, sort_keys=True, ensure_ascii=False)
            if sig not in existing_signatures:
                old_list.append(item)
                existing_signatures.add(sig)
        merged[key] = old_list

    # sieu_am_tim.lan_kham: cấu trúc lồng 1 cấp, xử lý riêng
    old_echo = (merged.get("sieu_am_tim") or {}).get("lan_kham") or []
    new_echo = (report_moi.get("sieu_am_tim") or {}).get("lan_kham") or []
    if new_echo:
        existing_sig = {json.dumps(item, sort_keys=True, ensure_ascii=False) for item in old_echo}
        for item in new_echo:
            sig = json.dumps(item, sort_keys=True, ensure_ascii=False)
            if sig not in existing_sig:
                old_echo.append(item)
                existing_sig.add(sig)
        merged.setdefault("sieu_am_tim", {})["lan_kham"] = old_echo

    # thuoc_cuoi_ky: đơn thuốc MỚI NHẤT thắng (tài liệu mới hơn = đơn thuốc
    # hiện tại đang dùng, không nối thêm thuốc cũ đã ngừng vào danh sách
    # "đang dùng" — khác bản chất với xét nghiệm/diễn biến là LỊCH SỬ tích
    # lũy, đơn thuốc CUỐI KỲ là TRẠNG THÁI HIỆN TẠI, ghi đè đúng).
    if report_moi.get("thuoc_cuoi_ky"):
        merged["thuoc_cuoi_ky"] = report_moi["thuoc_cuoi_ky"]

    return merged


def update_patient_with_new_document(so_benh_an: str, report_moi: dict, nguon_tai_lieu: str = "") -> dict:
    """
    Endpoint chính cho tính năng "cập nhật hồ sơ theo thời gian thực":
    1. Lấy report_cu đã lưu (lỗi rõ ràng nếu chưa từng lưu — không tự tạo
       mới ngầm, tránh nhầm lẫn giữa "tạo mới" và "cập nhật").
    2. Gộp report_moi vào report_cu qua merge_reports().
    3. Lưu lại bản ghi cũ vào patient_history (để có thể xem lại/khôi phục
       nếu gộp sai — an toàn dữ liệu y tế, không xóa mất bản trước).
    4. Ghi report đã gộp vào patients, tăng so_lan_cap_nhat.
    """
    existing = get_patient(so_benh_an)
    if existing is None:
        return {
            "success": False,
            "error": "chua_co_ho_so",
            "message": f"Chưa có hồ sơ lưu trữ nào cho số bệnh án {so_benh_an}. "
                       f"Dùng tính năng 'Lưu hồ sơ mới' trước khi cập nhật.",
        }

    merged_report = merge_reports(existing["report"], report_moi)
    now = _now_iso()

    client = get_client()
    try:
        client.execute(
            "INSERT INTO patient_history (so_benh_an, report_json_truoc_khi_gop, nguon_tai_lieu_moi, thoi_diem) "
            "VALUES (?, ?, ?, ?)",
            [so_benh_an, json.dumps(existing["report"], ensure_ascii=False), nguon_tai_lieu, now],
        )
        client.execute(
            "UPDATE patients SET report_json = ?, so_lan_cap_nhat = so_lan_cap_nhat + 1, "
            "cap_nhat_luc = ?, ho_ten = ?, nhom_benh = ? WHERE so_benh_an = ?",
            [json.dumps(merged_report, ensure_ascii=False), now,
             (merged_report.get("thong_tin_benh_nhan") or {}).get("ho_ten", ""),
             _classify_nhom_benh(merged_report), so_benh_an],
        )
        return {
            "success": True,
            "so_benh_an": so_benh_an,
            "report": merged_report,
            "so_lan_cap_nhat": existing["so_lan_cap_nhat"] + 1,
        }
    finally:
        client.close()
