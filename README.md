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

1. **AI (Claude) chỉ làm việc đọc hiểu** — trích xuất hồ sơ rời rạc (kể cả
   ảnh chụp/scan, qua Claude Vision) thành dữ liệu có cấu trúc. Không được
   yêu cầu tự đánh giá hay tính toán bất cứ điều gì.
2. **Clinical Decision Engine v2 (`cde/`) — tất định, không qua AI** — nhận
   dữ liệu đó, **phân loại đúng bệnh cảnh** (10 nhóm bệnh hệ tuần hoàn theo
   ICD-10 Bộ Y tế), rồi mới áp đúng bộ ngưỡng/thang điểm cho từng nhóm: eGFR
   (CKD-EPI 2021), CHA2DS2-VASc/HAS-BLED, ngưỡng INR theo ESC/EACTS 2021 +
   AHA/ACC 2020 (phân tầng theo vị trí van, thế hệ van, yếu tố nguy cơ), quy
   tắc ưu tiên khi phối hợp nhiều thuốc chống huyết khối, TTR, tương tác
   thuốc, và phát hiện khoảng trống dữ liệu theo guideline.

Nếu AI "tưởng tượng" sai 1 con số, hệ thống vẫn an toàn — vì con số quyết
định không đến từ AI.

### Vì sao có một bước tái cấu trúc lớn (Clinical Decision Engine v2)

Bản đầu của hệ thống viết luật theo kiểu "nếu là ca van tim thì áp ngưỡng X"
— đúng cho ca mẫu đầu tiên nhưng không tổng quát được khi gặp bệnh cảnh khác
(mạch vành, suy tim, rối loạn nhịp, hoặc bệnh nhân thuộc nhiều bệnh cảnh cùng
lúc). Sau khi nhận góp ý chuyên môn từ cố vấn lâm sàng, team đã dừng vá lỗi
theo từng ca và thiết kế lại theo kiến trúc:

```
Bệnh nhân -> Disease Classifier (10 nhóm ICD-10, 0..N nhóm cùng lúc)
          -> Applicable Indicators (chỉ mở khóa chỉ số đúng nhóm bệnh)
          -> Calculation Engine (công thức/thang điểm tất định)
          -> Clinical Rules (ngưỡng -> cảnh báo, có nguồn trích dẫn guideline)
          -> Narrative Generator (AI chỉ diễn đạt, không tính toán)
```

Chi tiết đầy đủ kiến trúc, data model, và danh sách những gì đã/chưa code ở
`cde/SDS_Clinical_Decision_Engine_v2.md`.

### Demo nhanh trong 2 phút (không cần chuẩn bị gì)

1. Mở sản phẩm, đăng nhập bằng tài khoản demo có sẵn ngay trên màn hình.
2. Bấm **"Xem demo: hồ sơ Nguyễn Văn A"** — báo cáo đã phân tích sẵn cho 1 ca
   thật điển hình (sau thay van tim cơ học, đang dùng thuốc chống đông, kèm
   rung nhĩ) — xem các Card: Thang điểm nguy cơ, Khoảng trống theo guideline,
   An toàn thuốc.
3. Ở màn hình tải hồ sơ, chọn thẻ **"Quét điện tâm đồ"** (tách riêng khỏi thẻ
   tải bệnh án) để xem ảnh ECG thật được số hóa lại, đọc theo đúng form 5 mục
   (thông số kỹ thuật, nhịp, tần số, trục, nghi ngờ tình trạng).
4. Mở MedAmi (chatbot) và hỏi bất kỳ câu gì về hồ sơ đang xem — trả lời dựa
   đúng trên hồ sơ, không bịa thông tin ngoài.

### Những gì sản phẩm chưa làm được — nói thẳng, không che giấu

- **Thang điểm đặc trưng theo từng nhóm bệnh** (GRACE/TIMI cho mạch vành,
  NIHSS/mRS cho đột quỵ, CEAP cho bệnh tĩnh mạch...) — hệ thống đã phân loại
  đúng bệnh nhân vào nhóm và biết cần thang điểm nào, nhưng **chưa tự tính**
  các thang điểm này vì cần nhiều biến số chi tiết hơn schema hồ sơ hiện có.
