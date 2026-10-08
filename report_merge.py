"""Pure merge logic for adding a new document to an existing patient record.

No I/O and no storage: takes two report dicts, returns a new merged dict.
"""
import json


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
