# MedParcours AI

**Trợ lý AI phân tích hồ sơ bệnh án tiếng Việt cho bác sĩ — chuyển 1 bộ hồ sơ giấy/PDF dài thành báo cáo có cấu trúc, cảnh báo rủi ro lâm sàng và hỗ trợ hỏi đáp trong ~30 giây.**

Team **UN1SVENGERS** · Vietnamese Student HackAIthon 2026 · Bảng B Challenger · Đề tài 5: Y tế

---

## 1. Vấn đề & giải pháp

Bác sĩ tại bệnh viện tuyến tỉnh/huyện thường phải đọc hồ sơ bệnh án dài hàng chục trang trong thời gian rất ngắn giữa các ca khám, dễ bỏ sót cảnh báo lâm sàng quan trọng (tương tác thuốc, ngưỡng chống đông sai theo loại van tim, xu hướng xét nghiệm bất thường...).

MedParcours AI đọc toàn bộ hồ sơ (PDF/DOCX/XLSX/PPTX/ảnh scan), trích xuất có cấu trúc bằng Claude, sau đó chạy qua **bộ luật lâm sàng tất định (deterministic rule engine)** để tính toán các chỉ số an toàn — **không giao phó việc tính toán y khoa cho LLM**, chỉ dùng LLM để đọc hiểu văn bản và diễn giải theo ngữ cảnh.

## 2. Tính năng chính

**Phân tích hồ sơ**
- Đọc PDF/DOCX/XLSX/PPTX (trích text trực tiếp) và ảnh scan (OCR qua VNPT SmartReader, tự động rơi về Claude Vision nếu lỗi)
- Tóm tắt diễn biến theo 3 giai đoạn (trước mổ / hậu phẫu / ngoại trú), phát hiện cảnh báo nguy cơ, biện luận lâm sàng đa biến
- Cập nhật hồ sơ đã lưu (gộp tài liệu tái khám mới, không ghi đè)

**Rule engine lâm sàng (`cde/`)** — tất định, không suy đoán từ LLM
- Phân loại 10 nhóm bệnh cảnh theo ICD-10 hệ tuần hoàn, mỗi nhóm gắn đúng thang điểm khuyến nghị
- Ngưỡng INR mục tiêu theo ESC/EACTS 2021 + AHA/ACC 2020, phân tầng đầy đủ theo **vị trí van** (động mạch chủ/hai lá/ba lá) × **thế hệ van** × **yếu tố nguy cơ** — phân biệt rõ van cơ học và van sinh học dù cùng tên thương hiệu (vd "St Jude" có cả 2 dòng sản phẩm)
- TTR (Time in Therapeutic Range), CHA2DS2-VASc, HAS-BLED, eGFR (CKD-EPI 2021), an toàn thuốc theo chức năng thận
- Cảnh báo rõ khi TTR đo trong giai đoạn hậu phẫu (liều chưa ổn định) — chỉ mang tính tham khảo

**Điện tâm đồ**: số hóa ảnh ECG thành tín hiệu, ước lượng nhịp tim qua khoảng R-R, bác sĩ xác nhận đúng chuyển đạo đã chụp (mặc định Lead II theo quy ước lâm sàng cho dải nhịp)

**Trợ lý hội thoại MedAmi**: hỏi đáp theo đúng ngữ cảnh hồ sơ đang mở, lưu lịch sử theo từng bệnh nhân; tách riêng FAQ hệ thống (Smartbot)

**Hội chẩn AI (Virtual MDT)**: mời đúng chuyên khoa theo vấn đề, tổng hợp thảo luận; ghi âm hội chẩn → tóm tắt có cấu trúc (VNPT iSense, tự rơi về Claude tóm tắt từ transcript thật nếu lỗi — không bịa nội dung)

**Giọng nói (VNPT SmartVoice)**: đọc to cảnh báo bằng giọng Việt thật, ghi âm câu hỏi bằng micro — luôn có phương án dự phòng bằng Web Speech API của trình duyệt nếu API lỗi

**Định danh điện tử (VNPT eKYC)**: OCR thông tin CCCD (có kiểm tra chống ảnh giả mạo/photocopy trước khi đọc), xác thực khuôn mặt bằng camera thật trước khi ký duyệt xuất báo cáo

**Quản lý hồ sơ**: tìm kiếm, lọc theo loại bệnh/thời gian, ghim ưu tiên, xóa có hoàn tác, so sánh xét nghiệm giữa các lần khám, bookmark widget lâm sàng

## 3. Kiến trúc & công nghệ

| Lớp | Công nghệ |
|---|---|
| Frontend | React (1 file `App.jsx`, esbuild, không phụ thuộc UI framework ngoài) |
| Backend | FastAPI (Python), Uvicorn |
| AI trích xuất & hội thoại | Claude (Anthropic API), Prompt Caching cho system prompt dài |
| Rule engine lâm sàng | Python thuần, tất định 100%, tách biệt hoàn toàn khỏi LLM (`cde/`) |
| OCR / Voice / eKYC | VNPT SmartReader, SmartVoice (TTS/STT/Tóm tắt), eKYC (OCR CCCD/Liveness/Face Compare) |
| Lưu trữ | Turso (libSQL) |
| Triển khai | Docker (2 service: backend + frontend), GitHub Pages (frontend tĩnh) |