- **SCORE2/SCORE2-OP** (nguy cơ tim mạch 10 năm) — hệ thống chỉ kiểm tra đủ
  dữ liệu đầu vào hay chưa, **chưa tự tính điểm** (cần xác nhận bộ hệ số hồi
  quy phù hợp dân số Việt Nam từ cố vấn lâm sàng trước khi code).
- **OCR ảnh chụp/scan hồ sơ**: đã code xong "động cơ kép" — ưu tiên VNPT
  SmartReader (`vnpt_client.py`), tự động rơi về Claude Vision nếu VNPT lỗi/
  chưa cấu hình. Độ chính xác Claude Vision phụ thuộc chất lượng ảnh và chữ
  viết tay; SmartReader không đọc được chữ viết tay (giới hạn đã xác nhận từ
  tài liệu BTC) nên Claude Vision vẫn là fallback bắt buộc, không phải tùy
  chọn.
- Số hóa điện tâm đồ (ước tính nhịp tim từ ảnh) hoạt động tốt trên ảnh sạch,
  giảm độ chính xác trên ảnh nhiễu/lưới đậm. Chưa tự động phân loại loại
  nhịp bất thường cụ thể — chỉ nêu "nghi ngờ nhịp không đều, cần xác nhận".
- **FAQ Bot (VNPT Smartbot)** và **SmartVoice (TTS/STT)**: đã code xong toàn
  bộ endpoint + fallback an toàn (`/faq-bot`, `/voice/tts`, `/voice/stt`) —
  chạy được ngay, tự hiện thông báo bảo trì/chuyển Web Speech API của trình
  duyệt cho tới khi điền `VNPT_FAQ_BOT_ID` (cần tạo bot trên console-
  smartbot.vnpt.vn trước) và có tài liệu endpoint SmartVoice thật từ BTC.
  Xem `.env.example` để biết đầy đủ biến môi trường cần điền.
- Một số chỉ số mới ở phần phân loại bệnh cảnh (`active_icd_groups`, sinh
  hiệu chuẩn ESC 2024, yếu tố nguy cơ, ưu tiên đa thuốc) đã có trong dữ liệu
  trả về từ backend nhưng **frontend chưa hiển thị** — dự kiến làm ở vòng kế.

---

## Dành cho người dùng (bác sĩ) — sản phẩm dùng để làm gì

| Tính năng | Mô tả |
|---|---|
| Đọc hồ sơ đa định dạng | PDF, Word, Excel, PowerPoint, **và ảnh chụp/scan** xuất từ HIS |
| Báo cáo tự động | Tóm tắt chẩn đoán, diễn biến, xét nghiệm theo đúng trình tự thời gian |
| Cảnh báo ưu tiên | Phân tầng mức độ cần xử trí ngay / theo dõi / ổn định |
| Phân loại bệnh cảnh | Tự nhận diện 10 nhóm bệnh hệ tuần hoàn (ICD-10), áp đúng chỉ số cho từng nhóm |
| An toàn thuốc | Tương tác thuốc, chỉnh liều theo chức năng thận, trùng nhóm thuốc, ưu tiên khi đa thuốc chống huyết khối |
| Thang điểm nguy cơ | CHA2DS2-VASc, HAS-BLED (chống đông ở rung nhĩ) |
| Ngưỡng INR theo van | Phân tầng đúng theo vị trí van, thế hệ van, yếu tố nguy cơ (ESC/EACTS + AHA/ACC) |
| TTR | % thời gian INR trong đích điều trị, tự ẩn nếu bệnh nhân dùng DOAC |
| Khoảng trống guideline | Tự phát hiện dữ liệu/xét nghiệm còn thiếu so với khuyến cáo |
| MedAmi | Chatbot hỏi-đáp riêng theo từng hồ sơ đang xem |
| Quét điện tâm đồ | Số hóa lại ảnh ECG, đọc theo form 5 mục, lưu lịch sử quét |
| Chỉnh sửa & ghi chú | Bác sĩ bổ sung thông tin hoặc ghi chú riêng trên mọi mục báo cáo |
| Đánh dấu theo dõi | Lưu các mục cần quan tâm, xem lại nhanh qua 1 nút riêng |
| 3 chế độ xem | Bác sĩ điều trị / Hội chẩn đa chuyên khoa / Giảng dạy |
| Xuất báo cáo | In/lưu báo cáo đầy đủ, kèm ghi chú và mục đã đánh dấu |

