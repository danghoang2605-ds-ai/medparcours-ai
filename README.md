# 🩺 MedParcours AI

**Trợ lý Lâm sàng Thông minh (Clinical Decision Support System) cho bác sĩ Việt Nam — biến 1 bộ hồ sơ giấy/PDF dày hàng chục trang thành báo cáo có cấu trúc, cảnh báo rủi ro lâm sàng và hỗ trợ hỏi đáp trong ~30 giây.**

**Team UN1SVENGERS** · Vietnamese Student HackAIthon 2026 · Bảng B Challenger · Đề tài 5: Y tế

---

## 1. 🌟 Tầm nhìn & Tiêu điểm sản phẩm

**Vấn đề y tế thực tế**: Đứt gãy thông tin bệnh án liên viện, bác sĩ tuyến tỉnh/huyện quá tải bởi hồ sơ giấy/PDF thô trong thời gian khám cực ngắn, dễ bỏ sót cảnh báo lâm sàng quan trọng (tương tác thuốc, ngưỡng chống đông sai theo loại van tim, xu hướng xét nghiệm bất thường).

**Giải pháp**: MedParcours AI kết hợp **Generative AI (Claude)** để đọc hiểu văn bản tự do, với **Hệ luật Lâm sàng Quyết định (CDE v2 — Deterministic Rule Engine)** để tính toán mọi chỉ số có ý nghĩa y khoa. Đây là lựa chọn kiến trúc có chủ đích, không phải giới hạn kỹ thuật.

> *"LLM giỏi đọc hiểu ngôn ngữ tự nhiên, nhưng không nên là nơi duy nhất quyết định 1 con số y khoa. Claude ở đây đóng vai trò người đọc hồ sơ và diễn giải ngữ cảnh — mọi phép tính (ngưỡng INR, eGFR, thang điểm nguy cơ) đều chạy qua code Python tất định, có thể kiểm tra, có thể viết test, không đổi khác giữa 2 lần chạy cùng 1 dữ liệu."*

## 2. 🧠 Kiến trúc công nghệ — Hybrid AI kháng ảo giác

Điểm khác biệt cốt lõi so với 1 chatbot y tế thông thường:

| Lớp | Vai trò | Vị trí trong code |
|---|---|---|
| **LLM (Claude)** | Đọc hồ sơ tự do (PDF/ảnh/scan), trích xuất có cấu trúc, viết narrative lâm sàng | `main.py` (REPORT_SYSTEM) |
| **CDE v2 (Rule Engine)** | Tính eGFR (CKD-EPI 2021), CHA2DS2-VASc, HAS-BLED, ngưỡng INR theo ESC/EACTS 2021 + AHA/ACC 2020, TTR | `cde/` — Python thuần, tất định 100%, **không đi qua LLM** |

**Chuẩn hóa văn phong lâm sàng Việt Nam** — theo phản hồi trực tiếp từ chuyên gia y tế (Tấn, Ngân — Đại học Y Hà Nội), đã đưa thành luật bắt buộc trong system prompt:
- Việt hóa 100% thuật ngữ (cấm `post-op`, `over-diuresis`... phải dùng `sau phẫu thuật`, `lợi tiểu quá mức`) — chỉ giữ nguyên tên thuốc và ký hiệu xét nghiệm quốc tế (CRP, NT-proBNP, INR)
- Khách quan, không khẳng định tuyệt đối: bắt buộc dùng `"có thể"`, `"ghi nhận"` thay vì `"đã hồi phục hoàn toàn"`, `"do X gây ra"`
- Chẩn đoán chính lấy **nguyên văn** hồ sơ gốc, cấm tự diễn giải viết tắt y khoa (rủi ro hiểu sai nghiêm trọng nếu đoán sai)

## 3. 🏛️ Tích hợp hệ sinh thái VNPT — đã gọi API thật, không chỉ giao diện minh họa

