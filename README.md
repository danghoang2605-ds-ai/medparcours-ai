# MedParcours AI

**Trợ lý AI đọc và phân tích hồ sơ bệnh án cho bác sĩ Việt Nam.**

HackAIthon 2026 — Bảng B Challenger, Đề tài 5: Y tế — Team **UN1SVENGERS**

> Mọi cảnh báo, điểm số, kết quả số hóa trong sản phẩm này là **hỗ trợ quyết
> định**, không tự chẩn đoán hoặc kê đơn. Luôn cần bác sĩ xác nhận trước khi
> áp dụng vào điều trị thật.

---

## Dành cho Ban Giám Khảo — đọc trước khi xem demo

### Vấn đề thật mà sản phẩm giải quyết

Bác sĩ tại bệnh viện Việt Nam thường phải đọc hồ sơ bệnh án dài hàng chục
đến hàng trăm trang (xuất ra từ HIS dưới dạng PDF) chỉ trong vài phút giữa 2
ca khám, dễ bỏ sót diễn biến quan trọng (xét nghiệm bất thường, tương tác
thuốc, biến cố cấp) nằm rải rác giữa các trang ghi chép thường quy.

**MedParcours AI** đọc toàn bộ hồ sơ, tự tổng hợp lại theo đúng trình tự lâm
sàng, và **chủ động nêu ra những gì cần chú ý** — không phải để bác sĩ đọc
thêm một bản tóm tắt do AI viết tự do, mà để bác sĩ nhìn thấy ngay các con số
đã được tính theo đúng công thức y khoa chuẩn.

### Vì sao kiến trúc khác với "chatbot tóm tắt PDF" thông thường

Điểm khác biệt cốt lõi: **mọi con số an toàn-tính mạng không bao giờ do AI tự
tính**. Hệ thống tách rõ 2 việc:

1. **AI (Claude) chỉ làm việc đọc hiểu** — trích xuất hồ sơ rời rạc thành dữ
   liệu có cấu trúc (chẩn đoán, xét nghiệm, thuốc, sinh hiệu...). Không được
   yêu cầu tự đánh giá hay tính toán bất cứ điều gì.
2. **Một bộ luật Python tất định (`backend/clinical_rules.py`)** — không qua
   AI — nhận dữ liệu đó và tính: eGFR theo công thức CKD-EPI 2021, thang
   điểm CHA2DS2-VASc/HAS-BLED, TTR (% thời gian INR trong đích điều trị),
   tương tác thuốc, chỉnh liều theo chức năng thận, và phát hiện khoảng
   trống dữ liệu theo guideline.

Nếu AI "tưởng tượng" sai 1 con số, hệ thống vẫn an toàn — vì con số quyết
định không đến từ AI. Đây là lý do chọn kiến trúc hybrid (AI + rule engine)
thay vì để 1 mô hình ngôn ngữ tự do trả lời mọi thứ.

### Demo nhanh trong 2 phút (không cần chuẩn bị gì)

1. Mở sản phẩm, đăng nhập bằng tài khoản demo có sẵn ngay trên màn hình.
2. Bấm **"Xem demo: hồ sơ Nguyễn Văn A"** — hệ thống hiện báo cáo đã phân
   tích sẵn cho 1 ca thật điển hình (sau thay van tim cơ học, đang dùng
   thuốc chống đông) — xem các Card: Thang điểm nguy cơ, Khoảng trống theo
   guideline, An toàn thuốc.
3. Bấm **"Quét điện tâm đồ"** ở màn hình tải hồ sơ, chọn 1 trong 2 ảnh mẫu
   thật có sẵn để xem ảnh ECG được số hóa lại và ước tính nhịp tim.