Đăng nhập demo: tài khoản và mật khẩu hiện sẵn ngay trên màn hình đăng nhập.

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

---

## Chạy không cần Docker (dev nhanh)

Backend:
```bash
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn main:app --reload --port 8000
```

Frontend: sản phẩm thật chạy qua bản đã deploy GitHub Pages. Để tự build cục
bộ, dùng đúng cách Docker đã làm (xem `docker_setup/Dockerfile.frontend`).

---

## Script test tự động (pytest)

```bash
pip install -r requirements-dev.txt
pytest test_main.py cde/ -v
```

**87 test**, mock Anthropic API (không tốn token thật, không cần mạng):
- `test_main.py` (18 test) — endpoint /health, /analyze_text, /analyze (mọi
  định dạng kể cả ảnh), /chat, /ecg; idempotent; file hỏng trả lỗi rõ nghĩa
- `cde/test_engine.py`, `cde/test_anticoagulation_targets.py`,
  `cde/test_icd_groups.py`, `cde/test_universal_indicators.py`,
  `cde/test_antithrombotic_priority.py` (69 test) — Disease Classifier,
  ngưỡng INR theo guideline, phân loại 10 nhóm ICD, chỉ số chung, ưu tiên
  đa thuốc

Một số bug thật đã được phát hiện và sửa trong lúc viết test (không phải lý
thuyết — có test hồi quy riêng cho từng cái):
- Câu phủ định ("không ghi nhận đái tháo đường", "không phải van cơ học")
  từng bị tính nhầm thành dương tính.
- Văn bản tiếng Việt có dấu không khớp được keyword không dấu ở module
  ngưỡng INR (thiếu bước chuẩn hóa dấu).
- Từ viết tắt "THA" (tăng huyết áp) khớp nhầm vào chữ "THAy van".
- `resolve_generic()` không nhận diện thuốc viết tên hoạt chất trực tiếp
  (ví dụ "Aspirin 81mg" không qua tên biệt dược/ngoặc) — ảnh hưởng mọi rule
  tương tác thuốc liên quan, không chỉ tính năng mới.

---

## Cấu trúc thư mục

```
.
App.jsx                       Frontend - React single-file, ~7250 dong
main.py                       Backend - FastAPI, pipeline 3 buoc
clinical_rules.py             Cac ham tinh toan tat dinh (eGFR, CHA2DS2-VASc...)
ecg_engine.py                 So hoa anh ECG (Muc 1 + Muc 2)
document_extract.py           Trich text tu Word/Excel/PowerPoint
test_main.py                  Script test pytest (18 test)
requirements.txt              Dependency production
requirements-dev.txt          + pytest, httpx (chi cho test)
docker-compose.yml
docker_setup/
  Dockerfile.backend
  Dockerfile.frontend
  mount.jsx                   Entry point React (createRoot) cho ban Docker
  index.html
.env.example
.gitignore
medparcours_roadmap_v2.md     Ke hoach ky thuat + business chi tiet

cde/                           Clinical Decision Engine v2 (kien truc moi)
  __init__.py
  engine.py                    Diem vao chinh - evaluate_v2(), goi tat ca layer
  disease_classifier.py        Layer 1-2: 3 profile loi (van tim/rung nhi/CKD)
  indicators.py                 Layer 3: applicability - chi mo khoa dung profile
  anticoagulation_targets.py   Nguong INR theo ESC/EACTS 2021 + AHA/ACC 2020
  icd_groups.py                 10 nhom benh he tuan hoan theo ICD-10 (Bo Y te)
  universal_indicators.py      Chi so chung moi benh nhan (sinh hieu, SCORE2...)
  antithrombotic_priority.py   Uu tien da thuoc chong huyet khoi
  test_*.py                     69 test cho 5 module tren
  SDS_Clinical_Decision_Engine_v2.md   Dac ta kien truc day du
```