| Tính năng | Sản phẩm VNPT | Trạng thái |
|---|---|---|
| **OCR bệnh án** (ảnh scan + PDF không có text layer) | SmartReader | ✅ API thật, tự rơi về Claude Vision nếu lỗi |
| **Đọc cảnh báo bằng giọng nói** | SmartVoice (TTS) | ✅ API thật, fallback Web Speech API |
| **Ghi âm câu hỏi, hiển thị chữ theo thời gian thực** | SmartVoice (STT) | ✅ API thật + hiển thị tức thời qua trình duyệt song song |
| **Tóm tắt biên bản hội chẩn từ giọng nói** | SmartVoice (iSense) | ✅ API thật, fallback Claude tóm tắt từ transcript thật (không bịa nội dung) nếu lỗi |
| **OCR thông tin CCCD** | eKYC | ✅ API thật (đọc đúng thông tin từ ảnh thẻ) |
| **Kiểm tra chống ảnh CCCD giả mạo** | eKYC | ✅ API thật — chỉ cảnh báo, không chặn cứng (phát hiện tỷ lệ báo sai trên ảnh thật khi kiểm thử) |
| **Xác thực khuôn mặt trước khi ký duyệt báo cáo** | eKYC (Face Liveness) | ⚠️ Đang chờ VNPT xác nhận quyền API — tạm thời fallback demo, có ghi chú rõ trong code |
| **Tra cứu liên thông hồ sơ liên viện** | Đề án 06 | 🔶 Mô phỏng — không có quyền truy cập CSDL quốc gia thật (bước OCR đọc thẻ vẫn là dữ liệu thật, chỉ riêng bước "tìm hồ sơ cũ" là minh họa) |

> *"Chúng tôi ưu tiên nói đúng cái gì là thật, cái gì là minh họa — hơn là làm đẹp demo. Với 1 sản phẩm y tế, sự trung thực về năng lực hệ thống quan trọng hơn con số ấn tượng."*

## 4. 🔬 Luồng trải nghiệm của bác sĩ

1. **Tiếp nhận** — Quét CCCD hoặc tải hồ sơ cũ → hệ thống dựng dòng thời gian 3 giai đoạn (Tiền phẫu → Hậu phẫu nội trú → Ngoại trú)
2. **Phân tích** — AI trích xuất xét nghiệm, tự vẽ xu hướng biến thiên (sparkline theo 4 mốc lâm sàng), CDE v2 tính cảnh báo tương tác thuốc/ngưỡng chống đông, chỉ ra "Khoảng trống Guideline" nếu dữ liệu chưa đủ để áp dụng 1 khuyến nghị
3. **Hội chẩn & Hỏi đáp** — Chatbot MedAmi trả lời theo đúng ngữ cảnh hồ sơ đang mở (tự chuyển về chế độ lâm sàng khi mở hồ sơ mới), tách riêng FAQ hệ thống; ghi âm hội chẩn đa chuyên khoa → tóm tắt tự động
4. **Quyết định & Xuất báo cáo** — Bác sĩ rà soát, có thể xuất báo cáo dành riêng cho bệnh nhân (ngôn ngữ phổ thông, không thuật ngữ), ký duyệt bằng sinh trắc học trước khi xuất bản chính thức

## 5. 🛠️ Công nghệ sử dụng

| Lớp | Công nghệ |
|---|---|
| Frontend | React (1 file `App.jsx`), esbuild — không dùng framework CSS ngoài (CSS-in-JS thuần) |
| Backend | FastAPI (Python), Uvicorn |
| AI trích xuất & hội thoại | Claude (Anthropic API — `claude-haiku-4-5`), Prompt Caching |
| Rule engine lâm sàng | Python thuần, tất định 100% (`cde/`) |
| OCR / Voice / eKYC | VNPT SmartReader, SmartVoice, eKYC |
| Lưu trữ & xác thực bác sĩ | **Supabase** (đang tích hợp — xem mục 8) |
| Triển khai | Docker, GitHub Pages (CI/CD qua GitHub Actions chính thức, tự thử lại khi deploy lỗi tạm thời) |

## 6. 🚀 Hướng dẫn trải nghiệm nhanh cho BGK

```bash
git clone https://github.com/danghoang2605-ds-ai/medparcours-ai.git
cd medparcours-ai
cp .env.example .env   # điền ANTHROPIC_API_KEY (bắt buộc — mọi biến khác đều tùy chọn)
pip install -r requirements.txt --break-system-packages
pip install -r requirements-dev.txt --break-system-packages
npm install esbuild@0.27.7 react@19.2.6 react-dom@19.2.6
```
Chi tiết đầy đủ (chạy backend/frontend riêng, Docker, script test tự động): xem **`HUONG_DAN_TEST_VA_CHAY.md`**.