4. Mở MedAmi (chatbot) và hỏi bất kỳ câu gì về hồ sơ đang xem (vd "thuốc nào
   đang dùng?", "INR gần nhất là bao nhiêu?") — trả lời dựa đúng trên hồ sơ,
   không bịa thông tin ngoài.

### Những gì sản phẩm chưa làm được — nói thẳng, không che giấu

- Số hóa điện tâm đồ (ước tính nhịp tim từ ảnh) hoạt động tốt trên ảnh sạch,
  nhưng độ chính xác giảm rõ trên ảnh có nhiều nhiễu/lưới đậm. Đây đang là
  hướng cải thiện tiếp, không phải tính năng đã hoàn thiện 100%.
- Chưa tự động phát hiện loại nhịp bất thường cụ thể (rung nhĩ, ngoại tâm
  thu...) — chỉ nêu "nghi ngờ nhịp không đều, cần xác nhận", đúng với định
  hướng hỗ trợ, không chẩn đoán.
- Bộ từ khóa dò bệnh kèm theo (đái tháo đường, đột quỵ...) dựa trên cách ghi
  phổ biến trong hồ sơ tiếng Việt, có thể còn thiếu một số cách viết khác,
  cần thêm hồ sơ thật để hoàn thiện dần.

---

## Dành cho người dùng (bác sĩ) — sản phẩm dùng để làm gì

| Tính năng | Mô tả |
|---|---|
| Đọc hồ sơ đa định dạng | PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx) xuất từ HIS |
| Báo cáo tự động | Tóm tắt chẩn đoán, diễn biến, xét nghiệm theo đúng trình tự thời gian |
| Cảnh báo ưu tiên | Phân tầng mức độ cần xử trí ngay / theo dõi / ổn định |
| An toàn thuốc | Tương tác thuốc, chỉnh liều theo chức năng thận, trùng nhóm thuốc |
| Thang điểm nguy cơ | CHA2DS2-VASc, HAS-BLED (chống đông ở rung nhĩ) |
| TTR | % thời gian INR trong đích điều trị (theo dõi chống đông) |
| Khoảng trống guideline | Tự phát hiện dữ liệu/xét nghiệm còn thiếu so với khuyến cáo |
| MedAmi | Chatbot hỏi-đáp riêng theo từng hồ sơ đang xem |
| Quét điện tâm đồ | Số hóa lại ảnh ECG, ước tính nhịp tim |
| 3 chế độ xem | Bác sĩ điều trị / Hội chẩn đa chuyên khoa / Giảng dạy |
| Xuất báo cáo | In/lưu báo cáo đầy đủ, kèm ghi chú riêng của bác sĩ |

Đăng nhập demo: tài khoản và mật khẩu hiện sẵn ngay trên màn hình đăng nhập.

---

## Cấu trúc thư mục

```
medparcours-ai/
├── frontend/
│   ├── index.html
│   ├── src/
│   │   ├── App.jsx          Toàn bộ UI - React single-file, ~6900 dòng
│   │   └── main.jsx         Entry point (createRoot), tương đương main.jsx của Vite
│   └── public/
│       └── logos/           Logo nhà tài trợ/đơn vị - TỰ THÊM ẢNH VÀO ĐÂY
│                             (tên file phải khớp PARTNER_GROUPS trong App.jsx:
│                              hackaithon.png, hoi-sinh-vien.png, vietcombank.png,
│                              vnpt_ai.png, vsds.png)
├── backend/
│   ├── main.py               FastAPI - pipeline 3 bước
│   ├── clinical_rules.py     Rule engine tất định - KHÔNG qua LLM
│   ├── ecg_engine.py         Số hóa ảnh ECG (Mức 1 + Mức 2)
│   ├── document_extract.py   Trích text từ Word/Excel/PowerPoint
│   ├── test_main.py          Script test pytest (17 test)
│   ├── requirements.txt      Dependency production
│   └── requirements-dev.txt  + pytest, httpx (chỉ cho test)
├── docker/
│   ├── Dockerfile.backend
│   └── Dockerfile.frontend
├── docker-compose.yml
├── README.md
├── .env.example
├── .gitignore
└── medparcours_roadmap_v2.md   Kế hoạch kỹ thuật + business chi tiết
```

**Lưu ý logo:** thư mục `frontend/public/logos/` hiện chỉ có file `.gitkeep`
giữ chỗ — Đăng tự thêm ảnh thật vào sau. App.jsx đã tự ẩn ảnh lỗi (`onError`)
nên thiếu logo không làm vỡ giao diện, chỉ hiện ô placeholder có tên đơn vị.

---

## Cài đặt 1 lệnh (Docker)

Yêu cầu: Docker + Docker Compose đã cài sẵn trên máy.

```bash
cp .env.example .env
# Mở .env, điền ANTHROPIC_API_KEY=sk-ant-...

docker-compose up --build
```

Sau khi build xong (lần đầu mất vài phút):
- Frontend: http://localhost:8080
- Backend API: http://localhost:8000 (xem /docs cho danh sách endpoint)

Dừng: `docker-compose down`

Kiến trúc Docker chỉ gồm backend + frontend, không có service db — bản demo
dùng kiến trúc Pilot/Demo (xem medparcours_roadmap_v2.md mục 3.4), không lưu
trữ lịch sử lâu dài. Giai đoạn thương mại hóa thật (on-premise, có Postgres)
sẽ thêm sau, ngoài phạm vi demo Vòng 2 này.

**Lưu ý:** cả 2 Dockerfile dùng build context là **gốc repo** (không phải
thư mục `docker/`) — điều này đã cấu hình sẵn đúng trong `docker-compose.yml`
(`context: .`, `dockerfile: docker/Dockerfile.backend`), không cần sửa gì.

---

## Chạy không cần Docker (dev nhanh)

Backend:
```bash
cd backend
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn main:app --reload --port 8000
```

Frontend: sản phẩm thật chạy qua bản đã deploy GitHub Pages. Để tự build cục
bộ không qua Docker:
```bash
cd frontend
npm install esbuild react react-dom
npx esbuild src/main.jsx --bundle --loader:.jsx=jsx --jsx=automatic \
  --format=esm --outfile=main.js
# Mở index.html bằng 1 static server bất kỳ (vd: npx serve .)
```

