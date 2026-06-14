"""
MediFlow AI - Backend FastAPI
Chạy: uvicorn main:app --reload --port 8000
"""
import os
import json
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
# Hồ sơ rất dày chỉ đọc phần đầu (kèm ghi chú). Cắt vừa phải để Claude sinh JSON
# nhanh, tránh vượt thời gian chờ của trình duyệt và proxy.
MAX_PAGES = 60
MAX_TEXT_CHARS = 80_000


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


def call_claude(system: str, user_message: str, max_tokens: int = 4000) -> str:
    """Call Claude API"""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY chưa được cấu hình")
    
    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=max_tokens,
        system=system,
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


@app.post("/analyze")
async def analyze_record(file: UploadFile = File(...)):
    """
    Upload PDF hồ sơ → trả về báo cáo JSON có cấu trúc
    """
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận file PDF")
    
    # Save to temp
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    
    try:
        # Step 1: Trích xuất text (ưu tiên text layer, OCR chỉ cho trang scan)
        extracted = extract_text_from_pdf(tmp_path)
        ho_so_text = extracted["text"]

        if extracted["total_chars"] < MIN_TOTAL_CHARS:
            return JSONResponse({
                "success": False,
                "error": "Không trích xuất được nội dung text từ PDF. File có thể là bản scan "
                         "(ảnh chụp) không có lớp text. Hãy dùng bản PDF xuất trực tiếp từ HIS "
                         "(dạng text), hoặc chuyển bản scan sang PDF có text trước khi tải lên.",
                "meta": {
                    "pages": extracted["pages"],
                    "method": extracted["method"],
                }
            }, status_code=422)

        # ─── BƯỚC 1 (LLM Extraction): Claude đọc -> JSON thuần, KHÔNG đánh giá ───
        # Haiku 4.5 cho tối đa 64000 token đầu ra. Đặt 16000 để hồ sơ dài
        # (kể cả 200 trang) không bị cắt giữa JSON. Tăng tiếp nếu vẫn thiếu.
        raw = call_claude(
            system=REPORT_SYSTEM,
            user_message=f"Hồ sơ bệnh nhân:\n\n{ho_so_text}",
            max_tokens=16000
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
            # Thường do JSON bị cắt vì hồ sơ quá dài. Báo lỗi rõ thay vì chung chung.
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

        # Trả về report (Bước 1) + kết quả rule engine (Bước 2) + diễn tiến (Bước 3)
        return JSONResponse({
            "success": True,
            "report": report,
            "ho_so_text": ho_so_text,  # Dùng cho chatbot
            "analysis": {                      # Kết quả rule engine (deterministic)
                "egfr": engine["egfr"],
                "egfr_detail": engine.get("egfr_detail"),
                "priority_findings": engine["priority_findings"],
                "drug_safety": engine["drug_safety"],
                "trend_summary": trend_summary,  # Bước 3 (AI diễn đạt)
            },
            "meta": {
                "pages": extracted["pages"],
                "method": extracted["method"],   # "text" | "ocr" | "hybrid"
                "ocr_pages": extracted["ocr_pages"],
            }
        })
    
    except json.JSONDecodeError:
        return JSONResponse({
            "success": False,
            "error": "Không thể parse kết quả AI",
            "raw": raw[:500]
        }, status_code=500)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)


class ChatRequest(BaseModel):
    question: str
    ho_so_text: str  # Toàn bộ text hồ sơ làm context
    chat_history: list = []  # Previous messages


@app.post("/chat")
async def chat(request: ChatRequest):
    """
    Chat với AI về hồ sơ bệnh nhân
    """
    # Build messages with history
    messages = []
    for msg in request.chat_history[-6:]:  # Giữ 3 turns gần nhất
        messages.append(msg)
    
    # Add current question with context
    user_msg = f"""Hồ sơ bệnh nhân:
{request.ho_so_text}

---
Câu hỏi của bác sĩ: {request.question}"""
    
    messages.append({"role": "user", "content": user_msg})
    
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY chưa được cấu hình")
    
    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=1000,
        system=CHAT_SYSTEM,
        messages=messages
    )
    
    answer = response.content[0].text
    
    return {
        "answer": answer,
        "tokens_used": response.usage.input_tokens + response.usage.output_tokens
    }
