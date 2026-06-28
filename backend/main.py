"""
MediFlow AI - Backend FastAPI
Chạy: uvicorn main:app --reload --port 8000
"""
import os
import json
import re
import tempfile
# Nạp biến môi trường từ file .env nếu có (an toàn nếu chưa cài python-dotenv)
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
# pypdf: đọc text PDF rất nhẹ RAM (thay cho pdfplumber vốn ngốn bộ nhớ).
# HIS export là PDF text thuần nên không cần OCR; bỏ OCR giúp vừa RAM 512MB.
from pypdf import PdfReader
import anthropic
import clinical_rules
import ecg_engine
import document_extract

app = FastAPI(title="MediFlow AI", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── SYSTEM PROMPTS ─────────────────────────────────────────────────────────

REPORT_SYSTEM = """Bạn là trợ lý y tế hỗ trợ bác sĩ Việt Nam tóm tắt hồ sơ bệnh nhân.

NHIỆM VỤ: Đọc toàn bộ hồ sơ và trả về báo cáo JSON có cấu trúc.

QUY TẮC BẮT BUỘC:
1. CHỈ dùng thông tin CÓ TRONG hồ sơ — không suy diễn, không thêm
2. Nếu thiếu thông tin: điền null hoặc "Không có trong hồ sơ"
3. Cảnh báo phải có căn cứ rõ từ hồ sơ
4. Giữ nguyên số liệu y khoa, không làm tròn
5. Trả về JSON THUẦN TÚY — không markdown, không text bên ngoài JSON
6. Nếu một chỉ số có kết quả ở NHIỀU NGÀY KHÁC NHAU: CHỈ lấy kết quả của ngày GẦN NHẤT (ngày lớn nhất). Ghi rõ ngày đó vào field "ngay" trong mỗi item xet_nghiem_key.
7. Nếu một chỉ số KHÔNG CÓ trong hồ sơ: điền null, không bịa số liệu.
8. xet_nghiem_key là danh sách ĐỘNG — chỉ đưa vào các chỉ số THỰC SỰ CÓ trong hồ sơ, không hardcode cấu trúc cố định.
9. SIÊU ÂM TIM: liệt kê TẤT CẢ các lượt siêu âm trong mảng sieu_am_tim.lan_kham, mỗi lượt BẮT BUỘC ghi rõ ngày. Sắp xếp theo thời gian tăng dần. Đánh dấu latest:true cho lượt có ngày gần nhất. Đánh dấu canh_bao:true nếu lượt đó có bất thường nguy hiểm (EF giảm nặng, dịch màng tim ép buồng tim...). Điền phase phù hợp: truoc_mo (trước phẫu thuật), sau_mo (ngay sau mổ), hoi_phuc (đang hồi phục), tai_kham (tái khám ổn định).
10. Với mỗi chỉ số EF, chênh áp van: nếu có nhiều lượt đo, giữ TẤT CẢ trong timeline siêu âm, nhưng ở xet_nghiem_key chỉ lấy giá trị GẦN NHẤT (theo quy tắc 6).

Schema bắt buộc:
{
  "thong_tin_benh_nhan": {
    "ho_ten": "",
    "ngay_sinh": "",
    "tuoi": 0,
    "gioi_tinh": "",
    "dia_chi": "",
    "ngay_vao_vien": "",
    "ngay_ra_vien": "",
    "so_benh_an": ""
  },
  "chan_doan_chinh": "",
  "ly_do_vao_vien": "",
  "tien_su_benh": "",
  "phau_thuat": {
    "ngay": "",
    "phuong_phap": "",
    "ket_qua": "",
    "bac_si_phau_thuat": ""
  },
  "dien_bien_lam_sang": [
    {"ngay": "", "mo_ta": "", "loai": "binh_thuong|bat_thuong|canh_bao", "phase": "truoc_mo|sau_mo|tai_kham"}
  ],
  "xet_nghiem_key": [
    {
      "key": "Tên chỉ số (ví dụ HGB, CRP, INR, EF...)",
      "val": "Giá trị kèm đơn vị (ví dụ 116 g/L)",
      "rawVal": 116,
      "unit": "g/L",
      "desc": "Mô tả ngắn (ví dụ Hemoglobin)",
      "normal": "Khoảng bình thường (ví dụ 130-172)",
      "status": "normal|high|low",
      "ngay": "Ngày xét nghiệm gần nhất",
      "phase": "truoc_mo|sau_mo|tai_kham",
      "trend": [/* mảng rawVal theo thời gian từ cũ đến mới, nếu có nhiều lần đo */]
    }
  ],
  "sieu_am_tim": {
    "lan_kham": [
      {
        "ngay": "Ngày siêu âm (BẮT BUỘC ghi rõ từng lượt)",
        "nguon": "Nguồn (MINERVA PACS, HIS Doppler...)",
        "chan_doan": "Chẩn đoán trên siêu âm",
        "ef": 0,
        "grad_max": 0,
        "grad_tb": 0,
        "hoc": "Mức độ hở van ĐMC",
        "phase": "truoc_mo|sau_mo|hoi_phuc|tai_kham",
        "ghi_chu": "Ghi chú đặc biệt (dịch màng tim, ép thất phải...)",
        "canh_bao": false,
        "latest": false
      }
    ]
  },
  "canh_bao_nguy_co": [
    {"mo_ta": "", "muc_do": "thap|trung_binh|cao", "can_cu": ""}
  ],
  "thuoc_cuoi_ky": [
    {"ten_thuoc": "", "lieu": "", "cach_dung": ""}
  ],
  "dau_hieu_sinh_ton": {
    "ngay": "", "ha_tt": 0, "ha_ttr": 0, "mach": 0,
    "nhiet_do": 0.0, "nhip_tho": 0, "spo2": 0, "lactate": 0.0
  },
  "ket_luan_giai_doan": {
    "1": "Kết luận ngắn giai đoạn trước mổ (chỉ định, chức năng nền)",
    "2": "Kết luận ngắn giai đoạn hậu phẫu nội trú (kết quả mổ, biến chứng, diễn biến)",
    "3": "Kết luận ngắn giai đoạn ngoại trú (đáp ứng, vấn đề còn theo dõi)"
  },
  "clinical_takeaway": [
    {"txt": "Nhận định cấp cao, mỗi ý 1 câu", "loai": "good|watch"}
  ],
  "ly_luan_lam_sang": [
    {"muc": "critical|warning|info", "phase": 2, "tieu_de": "Tên cụm reasoning",
     "noi_dung": "Suy luận đa biến: nhiều chỉ số cùng thời điểm tạo thành một bệnh cảnh, kèm bối cảnh giai đoạn"}
  ],
  "problem_status": {
    "hien_tai": [{"ten": "Vấn đề đang tồn tại", "trang_thai": "active|monitoring", "mo_ta": ""}],
    "da_qua": [{"ten": "Biến cố quan trọng đã hồi phục", "mo_ta": "kèm ngày và kết cục"}]
  },
  "hanh_dong_uu_tien": [
    {"uu_tien": 1, "viec": "Việc cần làm ở lần tái khám tới", "ly_do": "lý do hiện tại, không dựa vào yếu tố đã kết thúc"}
  ],
  "tom_tat_toan_canh": ""
}

QUY TẮC BỔ SUNG VỀ DẤU HIỆU SINH TỒN (BẮT BUỘC):
11. dau_hieu_sinh_ton: trích các giá trị GẦN NHẤT có trong hồ sơ (huyết áp, mạch,
    nhiệt độ, nhịp thở, SpO2, lactate). Nếu không có chỉ số nào, điền null cho riêng
    chỉ số đó. KHÔNG tự đánh giá hay kết luận, chỉ trích số.

TƯ DUY LÂM SÀNG VÀ DÒNG THỜI GIAN (BẮT BUỘC - cực kỳ quan trọng cho uy tín chuyên môn):
12. PHÂN LOẠI BỆNH NHÂN: dựa vào ngay_ra_vien. Nếu có ngày ra viện và đã qua ngày đó thì
    bệnh nhân là Ngoại trú (đang theo dõi tái khám). Nếu chưa có ngày ra viện thì là Nội trú.
13. BA GIAI ĐOẠN BẮT BUỘC: mỗi item trong xet_nghiem_key, sieu_am_tim.lan_kham, va
    dien_bien_lam_sang phải gán field "phase" thuộc một trong:
    - "truoc_mo": trước can thiệp/phẫu thuật
    - "sau_mo": sau can thiệp, còn trong viện (trước ngày ra viện)
    - "tai_kham": từ ngày ra viện trở đi (ngoại trú/theo dõi)
    Căn cứ ngày của chỉ số so với ngày phẫu thuật và ngày ra viện để gán đúng.
14. CẤM trộn chỉ số sau mổ hoặc lúc ra viện vào nhóm "truoc_mo".
15. TÓM TẮT TOÀN CẢNH (tom_tat_toan_canh): viết theo ĐÚNG TRÌNH TỰ THỜI GIAN TĂNG DẦN,
    không được đảo mốc sau lên trước. Nêu mốc tương đối khi hữu ích (ví dụ "ngày thứ 5
    sau mổ", "tháng thứ 2 sau ra viện"). BẮT BUỘC chia làm 3 phần, mỗi phần MỞ ĐẦU bằng
    đúng các nhãn sau (viết hoa, có dấu hai chấm) để giao diện tách khối:
    "GIAI ĐOẠN TRƯỚC MỔ:" rồi tới "GIAI ĐOẠN SAU MỔ - NỘI TRÚ:" rồi tới
    "GIAI ĐOẠN NGOẠI TRÚ - TÁI KHÁM:". Trong mỗi phần trình bày: lý do vào viện và cận
    lâm sàng (phần 1); can thiệp, kết quả và diễn biến hậu phẫu tới khi ra viện (phần 2);
    kết quả tái khám và vấn đề cần quan tâm nhất hiện tại (phần 3). Nếu bệnh nhân chưa ra
    viện thì bỏ phần 3 và ghi rõ đang nội trú ngày thứ mấy sau mổ.
16. BỐI CẢNH HÓA CHỈ SỐ THEO GIAI ĐOẠN: không đánh giá cao/thấp một cách máy móc.
    - NT-proBNP tăng ngay sau mổ (sau_mo) là phản ứng thường gặp, KHÔNG bật cảnh báo cao.
      Nhưng nếu vẫn cao ở giai đoạn tai_kham thì BẬT cảnh báo suy giảm chức năng tim.
    - Nhóm các bất thường trong CÙNG MỘT NGÀY thành 1 cảnh báo tổng hợp (ví dụ hạ Natri +
      rối loạn nhịp + suy thận cấp -> 1 cảnh báo), không tách lẻ.
17. SỬA LỖI CHUYÊN MÔN CỨNG (tuyệt đối tuân thủ):
    - EF >= 50% là chức năng tâm thu BÌNH THƯỜNG/TỐT: status="normal", CẤM gán "high" hay
      coi là cảnh báo. EF 71% là tốt. Chỉ cảnh báo khi EF GIẢM (< 50%).
    - INR ở bệnh nhân VAN CƠ HỌC: mục tiêu điều trị là 2.0-3.0 (KHÔNG phải 0.8-1.2 của
      người thường). Với các bệnh nhân này: normal="2.0-3.0"; INR 2.0-3.0 -> status="normal"
      (trong mục tiêu); < 2.0 -> status="low" (dưới mục tiêu, nguy cơ huyết khối);
      > 3.0 -> status="high" (trên mục tiêu, nguy cơ chảy máu). Nhận biết van cơ học qua
      chẩn đoán/phẫu thuật có cụm "van cơ học", "On-X", "St Jude", "thay van".
18. RÀO CHẮN KÊ ĐƠN (trong canh_bao_nguy_co nếu liên quan): khi hồ sơ có thuốc cần lưu ý
    theo bệnh nền/xét nghiệm, ghi rõ. Ví dụ Dapagliflozin tốt cho suy tim nhưng nếu có hạ
    Natri máu thì nêu lưu ý thận trọng hạ Natri.
19. eGFR: nếu có Creatinin, tuổi, giới thì tính sẵn và nêu công thức CKD-EPI 2021 cùng các
    biến số đầu vào trong tóm tắt. Không để eGFR null nếu đủ dữ liệu.
20. KẾT LUẬN TỪNG GIAI ĐOẠN (ket_luan_giai_doan): mỗi giai đoạn 1 đến 2 câu súc tích, đúng
    bối cảnh. Nếu bệnh nhân chưa qua một giai đoạn nào thì để chuỗi rỗng cho giai đoạn đó.
21. CLINICAL TAKEAWAY (clinical_takeaway): 3 đến 5 nhận định cấp cao giúp bác sĩ hiểu nhanh,
    loai="good" cho điều thuận lợi, loai="watch" cho điều cần theo dõi.
22. LÝ LUẬN LÂM SÀNG ĐA BIẾN (ly_luan_lam_sang): tạo các cụm suy luận kết hợp NHIỀU chỉ số
    cùng thời điểm thành một bệnh cảnh (không tách lẻ), gán muc và phase. Diễn giải theo
    giai đoạn (ví dụ NT-proBNP tăng ngay sau mổ thì không kết luận suy tim mạn).
23. TRẠNG THÁI VẤN ĐỀ (problem_status): tách "hien_tai" (vấn đề đang tồn tại, trang_thai
    active hoặc monitoring) với "da_qua" (biến cố quan trọng đã hồi phục). Giúp phân biệt
    việc cần xử lý hôm nay với biến cố lịch sử.
24. HÀNH ĐỘNG ƯU TIÊN (hanh_dong_uu_tien): các việc cụ thể cần làm ở lần khám tới, đánh số
    ưu tiên, kèm lý do HIỆN TẠI (không viện dẫn yếu tố đã kết thúc như kháng sinh ngắn ngày).
25. Tất cả field ở mục 20 đến 24 là TÙY hồ sơ: nếu hồ sơ không đủ dữ liệu cho field nào thì
    để mảng rỗng hoặc bỏ qua, KHÔNG bịa."""

CHAT_SYSTEM = """Bạn là trợ lý y tế hỗ trợ bác sĩ Việt Nam. Bạn có đầy đủ hồ sơ bệnh nhân.

QUY TẮC NỘI DUNG:
1. Chỉ trả lời dựa trên thông tin TRONG hồ sơ được cung cấp
2. Nếu không có thông tin: nói rõ "Không tìm thấy trong hồ sơ"
3. Trích dẫn nguồn cụ thể (trang/phiếu nào) khi có thể
4. Ngắn gọn, trực tiếp — bác sĩ cần thông tin nhanh
5. KHÔNG đưa ra lời khuyên điều trị mới ngoài hồ sơ

QUY TẮC ĐỊNH DẠNG (bắt buộc, vì khung chat hiển thị dạng văn bản đơn giản):
6. TUYỆT ĐỐI KHÔNG dùng bảng markdown (không dùng ký tự "|" để kẻ bảng). Khung chat
   không kẻ được bảng nên sẽ hiện ra một mớ dấu gạch lộn xộn.
7. Khi cần liệt kê nhiều mốc/giá trị, dùng gạch đầu dòng, mỗi dòng một ý, ví dụ:
   "- 29/09: CRP 241 mg/L (đỉnh, phản ứng viêm mạnh)". Diễn tiến theo thời gian thì
   liệt kê từng dòng như vậy, KHÔNG kẻ bảng.
8. KHÔNG dùng emoji. Có thể dùng chữ in đậm bằng dấu ** cho từ khóa quan trọng.
9. Trả lời bằng tiếng Việt, không dùng dấu gạch ngang dài, thay bằng "đến" hoặc "-"."""

# BƯỚC 3: Diễn đạt diễn tiến. Claude CHỈ được dựa trên các mốc chênh lệch (delta)
# mà rule engine đã trích, KHÔNG tự bịa, KHÔNG tự đánh giá tương tác thuốc.
TREND_SYSTEM = """Bạn là trợ lý y tế. Dưới đây là các mốc chênh lệch chỉ số xét nghiệm
qua các ngày, đã được hệ thống trích sẵn. Nhiệm vụ của bạn CHỈ là diễn đạt thành câu
kết luận ngắn gọn về DIỄN TIẾN, dựa hoàn toàn vào các con số được cung cấp.

QUY TẮC:
1. Nếu chỉ số viêm (CRP, WBC) giảm liên tục: kết luận "Đáp ứng điều trị tốt, tình trạng cải thiện".
2. Nếu Creatinine tăng trên 50 phần trăm trong 48 giờ: kết luận "Thận xấu đi, nguy cơ AKI".
3. Nếu EF tăng: kết luận "Chức năng tim đang hồi phục".
4. KHÔNG bịa thông tin, KHÔNG thêm số liệu ngoài dữ liệu được cung cấp.
5. Mỗi câu nêu rõ con số mốc đầu và mốc cuối. Trả về 1 đến 3 câu, văn phong lâm sàng.
6. KHÔNG tự đánh giá tương tác thuốc hay đưa khuyến cáo điều trị mới."""

# ─── HELPERS ────────────────────────────────────────────────────────────────

# Ngưỡng ký tự tối thiểu để coi 1 trang là "có text thật"
MIN_CHARS_PER_PAGE = 40
# Tổng ký tự tối thiểu để coi cả file là text PDF (đọc được)
MIN_TOTAL_CHARS = 200
# ─── Giới hạn để phân tích xong trong thời gian chờ (tránh timeout) ───────────
# Đường gửi chữ (/analyze_text) không còn nghẽn upload, nên nới rộng để hồ sơ dày
# đi được nhiều hơn. Vẫn cắt để Claude sinh JSON không quá lâu.
MAX_PAGES = 120
MAX_TEXT_CHARS = 120_000


def extract_text_from_pdf(pdf_path: str) -> dict:
    """
    Trích xuất text từ PDF bằng pypdf (nhẹ RAM, đọc từng trang theo luồng).

    HIS export là PDF text thuần nên đọc text layer là đủ, chính xác 100% ký tự gốc.
    Không dùng OCR (OCR dựng ảnh rất tốn RAM, dễ làm sập host nhỏ). Nếu file là bản
    scan không có text layer, total_chars sẽ rất thấp và endpoint sẽ báo lỗi rõ ràng.

    Trả về dict:
      {
        "text": str, "pages": int, "method": "text",
        "ocr_pages": [], "total_chars": int,
        "truncated": bool,      # bị cắt do quá nhiều trang hoặc quá dài
        "empty_pages": int      # số trang không có text layer
      }
    """
    reader = PdfReader(pdf_path)
    n_pages = len(reader.pages)
    pages_to_read = min(n_pages, MAX_PAGES)

    parts = []
    acc = 0
    empty_pages = 0
    truncated_chars = False

    for i in range(pages_to_read):
        try:
            text = (reader.pages[i].extract_text() or "").strip()
        except Exception:
            text = ""
        if len(text) < MIN_CHARS_PER_PAGE:
            empty_pages += 1
        part = f"{'='*40}\nTRANG {i+1}\n{'='*40}\n{text}"
        if acc + len(part) > MAX_TEXT_CHARS:
            remain = max(0, MAX_TEXT_CHARS - acc)
            if remain > 0:
                parts.append(part[:remain])
            truncated_chars = True
            break
        parts.append(part)
        acc += len(part) + 2

    full_text = "\n\n".join(parts)
    if truncated_chars:
        full_text += "\n\n[... hồ sơ quá dài, đã cắt bớt phần sau ...]"

    return {
        "text": full_text,
        "pages": n_pages,
        "method": "text",
        "ocr_pages": [],
        "total_chars": acc,
        "truncated": truncated_chars or (n_pages > MAX_PAGES),
        "empty_pages": empty_pages,
    }


def call_claude(system: str, user_message: str, max_tokens: int = 4000,
                 cache_system: bool = False) -> str:
    """Call Claude API.

    cache_system=True: đánh dấu block `system` để Anthropic cache lại (ephemeral,
    TTL ~5 phút). REPORT_SYSTEM dài và LẶP LẠI Y NGUYÊN ở mọi lần phân tích hồ sơ
    -> ứng viên đúng cho caching. Lần đầu trong 5 phút tốn phí ghi cache (đắt hơn
    input thường một chút), các lần sau trong cùng cửa sổ chỉ tốn phí đọc cache
    (giảm ~90% so với input thường). Nếu traffic quá thưa (>5 phút/lần phân tích)
    thì cache hết hạn trước khi dùng lại -> không có lợi, nhưng cũng không lỗ vì
    Anthropic tự fallback xử lý như bình thường.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY chưa được cấu hình")

    client = anthropic.Anthropic(api_key=api_key)

    if cache_system:
        system_param = [{
            "type": "text",
            "text": system,
            "cache_control": {"type": "ephemeral"},
        }]
    else:
        system_param = system

    response = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=max_tokens,
        system=system_param,
        messages=[{"role": "user", "content": user_message}]
    )
    return response.content[0].text


# ─── ROUTES ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "mediflow-ai",
        "model": "claude-haiku-4-5",
        "pdf_engine": "pypdf",
    }


import unicodedata

def _strip_accents(s: str) -> str:
    """Bỏ dấu tiếng Việt + viết thường, để khớp từ khóa bất kể có dấu hay không."""
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    ).lower()

# Từ khóa tín hiệu lâm sàng (đã bỏ dấu, chữ thường). Mỗi từ khóa khác nhau trên
# một trang cộng 1 điểm MẬT ĐỘ (xem _page_score). Tấn và Ngân có thể bổ sung.
STRONG_KEYWORDS = [
    # tóm tắt / chẩn đoán / diễn biến / ra vào viện
    "chan doan", "tom tat", "benh su", "tien su", "dien bien", "qua trinh benh",
    "vao vien", "nhap vien", "ra vien", "xuat vien", "ket luan", "huong dieu tri",
    "phau thuat", "thu thuat", "tuong trinh",
    # cận lâm sàng
    "sieu am", "xet nghiem", "x quang", "x-quang", "cat lop", "cong huong tu",
    "dien tim", "ecg", "phan suat tong mau", "lvef",
    # chỉ số xét nghiệm
    "crp", "inr", "probnp", "bnp", "troponin", "creatinin", "egfr", "ure",
    "natri", "kali", "clo", "glucose", "hba1c", "bach cau", "tieu cau",
    "huyet sac to", "ast", "alt", "bilirubin", "dong mau", "aptt", "d-dimer",
    # thuốc
    "don thuoc", "y lenh", "lieu dung", "khang sinh", "chong dong",
    # tim mạch (bối cảnh ca van tim)
    "van dong mach", "van hai la", "van dmc", "tran dich", "mang ngoai tim",
    "suy tim", "hep van", "ho van", "ep tim",
]

# Từ khóa BIẾN CỐ CẤP TÍNH: trọng số RẤT CAO, cộng thẳng (không chuẩn hóa theo
# độ dài trang) — để 1 trang NGẮN ghi nhận biến cố cấp vẫn luôn được giữ, dù
# các trang "phiếu chăm sóc" lặp lại dài hơn và có nhiều STRONG_KEYWORDS hơn
# về số lượng thô. ĐÃ PHÁT HIỆN qua test mô phỏng 500 trang: nếu không có cơ
# chế này, 1 trang ghi "đột ngột tụt huyết áp, gọi cấp cứu" (ngắn, ít từ khóa)
# bị loại khỏi 120k budget vì thua điểm các trang dài lặp lại sinh hiệu bình
# thường. Đây là RỦI RO AN TOÀN THẬT, không phải lý thuyết. Tấn/Ngân rà soát
# và bổ sung thêm từ khóa biến cố cấp khác khi gặp ca thật.
CRITICAL_EVENT_KEYWORDS = [
    "dot ngot", "cap cuu", "soc", "ngung tim", "ngung tho", "hon me",
    "suy ho hap cap", "tut huyet ap", "ngat", "co giat", "xuat huyet cap",
    "phu phoi cap", "roi loan nhip nguy hiem", "rung that", "vo tam thu",
    "tu vong", "bao dong", "khan cap", "nguy kich", "chuyen ho suc cap cuu",
]
CRITICAL_EVENT_WEIGHT = 50  # đủ lớn để luôn vượt điểm mật độ của trang dài thường


def _split_pages(text: str):
    """Tách hồ sơ thành danh sách trang dựa trên marker 'TRANG <số>'.
    Nhận cả 2 dạng marker: '==== TRANG 5 ====' (client) và viền '=' nhiều dòng (server)."""
    header_re = re.compile(r"^\s*=*\s*TRANG\s+\d+\s*=*\s*$", re.IGNORECASE)
    eq_re = re.compile(r"^\s*=+\s*$")
    pages, cur = [], []
    for ln in text.split("\n"):
        if header_re.match(ln):
            if cur:
                pages.append("\n".join(cur).strip())
            cur = [ln]
        elif eq_re.match(ln):
            continue  # dòng viền '=' của marker, bỏ khỏi nội dung
        else:
            cur.append(ln)
    if cur:
        pages.append("\n".join(cur).strip())
    return [p for p in pages if p.strip()]


def _page_score(page_text: str) -> float:
    """
    Điểm ưu tiên của 1 trang khi cần cắt hồ sơ quá dài (xem select_relevant_text).

    THIẾT KẾ (đã sửa sau khi phát hiện lỗ hổng an toàn qua test mô phỏng 500
    trang): điểm thô đếm số từ khóa khớp (cách CŨ) khiến trang DÀI LẶP LẠI
    (vd phiếu chăm sóc hàng ngày, nhiều câu khuôn mẫu chứa "mạch", "huyết áp"…)
    luôn thắng trang NGẮN nhưng quan trọng (vd 1 dòng ghi nhận biến cố cấp cứu)
    — vì trang dài tự nhiên chứa nhiều từ khóa hơn về số lượng thô, dù tỷ lệ
    tín hiệu/nội dung thực ra thấp hơn.

    Sửa bằng 2 thành phần cộng lại:
      1. Mật độ = (số từ khóa khớp trong STRONG_KEYWORDS) / (số từ trong trang),
         nhân hệ số 100 để có thang số dễ đọc. Trang ngắn, súc tích, đúng trọng
         tâm sẽ có mật độ cao hơn trang dài lan man dù số khớp thô ít hơn.
      2. Cộng thẳng CRITICAL_EVENT_WEIGHT cho MỖI từ khóa biến cố cấp tính khớp
         được — KHÔNG chia theo độ dài, để đảm bảo các trang này luôn nổi lên
         đầu danh sách ưu tiên bất kể trang dài hay ngắn.
    """
    t = _strip_accents(page_text)
    n_words = max(1, len(t.split()))
    strong_hits = sum(1 for kw in STRONG_KEYWORDS if kw in t)
    density_score = (strong_hits / n_words) * 100
    critical_hits = sum(1 for kw in CRITICAL_EVENT_KEYWORDS if kw in t)
    critical_score = critical_hits * CRITICAL_EVENT_WEIGHT
    return density_score + critical_score

def select_relevant_text(full_text: str, budget: int):
    """
    Hồ sơ nhỏ (<= budget): giữ nguyên.
    Hồ sơ lớn: luôn giữ vài trang đầu (tóm tắt, chẩn đoán) và cuối (ra viện),
    rồi chọn thêm các trang có tín hiệu lâm sàng cao nhất cho tới khi đầy budget,
    cuối cùng SẮP LẠI theo thứ tự trang gốc để giữ đúng dòng thời gian.
    Trả về (text_đã_lọc, meta).
    """
    pages = _split_pages(full_text)
    if not pages:
        return full_text[:budget], {"filtered": False, "pages_total": 0, "pages_kept": 0}

    n = len(pages)
    if len("\n\n".join(pages)) <= budget:
        return full_text, {"filtered": False, "pages_total": n, "pages_kept": n}

    HEAD, TAIL = 6, 4  # luôn giữ trang đầu/cuối (thường là tóm tắt và giấy ra viện)
    always = set(range(min(HEAD, n))) | set(range(max(0, n - TAIL), n))
    selected = set(always)
    acc = sum(len(pages[i]) + 2 for i in selected)

    # Thêm trang điểm cao nhất cho tới khi gần đầy budget
    for i in sorted(range(n), key=lambda k: _page_score(pages[k]), reverse=True):
        if i in selected or _page_score(pages[i]) <= 0:
            continue
        need = len(pages[i]) + 2
        if acc + need > budget:
            continue
        selected.add(i)
        acc += need

    kept = sorted(selected)
    out = "\n\n".join(pages[i] for i in kept)
    if len(out) > budget:
        out = out[:budget]
    return out, {"filtered": True, "pages_total": n, "pages_kept": len(kept)}


def run_analysis_pipeline(ho_so_text: str, pages: int = 0,
                          method: str = "text", ocr_pages=None) -> JSONResponse:
    """
    Chạy Bước 1-3 từ TEXT hồ sơ đã có (không đụng tới file PDF).
    Dùng chung cho cả /analyze (bóc text ở server) và /analyze_text (text gửi từ client).
    """
    if ocr_pages is None:
        ocr_pages = []

    # Hồ sơ rất dày: lọc giữ trang có nội dung lâm sàng thay vì cắt cụt phần đầu.
    ho_so_text, filter_meta = select_relevant_text(ho_so_text, MAX_TEXT_CHARS)

    if len(ho_so_text.strip()) < MIN_TOTAL_CHARS:
        return JSONResponse({
            "success": False,
            "error": "Không có đủ nội dung text để phân tích. File có thể là bản scan "
                     "(ảnh chụp) không có lớp text. Hãy dùng bản PDF xuất trực tiếp từ HIS.",
            "meta": {"pages": pages, "method": method},
        }, status_code=422)

    raw = ""
    try:
        # ─── BƯỚC 1 (LLM Extraction): Claude đọc -> JSON thuần, KHÔNG đánh giá ───
        raw = call_claude(
            system=REPORT_SYSTEM,
            user_message=f"Hồ sơ bệnh nhân:\n\n{ho_so_text}",
            max_tokens=16000,
            cache_system=True,
        )

        # Bóc JSON chắc chắn: bỏ code fence, lấy từ '{' đầu tiên đến '}' cuối cùng
        json_text = raw.strip()
        if "```json" in json_text:
            json_text = json_text.split("```json")[1].split("```")[0]
        elif "```" in json_text:
            json_text = json_text.split("```")[1].split("```")[0]
        json_text = json_text.strip()
        start, end = json_text.find("{"), json_text.rfind("}")
        if start != -1 and end != -1 and end > start:
            json_text = json_text[start:end + 1]

        try:
            report = json.loads(json_text)
        except json.JSONDecodeError:
            return JSONResponse({
                "success": False,
                "error": "Hồ sơ quá dài nên kết quả AI bị cắt, chưa tạo được JSON hoàn chỉnh. "
                         "Hãy thử lại, hoặc tách bớt số trang hồ sơ.",
            }, status_code=200)

        # ─── BƯỚC 2 (Python Rule Engine): code thuần, KHÔNG dùng AI ──────────────
        engine = clinical_rules.evaluate(report)

        # ─── BƯỚC 3 (LLM Interpretation): Claude diễn đạt diễn tiến từ trend_facts ─
        trend_summary = ""
        if engine["trend_facts"]:
            try:
                trend_summary = call_claude(
                    system=TREND_SYSTEM,
                    user_message="Các mốc chênh lệch chỉ số (chỉ diễn đạt, không bịa thêm):\n"
                                 + json.dumps(engine["trend_facts"], ensure_ascii=False),
                    max_tokens=400
                ).strip()
            except Exception:
                trend_summary = ""

        return JSONResponse({
            "success": True,
            "report": report,
            "ho_so_text": ho_so_text,  # Dùng cho chatbot
            "analysis": {
                "egfr": engine["egfr"],
                "egfr_detail": engine.get("egfr_detail"),
                "priority_findings": engine["priority_findings"],
                "drug_safety": engine["drug_safety"],
                "trend_summary": trend_summary,
                "risk_scores": engine.get("risk_scores"),
                "ttr": engine.get("ttr"),
                "care_gaps": engine.get("care_gaps"),
            },
            "meta": {"pages": pages, "method": method, "ocr_pages": ocr_pages,
                     "filtered": filter_meta.get("filtered", False),
                     "pages_total": filter_meta.get("pages_total", 0),
                     "pages_kept": filter_meta.get("pages_kept", 0)},
        })

    except json.JSONDecodeError:
        return JSONResponse({
            "success": False,
            "error": "Không thể parse kết quả AI",
            "raw": raw[:500],
        }, status_code=500)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze")
async def analyze_record(file: UploadFile = File(...)):
    """
    Upload hồ sơ → bóc text → phân tích.
    Hỗ trợ: PDF (pypdf), Word .docx, Excel .xlsx, PowerPoint .pptx
    (python-docx/openpyxl/python-pptx — text trích trực tiếp, không qua OCR).

    CHƯA hỗ trợ: ảnh (.png/.jpg — cần OCR thật, để dành giai đoạn 2 theo đúng
    định hướng ban đầu của REPORT_SYSTEM), và .doc/.xls/.ppt định dạng cũ
    (không phải Open XML, cần thư viện khác). Các loại này trả lỗi 400 RÕ
    NGHĨA "chưa hỗ trợ định dạng X" — không phải lỗi server chung, để FE hiển
    thị đúng nguyên nhân cho người dùng.

    File lớn (PDF) nên dùng /analyze_text (bóc chữ ở trình duyệt qua pdf.js).
    """
    filename_lower = file.filename.lower()
    ext = "." + filename_lower.rsplit(".", 1)[-1] if "." in filename_lower else ""

    if ext == ".pdf":
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
        try:
            extracted = extract_text_from_pdf(tmp_path)
            return run_analysis_pipeline(
                extracted["text"],
                pages=extracted["pages"],
                method=extracted["method"],
                ocr_pages=extracted["ocr_pages"],
            )
        finally:
            os.unlink(tmp_path)

    if ext in document_extract.EXTRACTORS:
        content = await file.read()
        text, warning, _ = document_extract.extract_from_filename(file.filename, content)
        if not text.strip():
            raise HTTPException(
                status_code=400,
                detail=warning or f"Không trích được nội dung từ file {ext}.",
            )
        return run_analysis_pipeline(text, pages=0, method=f"doc-extract{ext}", ocr_pages=[])

    if ext in document_extract.UNSUPPORTED_BUT_LISTED_IN_UI:
        if ext in (".png", ".jpg", ".jpeg"):
            raise HTTPException(
                status_code=400,
                detail="Ảnh chụp/scan cần OCR — tính năng này đang phát triển "
                       "(giai đoạn 2). Hiện tại hệ thống đọc được PDF, Word "
                       "(.docx), Excel (.xlsx) và PowerPoint (.pptx).",
            )
        raise HTTPException(
            status_code=400,
            detail=f"Định dạng {ext} (phiên bản cũ) chưa được hỗ trợ. "
                   f"Vui lòng lưu lại dưới định dạng mới (.docx/.xlsx/.pptx) rồi tải lên.",
        )

    raise HTTPException(
        status_code=400,
        detail=f"Không nhận diện được định dạng file {ext or '(không có đuôi)'}. "
               f"Hỗ trợ: PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx).",
    )


class AnalyzeTextRequest(BaseModel):
    ho_so_text: str
    pages: int = 0


@app.post("/analyze_text")
async def analyze_text(req: AnalyzeTextRequest):
    """
    Nhận TEXT hồ sơ (đã bóc ở trình duyệt) → phân tích.
    Dành cho file lớn: chỉ gửi vài trăm KB chữ thay vì cả file nặng, nên không bị
    nghẽn ở giới hạn dung lượng upload của proxy.
    """
    return run_analysis_pipeline(req.ho_so_text, pages=req.pages, method="client_text")


class ChatRequest(BaseModel):
    question: str
    ho_so_text: str  # Toàn bộ text hồ sơ làm context
    chat_history: list = []  # Previous messages


@app.post("/chat")
async def chat(request: ChatRequest):
    """
    Chat với AI về hồ sơ bệnh nhân.

    THIẾT KẾ CACHE: ho_so_text (~7.000 token, theo ước tính chi phí) được đưa vào
    block `system` thay vì nối vào nội dung câu hỏi như trước, vì Prompt Caching
    của Anthropic chỉ cache được phần đặt trong `system` (hoặc đầu `messages`),
    không cache được text nối tay vào giữa 1 message. Đưa ho_so_text vào system
    cũng hợp lý hơn về ngữ nghĩa: đây là CONTEXT CỐ ĐỊNH cho cả cuộc hội thoại,
    không phải nội dung bác sĩ gõ ra mỗi lượt.
    Hệ quả: nếu bác sĩ hỏi nhiều câu liên tiếp về CÙNG một bệnh nhân trong vòng
    ~5 phút (TTL cache), từ câu hỏi thứ 2 trở đi chỉ tốn phí đọc cache (~giảm 90%)
    cho phần hồ sơ, đúng với giả lập "Dung lượng ngữ cảnh tái sử dụng" đã nêu
    trong proposal GTM.
    """
    # messages chỉ chứa câu hỏi + lịch sử hội thoại (KHÔNG nhúng hồ sơ vào đây
    # nữa, để giữ system ổn định -> cache mới khớp được giữa các lượt).
    messages = []
    for msg in request.chat_history[-6:]:  # Giữ 3 turns gần nhất
        messages.append(msg)
    messages.append({"role": "user", "content": request.question})

    system_with_context = (
        f"{CHAT_SYSTEM}\n\n---\nHồ sơ bệnh nhân (dùng để trả lời các câu hỏi "
        f"tiếp theo):\n{request.ho_so_text}"
    )

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY chưa được cấu hình")

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=1000,
        system=[{
            "type": "text",
            "text": system_with_context,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=messages
    )

    answer = response.content[0].text
    
    return {
        "answer": answer,
        "tokens_used": response.usage.input_tokens + response.usage.output_tokens
    }


# ─── ECG (Mức 1: số hóa + vẽ lại) ────────────────────────────────────────────
# ĐỊNH VỊ AN TOÀN: chỉ trực quan hóa hỗ trợ, KHÔNG chẩn đoán. Không trả bất kỳ
# nhãn lâm sàng nào (không "AFib", không "nhịp chậm"...). FE hiển thị PHẢI kèm
# nhãn "cần bác sĩ xác nhận" cho mọi nội dung từ endpoint này.

class EcgDigitizeRequest(BaseModel):
    image_base64: str  # Ảnh ECG (PNG/JPG) đã encode base64, có hoặc không kèm data URI prefix


@app.post("/ecg")
async def ecg_digitize(request: EcgDigitizeRequest):
    """
    Nhận ảnh ECG (base64) -> số hóa Mức 1 (signal[]) + Mức 2 (ước lượng nhịp
    tim qua khoảng R-R) -> trả cho FE vẽ lại bằng SVG.
    KHÔNG xử lý ảnh ở client (OpenCV.js quá nặng, phá kiến trúc single-file FE) -
    mọi xử lý ảnh đều ở backend.

    MỨC 2 LUÔN LÀ ƯỚC LƯỢNG (uoc_luong=True trong heart_rate): tỉ lệ pixel/mm
    được tự suy ra từ lưới ảnh (estimate_px_per_mm), không phải đo trực tiếp.
    Nếu không tìm được lưới rõ, bpm_avg sẽ là None kèm warning rõ — KHÔNG bao
    giờ tự đoán đại 1 số để có vẻ "có kết quả".
    """
    img = ecg_engine.decode_base64_image(request.image_base64)
    if img is None:
        raise HTTPException(
            status_code=400,
            detail="Không đọc được ảnh. Kiểm tra lại định dạng base64 (PNG/JPG)."
        )
    result = ecg_engine.digitize_ecg_image(img)
    calib = ecg_engine.estimate_px_per_mm(img)
    r_peaks = ecg_engine.detect_r_peaks(result["signal"])
    heart_rate = ecg_engine.compute_heart_rate(r_peaks["rr_intervals_px"], calib["px_per_mm"])
    return {
        "success": True,
        **result,
        "calibration": calib,
        "r_peaks": r_peaks,
        "heart_rate": heart_rate,
        "disclaimer": "Kết quả số hóa và ước tính nhịp tim chỉ mang tính trực quan "
                       "hóa hỗ trợ, cần bác sĩ xác nhận. Không phải kết luận chẩn đoán. "
                       "Tỉ lệ pixel/mm được tự suy ra từ lưới ảnh — luôn là ƯỚC LƯỢNG, "
                       "không phải đo trực tiếp từ thước chuẩn.",
    }


@app.get("/ecg/synthetic")
async def ecg_synthetic_test(heart_rate_bpm: float = 75.0):
    """
    Sinh 1 ảnh ECG TỔNG HỢP (giả, không phải dữ liệu bệnh nhân thật) + số hóa
    + ước tính nhịp tim, để FE/Postman test pipeline /ecg trong lúc CHƯA CÓ
    ảnh thật từ anh Tấn. Trả cả ảnh (base64, để FE hiển thị "ảnh gốc") và kết
    quả số hóa + nhịp tim.

    heart_rate_bpm: nhịp tim mong muốn mô phỏng (mặc định 75 — nhịp xoang
    bình thường). Dùng để test xem pipeline Mức 2 có tính ra đúng số không
    (vd ?heart_rate_bpm=100 để test nhịp nhanh).
    """
    img = ecg_engine.generate_synthetic_ecg(heart_rate_bpm=heart_rate_bpm)
    img_b64 = ecg_engine.encode_image_to_base64_png(img)
    if img_b64 is None:
        raise HTTPException(status_code=500, detail="Không tạo được ảnh test.")
    result = ecg_engine.digitize_ecg_image(img)
    calib = ecg_engine.estimate_px_per_mm(img)
    r_peaks = ecg_engine.detect_r_peaks(result["signal"])
    heart_rate = ecg_engine.compute_heart_rate(r_peaks["rr_intervals_px"], calib["px_per_mm"])
    return {
        "success": True,
        "is_synthetic": True,
        "synthetic_target_bpm": heart_rate_bpm,
        "image_base64": img_b64,
        **result,
        "calibration": calib,
        "r_peaks": r_peaks,
        "heart_rate": heart_rate,
        "disclaimer": "Đây là ảnh ECG TỔNG HỢP (giả) dùng để test pipeline, "
                       "không phải dữ liệu bệnh nhân thật.",
    }
