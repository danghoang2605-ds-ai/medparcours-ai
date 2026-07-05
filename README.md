# 🩺 MedParcours AI

Trợ lý Lâm sàng Thông minh (Clinical Decision Support System) cho bác sĩ Việt Nam, biến một bộ hồ sơ giấy hoặc PDF dày hàng chục trang thành báo cáo có cấu trúc, cảnh báo rủi ro lâm sàng và hỗ trợ hỏi đáp trong khoảng 30 giây.

**Team UN1SVENGERS** · Vietnamese Student HackAIthon 2026 · Bảng B Challenger · Đề tài 5: Y tế

---

## 1. 🌟 Tầm nhìn và tiêu điểm sản phẩm

**Vấn đề y tế thực tế:** thông tin bệnh án bị đứt gãy giữa các tuyến điều trị, bác sĩ tuyến tỉnh và huyện phải xử lý khối lượng lớn hồ sơ giấy hoặc PDF thô trong thời gian khám rất ngắn, dẫn đến nguy cơ bỏ sót các cảnh báo lâm sàng quan trọng như tương tác thuốc, sai ngưỡng chống đông theo loại van tim, hoặc xu hướng xét nghiệm bất thường.

**Giải pháp:** MedParcours AI kết hợp Generative AI (Claude) để đọc hiểu văn bản tự do, với Hệ luật Lâm sàng Quyết định (CDE v2, Deterministic Rule Engine) để tính toán mọi chỉ số có ý nghĩa y khoa. Đây là một lựa chọn kiến trúc có chủ đích, được thiết kế để bảo đảm độ tin cậy y khoa chứ không đơn thuần vì giới hạn kỹ thuật.

> "LLM giỏi đọc hiểu ngôn ngữ tự nhiên, nhưng không nên là nơi duy nhất quyết định một con số y khoa. Claude ở đây đóng vai trò người đọc hồ sơ và diễn giải ngữ cảnh, còn mọi phép tính (ngưỡng INR, eGFR, thang điểm nguy cơ) đều chạy qua code Python tất định, có thể kiểm tra, có thể viết test, và cho kết quả nhất quán giữa các lần chạy trên cùng một dữ liệu."

---

## 2. 🧠 Kiến trúc công nghệ: Hybrid AI kháng ảo giác

Điểm khác biệt cốt lõi so với một chatbot y tế thông thường nằm ở việc tách bạch rõ vai trò của từng lớp xử lý:

| Lớp | Vai trò | Vị trí trong code |
|---|---|---|
| LLM (Claude) | Đọc hồ sơ tự do (PDF, ảnh, bản scan), trích xuất có cấu trúc, viết diễn giải lâm sàng | `main.py` (`REPORT_SYSTEM`) |
| CDE v2 (Rule Engine) | Tính eGFR (CKD-EPI 2021), CHA2DS2-VASc, HAS-BLED, ngưỡng INR theo ESC/EACTS 2021 và AHA/ACC 2020, TTR | `cde/`, Python thuần, tất định hoàn toàn, không đi qua LLM |

Chuẩn hóa văn phong lâm sàng Việt Nam được xây dựng theo phản hồi trực tiếp từ chuyên gia y tế (Tấn, Ngân, Đại học Y Hà Nội) và đã trở thành luật bắt buộc trong system prompt:

- Việt hóa toàn bộ thuật ngữ (không dùng "post-op", "over-diuresis"... mà dùng "sau phẫu thuật", "lợi tiểu quá mức"), chỉ giữ nguyên tên thuốc và ký hiệu xét nghiệm quốc tế (CRP, NT-proBNP, INR)
- Diễn đạt khách quan, thận trọng: ưu tiên dùng "có thể", "ghi nhận" thay vì các khẳng định tuyệt đối như "đã hồi phục hoàn toàn" hay "do X gây ra"
- Chẩn đoán chính được giữ nguyên văn theo hồ sơ gốc, không tự diễn giải các từ viết tắt y khoa để tránh rủi ro hiểu sai

---

## 3. 🏛️ Tích hợp hệ sinh thái VNPT

Các tính năng dưới đây đã được kết nối với API thật của VNPT, không chỉ là giao diện minh họa:

| Tính năng | Sản phẩm VNPT | Trạng thái |
|---|---|---|
| OCR bệnh án (ảnh scan và PDF không có lớp văn bản) | SmartReader | Đã tích hợp API thật, tự động chuyển sang Claude Vision khi cần |
| Đọc cảnh báo bằng giọng nói | SmartVoice (TTS) | Đã tích hợp API thật, có phương án dự phòng qua Web Speech API |
| Ghi âm câu hỏi, hiển thị chữ theo thời gian thực | SmartVoice (STT) | Đã tích hợp API thật, kết hợp hiển thị tức thời qua trình duyệt |
| Tóm tắt biên bản hội chẩn từ giọng nói | SmartVoice (iSense) | Đã tích hợp API thật, có phương án dự phòng qua Claude tóm tắt trực tiếp từ bản ghi âm thanh |
| OCR thông tin CCCD | eKYC | Đã tích hợp API thật |
| Kiểm tra chống ảnh CCCD giả mạo | eKYC | Đã tích hợp API thật, ở dạng cảnh báo hỗ trợ chứ không chặn cứng quy trình |
| Xác thực khuôn mặt trước khi ký duyệt báo cáo | eKYC (Face Liveness) | Đang trong quá trình xin cấp quyền API từ VNPT |
| Tra cứu liên thông hồ sơ liên viện | Đề án 06 | Mô phỏng quy trình, chưa có quyền truy cập cơ sở dữ liệu quốc gia |

> Chúng tôi lựa chọn cách trình bày minh bạch: nói rõ phần nào đã chạy trên dữ liệu thật, phần nào là mô phỏng quy trình. Với một sản phẩm y tế, sự minh bạch về năng lực hệ thống là yếu tố xây dựng niềm tin lâu dài với người dùng.

---

## 4. 🔬 Luồng trải nghiệm của bác sĩ

1. **Tiếp nhận:** quét CCCD hoặc tải hồ sơ cũ, hệ thống tự dựng dòng thời gian ba giai đoạn điều trị (Tiền phẫu, Hậu phẫu nội trú, Ngoại trú)
2. **Phân tích:** AI trích xuất xét nghiệm, tự vẽ biểu đồ xu hướng biến thiên theo các mốc lâm sàng, CDE v2 tính cảnh báo tương tác thuốc và ngưỡng chống đông, đồng thời chỉ ra "khoảng trống guideline" khi dữ liệu chưa đủ để áp dụng một khuyến nghị cụ thể
3. **Hội chẩn và hỏi đáp:** chatbot MedAmi trả lời theo đúng ngữ cảnh hồ sơ đang mở, tự chuyển chế độ khi bác sĩ mở hồ sơ mới, tách riêng phần hỏi đáp về hệ thống; ghi âm hội chẩn đa chuyên khoa được tóm tắt tự động
4. **Quyết định và xuất báo cáo:** bác sĩ rà soát kết quả, có thể xuất báo cáo dành riêng cho bệnh nhân bằng ngôn ngữ phổ thông, và ký duyệt bằng xác thực sinh trắc học trước khi xuất bản chính thức

---

## 5. 🛠️ Công nghệ sử dụng

| Lớp | Công nghệ |
|---|---|
| Frontend | React (một file `App.jsx`), esbuild, không dùng framework CSS ngoài (CSS-in-JS thuần) |
| Backend | FastAPI (Python), Uvicorn |
| AI trích xuất và hội thoại | Claude (Anthropic API, claude-haiku-4-5), Prompt Caching |
| Rule engine lâm sàng | Python thuần, tất định hoàn toàn (`cde/`) |
| OCR, giọng nói, eKYC | VNPT SmartReader, SmartVoice, eKYC |
| Lưu trữ và xác thực bác sĩ | Supabase |
| Triển khai | Docker, GitHub Pages (CI/CD qua GitHub Actions, tự động thử lại khi gặp lỗi triển khai tạm thời) |

---

## 6. 🚀 Hướng dẫn trải nghiệm nhanh cho Ban Giám Khảo

```bash
git clone https://github.com/danghoang2605-ds-ai/medparcours-ai.git
cd medparcours-ai
cp .env.example .env   # điền ANTHROPIC_API_KEY, các biến khác đều tùy chọn
pip install -r requirements.txt --break-system-packages
pip install -r requirements-dev.txt --break-system-packages
npm install esbuild@0.27.7 react@19.2.6 react-dom@19.2.6
```