---

## Script test tự động (pytest)

```bash
cd backend
pip install -r requirements-dev.txt
pytest test_main.py -v
```

17 test, mock Anthropic API (không tốn token thật, không cần mạng):
- /health, /analyze_text, /analyze (PDF/Word/Excel/PowerPoint), /chat, /ecg, /ecg/synthetic
- Thang điểm CHA2DS2-VASc/HAS-BLED, TTR, care-gap detector, trùng nhóm thuốc
- Hồi quy: câu phủ định ("không ghi nhận đái tháo đường") không bị tính nhầm
  thành dương tính — lỗi thật đã phát hiện và sửa trong quá trình phát triển
- Idempotent: chạy 3 lần liên tiếp không lỗi
- File hỏng/sai định dạng trả lỗi rõ nghĩa, không crash 500

---

## Kiến trúc pipeline backend (3 bước hybrid)

```
PDF / Word / Excel / PowerPoint
        |
        v
Trich text (pypdf / python-docx / openpyxl / python-pptx)
        |
        v
Buoc 1 (LLM): Claude doc -> JSON co cau truc (KHONG danh gia)
        |
        v
Buoc 2 (Rule Engine Python, clinical_rules.py): TAT DINH, khong LLM
  - eGFR (CKD-EPI 2021)         - An toan thuoc (tuong tac, chinh lieu, trung nhom)
  - CHA2DS2-VASc / HAS-BLED     - TTR (% thoi gian INR trong dich)
  - Care-gap detector (khoang trong theo guideline)
        |
        v
Buoc 3 (LLM): Claude dien dat xu huong (CHI tu delta rule engine, khong bia)
        |
        v
Bao cao co cau truc -> Frontend (App.jsx)
```

Nguyên tắc cốt lõi: mọi logic an toàn-tính mạng (eGFR, ngưỡng INR, thang điểm
nguy cơ, tương tác thuốc) nằm trong rule engine Python tất định, không bao
giờ để LLM tự suy luận các con số này. Logic này được viết song song bằng
JavaScript trong `frontend/src/App.jsx` (xem `computeRiskScoresClient`,
`checkDrugSafety`) để chế độ demo offline (không cần backend) vẫn hiển thị
đúng các Card.

### Pipeline số hóa điện tâm đồ (ecg_engine.py)

```
Anh ECG (chup/scan)
        |
        v
Muc 1: Tach duong tin hieu khoi luoi giay
  - Anh CO MAU (luoi hong co y)    -> loc theo Hue/Saturation
  - Anh GRAYSCALE (scan/in thuc)   -> morphological closing + weighted average
        |
        v
Muc 2: Uoc tinh nhip tim
  - Tu do ti le pixel/mm tu chu ky luoi o nho (1mm)
  - Tim dinh song R (2-pass: uoc luong tho -> loc lai theo khoang cach thuc)
  - Tinh nhip tim = 60 / RR(giay), toc do giay chuan 25mm/s
        |
        v
Tra ve: signal[] (de ve lai) + nhip tim uoc tinh + do tin cay
```

Nguồn công thức/ngưỡng: sách "Đọc Điện Tâm Đồ Dễ Hơn" (BS Nguyễn Tôn Kinh
Thi). Mọi cảnh báo "chưa xác nhận bởi chuyên gia lâm sàng" được ghi rõ trong
code và trong response API.

---

## Triển khai thật (không phải demo Docker)

- **Frontend:** GitHub Pages — deploy nội dung `frontend/src/App.jsx` (build
  bằng esbuild, xem cách `docker/Dockerfile.frontend` làm để tham khảo quy
  trình build), cùng với toàn bộ `frontend/public/logos/`.
- **Backend:** Hugging Face Spaces (Docker)

### Cần đẩy gì lên Hugging Face Space

Backend trên HF Space chỉ cần đúng nội dung thư mục **`backend/`** — push
5 file sau lên gốc Space (KHÔNG giữ thư mục con `backend/`, vì HF Space chạy
trực tiếp ở gốc):

```
main.py
clinical_rules.py
ecg_engine.py
document_extract.py
requirements.txt
```

`requirements.txt` đã thêm dependency mới so với bản cũ (`opencv-python-headless`,
`scipy`, `python-docx`, `python-pptx`, `openpyxl`) — sau khi push, **cần
restart Space**, build lần đầu sẽ chậm hơn bình thường vì cài thêm các gói
này. Không cần đưa `frontend/` hay `docker/` lên Space.

Đổi `window.MEDIFLOW_API_URL` trong `frontend/index.html` nếu backend đổi
URL — không cần sửa `App.jsx`.

---

## Đội ngũ

- Đăng — Tech Lead (Data Science, University of Georgia)
- Đức Thành — Tech Co-Lead (VinUniversity)
- Tấn, Ngân — Cố vấn lâm sàng (Đại học Y Hà Nội, HMU)
- An — Business / Go-to-market (IE University)