**Gợi ý thao tác nhanh khi chấm demo**:
- Bấm **"Tra cứu CCCD"** trên header → thử tải ảnh CCCD thật để xem OCR thật hoạt động
- Bấm **"Ký duyệt & Xuất báo cáo"** → trải nghiệm luồng xác thực sinh trắc học trước khi xuất PDF
- Vào tab **"Hội chẩn AI"** → thử ghi âm ngắn để xem tóm tắt hội chẩn tự động
- Bấm mic ở khung chat MedAmi → nói thử để thấy chữ hiện theo thời gian thực

## 7. 🧪 Kiểm thử

```bash
bash run_tests.sh
```
**224 test tự động**, hoàn toàn không gọi mạng thật (mock Claude API + VNPT API) — chạy được ngay cả khi chưa cấu hình `.env`. Bao phủ: rule engine lâm sàng, toàn bộ endpoint API (kể cả nhánh lỗi/fallback), tích hợp VNPT, CRUD hồ sơ, ECG.

## 8. 🔐 Lưu trữ & Xác thực — đang chuyển đổi sang Supabase

Hệ thống đang chuyển từ Turso sang **Supabase**, đồng thời bổ sung **hệ thống đăng ký/đăng nhập cho bác sĩ** (trước đây chưa có xác thực người dùng multi-account). Phần này do thành viên khác trong team phát triển, đang trong quá trình rà soát tích hợp — README sẽ cập nhật chi tiết endpoint/schema khi hoàn tất.

Nguyên tắc thiết kế giữ nguyên: tính năng lưu trữ/xác thực (phụ trợ) **không được phép** làm sập tính năng phân tích hồ sơ (chính) — nếu database lỗi kết nối, hệ thống chỉ hiện lịch sử trống, bác sĩ vẫn phân tích được hồ sơ mới bình thường.

## 9. 📂 Cấu trúc thư mục

```
├── App.jsx                    # Toàn bộ frontend (1 file, React + esbuild)
├── main.py                    # FastAPI — endpoint, pipeline trích xuất, fallback
├── database.py                # Lưu trữ hồ sơ + xác thực (đang chuyển sang Supabase)
├── vnpt_client.py             # SDK gọi API VNPT (SmartReader/SmartVoice/eKYC)
├── ecg_engine.py               # Số hóa ECG, luật an toàn hiển thị
├── clinical_rules.py           # Luật lâm sàng nền
├── document_extract.py         # Trích text từ PDF/DOCX/XLSX/PPTX
├── cde/                        # Rule engine lâm sàng tất định
│   ├── engine.py                   # Điểm vào chính (evaluate_v2)
│   ├── disease_classifier.py       # Nhận diện bệnh cảnh + subtype
│   ├── icd_groups.py               # 10 nhóm ICD-10 hệ tuần hoàn
│   ├── anticoagulation_targets.py  # Ngưỡng INR theo van + ESC/AHA
│   ├── indicators.py               # CHA2DS2-VASc, HAS-BLED, TTR
│   └── test_*.py
├── docker_setup/                # Dockerfile backend + frontend
├── run_tests.sh                  # Chạy toàn bộ test, in kết luận rõ ràng
├── HUONG_DAN_TEST_VA_CHAY.md     # Hướng dẫn cài đặt/chạy/test chi tiết
└── test_*.py
```

## 10. ⚠️ Giới hạn đã biết (nói thật, không giấu)

- ECG: chỉ số hóa được 1 chuyển đạo mỗi lần quét, chưa tự tách 12 chuyển đạo từ 1 ảnh đầy đủ
- Tra cứu liên thông CCCD (Đề án 06): mô phỏng, không có quyền CSDL quốc gia thật
- `face_compare` (so khớp mặt bác sĩ với CCCD): có endpoint, chưa gắn giao diện
- eKYC Face Liveness: đang chờ VNPT xác nhận quyền API, tạm fallback demo
- Hệ thống đăng ký/đăng nhập bác sĩ qua Supabase: mới bổ sung, đang hoàn thiện

## 11. 👥 Đội ngũ

Đăng (Tech Lead) · Đức Thành (Tech Co-Lead) · Tấn, Ngân (Cố vấn lâm sàng — Đại học Y Hà Nội) · An (Business/GTM)