**Nguyên tắc thiết kế cốt lõi**: mọi phép tính có ý nghĩa lâm sàng (ngưỡng INR, TTR, eGFR, thang điểm nguy cơ...) nằm trong `cde/`, KHÔNG viết trong prompt LLM — Claude chỉ đọc hiểu văn bản và diễn giải, không tự suy ra ngưỡng y khoa. Mọi tích hợp VNPT có fallback an toàn khi lỗi (SmartReader → Claude Vision, TTS/STT → Web Speech API, tóm tắt hội chẩn → Claude từ transcript thật) — không bao giờ crash, không bao giờ bịa dữ liệu lâm sàng.

## 4. Chạy nhanh (1 lệnh)

```bash
cp .env.example .env         # điền ANTHROPIC_API_KEY (bắt buộc) + các biến khác (tùy chọn)
docker-compose up --build
```

- Backend: `http://localhost:8000` (docs: `/docs`)
- Frontend: `http://localhost:8080`

Biến môi trường bắt buộc: `ANTHROPIC_API_KEY`. Các biến còn lại (Turso, VNPT SmartReader/SmartVoice/eKYC) đều **tùy chọn** — thiếu biến nào, tính năng tương ứng tự rơi về fallback an toàn, không chặn ứng dụng chạy. Xem đầy đủ trong `.env.example`.

## 5. Kiểm thử

```bash
./run_tests.sh          # hoặc: pytest test_main.py cde/ test_main_patient_endpoints.py test_database.py test_ecg_engine.py test_vnpt_client.py -v
```

213 test tự động, bao phủ: rule engine lâm sàng (INR/TTR/ICD-10/CHA2DS2-VASc/HAS-BLED), toàn bộ endpoint API (kể cả các nhánh lỗi/fallback), tích hợp VNPT (mock, không gọi API thật khi test), CRUD hồ sơ, ECG.

## 6. Cấu trúc thư mục

```
├── App.jsx                    # Toàn bộ frontend (1 file, React + esbuild)
├── main.py                    # FastAPI — endpoint, pipeline trích xuất, fallback
├── database.py                # Turso (libSQL) — CRUD hồ sơ, lịch sử chat, feedback
├── vnpt_client.py             # SDK gọi API VNPT (SmartReader/SmartVoice/eKYC)
├── ecg_engine.py               # Số hóa ECG, luật an toàn hiển thị
├── clinical_rules.py           # Luật lâm sàng nền (TTR, sàng lọc ưu tiên...)
├── document_extract.py         # Trích text từ PDF/DOCX/XLSX/PPTX
├── cde/                        # Rule engine lâm sàng tất định (Layer 1-5)
│   ├── engine.py                   # Điểm vào chính (evaluate_v2)
│   ├── disease_classifier.py       # Nhận diện bệnh cảnh + subtype
│   ├── icd_groups.py               # 10 nhóm ICD-10 hệ tuần hoàn
│   ├── anticoagulation_targets.py  # Ngưỡng INR theo van + ESC/AHA
│   ├── indicators.py               # CHA2DS2-VASc, HAS-BLED, TTR...
│   └── test_*.py                   # Test riêng từng module
├── docker_setup/                # Dockerfile backend + frontend
├── docker-compose.yml
├── requirements.txt
└── test_*.py                    # Test tầng API/database/ECG/VNPT client
```

## 7. API chính (23 endpoint)

| Nhóm | Endpoint |
|---|---|
| Phân tích hồ sơ | `POST /analyze`, `POST /analyze_text` |
| Quản lý hồ sơ | `POST /patient/save`, `GET /patient`, `GET/PATCH /patient/{sba}`, `POST /patient/update[_file]`, `GET /patient/{sba}/history` |
| Hội thoại | `POST /chat`, `POST /faq-bot`, `GET/POST /patient/{sba}/chat` |
| Giọng nói | `POST /voice/tts`, `POST /voice/stt`, `POST /consultation/summarize-audio` |
| eKYC | `POST /ekyc/ocr-cccd`, `POST /ekyc/face-liveness`, `POST /ekyc/face-compare` |
| ECG | `POST /ecg`, `GET /ecg/synthetic` |
| Khác | `GET /health`, `POST /feedback` |

Chi tiết đầy đủ tại `/docs` (Swagger UI tự sinh) khi backend đang chạy.

## 8. Giới hạn đã biết

- ECG: chỉ số hóa được **1 chuyển đạo mỗi lần quét** (bác sĩ tự xác nhận đúng chuyển đạo), chưa tự động tách 12 chuyển đạo từ 1 ảnh trang đầy đủ.
- Tra cứu liên thông CCCD (Đề án 06) và tra cứu CSDL quốc gia: **mô phỏng** — không có quyền truy cập CSDL thật, riêng phần OCR đọc thông tin trên ảnh thẻ vẫn là dữ liệu thật.
- VNPT SmartVoice/eKYC cần token cấu hình đúng (xem `.env.example`) — thiếu token, tính năng tự ẩn/rơi về fallback trình duyệt, không lỗi ứng dụng.

## 9. Đội ngũ

Đăng (Tech Lead) · Đức Thành (Tech Co-Lead) · Tấn, Ngân (Cố vấn lâm sàng — Đại học Y Hà Nội) · An (Business/GTM)