### Kiến trúc pipeline backend (3 bước hybrid)

```
PDF / Word / Excel / PowerPoint / Anh chup-scan
        |
        v
Trich text (pypdf / python-docx / openpyxl / python-pptx)
hoac doc truc tiep bang Claude Vision (anh PNG/JPG)
        |
        v
Buoc 1 (LLM): Claude doc -> JSON co cau truc (KHONG danh gia)
        |
        v
Buoc 2 (Clinical Decision Engine v2 - cde/engine.py): TAT DINH, khong LLM
  - Disease Classifier: phan loai 10 nhom ICD-10 + 3 profile loi (van/AF/CKD)
  - eGFR (CKD-EPI 2021), CHA2DS2-VASc / HAS-BLED
  - Nguong INR theo guideline (phan tang theo van/yeu to nguy co) + TTR
  - An toan thuoc (tuong tac, chinh lieu, trung nhom, uu tien da thuoc)
  - Chi so chung (sinh hieu theo ESC 2024, yeu to nguy co, SCORE2 applicability)
  - Care-gap detector (khoang trong theo guideline)
        |
        v
Buoc 3 (LLM): Claude dien dat xu huong (CHI tu delta da tinh, khong bia)
        |
        v
Bao cao co cau truc -> Frontend (App.jsx)
```

Nguyên tắc cốt lõi không đổi: mọi logic an toàn-tính mạng nằm trong rule
engine Python tất định, không bao giờ để LLM tự suy luận các con số này.

---

## Triển khai thật (không phải demo Docker)

- Frontend: GitHub Pages, build tự động bằng GitHub Actions
- Backend: Hugging Face Spaces (Docker)

### Cấu hình GitHub Pages (chỉ cần làm 1 lần)

Repo có sẵn `.github/workflows/deploy-pages.yml` — tự build `App.jsx` bằng
esbuild và deploy lên Pages mỗi khi push vào nhánh `main`.

1. Vào repo trên GitHub → Settings → Pages
2. Mục "Build and deployment" → Source: chọn **GitHub Actions**
3. Push code lên nhánh `main` — workflow tự chạy, sau ~1-2 phút trang sẽ có ở
   `https://<tên-tài-khoản>.github.io/<tên-repo>/`

### Cần có gì trên Hugging Face Space

**Quan trọng:** `main.py` giờ import từ thư mục `cde/` —
`from cde.engine import evaluate_v2`. Thiếu thư mục này Space sẽ lỗi
`ModuleNotFoundError` ngay khi khởi động.

File/thư mục cần có trên Space:
```
main.py
clinical_rules.py
ecg_engine.py
document_extract.py
requirements.txt
cde/__init__.py
cde/engine.py
cde/disease_classifier.py
cde/indicators.py
cde/anticoagulation_targets.py
cde/icd_groups.py
cde/universal_indicators.py
cde/antithrombotic_priority.py
```

`requirements.txt` không có dependency mới so với bản trước — `cde/` chỉ
dùng thư viện chuẩn Python. Sau khi push đủ file, **restart Space thủ công**
để chắc chắn load đúng cấu trúc import mới (commit thường không tự kích
hoạt rebuild nếu `requirements.txt` không đổi).

Không cần đẩy file `test_*.py` và `SDS_*.md` lên Space — không ảnh hưởng
runtime, nhưng đẩy theo cũng không hại gì.

---

## Đội ngũ

- Đăng — Tech Lead (Data Science, University of Georgia)
- Đức Thành — Tech Co-Lead (VinUniversity)
- Tấn, Ngân — Cố vấn lâm sàng (Đại học Y Hà Nội, HMU)
- An — Business / Go-to-market (IE University)