Gợi ý thao tác nhanh khi trải nghiệm demo:

- Bấm "Tra cứu CCCD" trên header để thử tải ảnh CCCD thật và xem OCR hoạt động
- Bấm "Ký duyệt & Xuất báo cáo" để trải nghiệm luồng xác thực sinh trắc học trước khi xuất PDF
- Vào tab "Hội chẩn AI" để thử ghi âm ngắn và xem tóm tắt hội chẩn tự động
- Bấm biểu tượng micro ở khung chat MedAmi để nói thử và thấy chữ hiện theo thời gian thực

---

## 7. 🧪 Kiểm thử

```bash
bash run_tests.sh
```

Bộ test tự động chạy hoàn toàn không cần kết nối mạng thật (mock đầy đủ Claude API và VNPT API), cho phép kiểm thử ngay cả khi chưa cấu hình `.env`. Phạm vi bao phủ bao gồm: rule engine lâm sàng, toàn bộ endpoint API kể cả các nhánh lỗi và dự phòng, tích hợp VNPT, và các thao tác CRUD hồ sơ.

Nguyên tắc thiết kế được giữ nhất quán trong toàn bộ hệ thống: tính năng lưu trữ và xác thực là phụ trợ, không được phép ảnh hưởng đến tính năng phân tích hồ sơ là chức năng chính. Nếu kết nối cơ sở dữ liệu gặp sự cố, hệ thống chỉ hiển thị lịch sử trống, còn bác sĩ vẫn phân tích được hồ sơ mới bình thường.

---

## 8. 📂 Cấu trúc thư mục

```
├── App.jsx                    # Toàn bộ frontend (một file, React + esbuild)
├── main.py                    # FastAPI: endpoint, pipeline trích xuất, dự phòng
├── database.py                # Lưu trữ hồ sơ và xác thực (Supabase)
├── vnpt_client.py              # SDK gọi API VNPT (SmartReader, SmartVoice, eKYC)
├── clinical_rules.py            # Luật lâm sàng nền
├── document_extract.py          # Trích xuất văn bản từ PDF, DOCX, XLSX, PPTX
├── cde/                          # Rule engine lâm sàng tất định
│   ├── engine.py                     # Điểm vào chính (evaluate_v2)
│   ├── disease_classifier.py         # Nhận diện bệnh cảnh và phân nhóm
│   ├── icd_groups.py                 # Mười nhóm ICD-10 hệ tuần hoàn
│   ├── anticoagulation_targets.py    # Ngưỡng INR theo loại van và ESC/AHA
│   ├── indicators.py                 # CHA2DS2-VASc, HAS-BLED, TTR
│   └── test_*.py
├── docker_setup/                 # Dockerfile backend và frontend
├── run_tests.sh                   # Chạy toàn bộ test, kết luận rõ ràng
└── test_*.py
```

---

## 9. 📌 Định hướng phát triển tiếp theo

Đội ngũ đang tiếp tục hoàn thiện các hạng mục sau, theo đúng nguyên tắc minh bạch năng lực hệ thống:

- **Tra cứu liên thông CCCD (Đề án 06):** hiện là mô phỏng quy trình, đang làm việc để có quyền truy cập cơ sở dữ liệu quốc gia thật
- **`face_compare` (so khớp khuôn mặt bác sĩ với CCCD):** đã có endpoint backend, đang hoàn thiện giao diện người dùng
- **eKYC Face Liveness:** đang chờ VNPT cấp quyền API chính thức

---

## 10. 👥 Đội ngũ

**Đăng, Tech Lead**
Phụ trách kiến trúc hệ thống tổng thể, thiết kế Hệ luật Lâm sàng Quyết định (CDE v2) và pipeline trích xuất AI. Nền tảng Data Science, University of Georgia.

**Đức Thành, Tech Co-Lead**
Đồng phát triển backend và các module tích hợp hệ thống. Sinh viên VinUniversity.

**Tấn và Ngân, Cố vấn Lâm sàng**
Rà soát và phê duyệt toàn bộ ngưỡng lâm sàng, logic rule engine và văn phong chuyên môn trong sản phẩm. Đại học Y Hà Nội.

**An, Business và GTM**
Phụ trách chiến lược sản phẩm, xây dựng đề án và định hướng go-to-market. Sinh viên IE University.
