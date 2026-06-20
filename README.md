# MedParcours AI

**Trợ lý lâm sàng đa chế độ cho bác sĩ và sinh viên y khoa.**

Đọc hồ sơ nhanh hơn, quyết định lâm sàng tự tin hơn. MedParcours AI đọc hồ sơ xuất từ HIS, tự động tóm tắt, cảnh báo nguy cơ và hỗ trợ hội chẩn cùng giảng dạy lâm sàng.

---

## 1. Bối cảnh cuộc thi

| Hạng mục | Thông tin |
|---|---|
| Cuộc thi | Vietnamese Student HackAIthon 2026 |
| Bảng | Bảng B Challenger |
| Đề tài | Đề tài 5: Y tế |
| Đội thi | Team UN1SVENGERS |
| Đơn vị tổ chức | Hội Sinh viên Việt Nam, Vietcombank |
| Bảo trợ chuyên môn | VNPT AI |
| Đơn vị thực hiện | VSDS |

---

## 2. Vấn đề

Một hồ sơ bệnh án xuất từ HIS có thể dài hàng trăm trang, dữ liệu nằm rải rác qua nhiều lần khám, nhiều khoa, nhiều phiếu xét nghiệm và chẩn đoán hình ảnh. Bác sĩ phải tốn rất nhiều thời gian để:

- Đọc và ghép nối diễn biến của người bệnh theo thời gian.
- Phát hiện các tín hiệu nguy cơ dễ bị bỏ sót (tương tác thuốc, chỉ số bất thường, biến chứng sau mổ).
- Tổng hợp thông tin để hội chẩn hoặc giảng dạy.

Áp lực thời gian và khối lượng dữ liệu lớn làm tăng nguy cơ bỏ lỡ thông tin quan trọng.

---

## 3. Giải pháp

MedParcours AI biến một hồ sơ thô thành một báo cáo có cấu trúc, trực quan và có thể hỏi đáp, chỉ trong khoảng 30 giây.

Điểm khác biệt cốt lõi nằm ở **quy trình lai (hybrid) ba bước**, kết hợp sức mạnh ngôn ngữ của AI với độ tin cậy của một bộ luật tất định:

1. **Trích xuất (AI đọc hồ sơ).** Mô hình ngôn ngữ đọc toàn bộ hồ sơ và bóc tách thông tin thành dữ liệu có cấu trúc (thông tin hành chính, chẩn đoán, diễn biến, xét nghiệm, siêu âm, thuốc).
2. **Đánh giá an toàn (bộ luật lâm sàng tất định).** Một rule engine viết bằng Python đảm nhận các phép đánh giá quan trọng về an toàn (phân tầng nguy cơ, kiểm tra ngưỡng chỉ số, an toàn thuốc). Bước này không phụ thuộc vào suy đoán của AI nên cho kết quả nhất quán và kiểm chứng được.
3. **Diễn giải (AI trình bày).** AI chuyển kết quả thành bản tóm tắt, biện luận và cảnh báo dễ đọc cho con người.

Cách tiếp cận này giúp tận dụng khả năng đọc hiểu của AI mà vẫn giữ được tính an toàn và minh bạch cho các quyết định lâm sàng.

---

## 4. Ba chế độ sử dụng

Cùng một hồ sơ, người dùng chuyển đổi linh hoạt giữa ba góc nhìn:

### Bác sĩ (Lâm sàng)
Bảng tổng quan lâm sàng theo 3 giai đoạn (Tiền phẫu, Hậu phẫu, Ngoại trú): kết luận nhanh, trạng thái vấn đề, hành động ưu tiên, biểu đồ siêu âm tim, bảng xét nghiệm, theo dõi thuốc và an toàn thuốc.

### Hội chẩn AI (Virtual MDT)
Mô phỏng một buổi hội chẩn đa chuyên khoa: tự động chọn các chuyên khoa liên quan kèm lý do mời, từng khoa đưa ra kết luận và đề xuất riêng, có độ tin cậy và dữ liệu còn thiếu, sau đó tổng hợp thành đồng thuận cuối cùng. Có thư ký ảo MedAmi để hỏi đáp về biên bản hội chẩn.

### Học vụ (Giảng dạy)
Trình bày ca bệnh theo khung bệnh án ngoại khoa của Đại học Y Hà Nội (HMU): hành chính, bệnh sử, tiền sử, khám, tóm tắt, chẩn đoán sơ bộ và phân biệt, biện luận, cận lâm sàng, điều trị, tiên lượng, dự phòng. Có chế độ tự luyện (Guided) và thử thách (Challenge), câu hỏi vấn đáp kiểu Socratic và các điểm cảnh báo (red flags).

---

## 5. Tính năng nổi bật

- Phân tích và tóm tắt diễn biến lâm sàng tự động theo 3 giai đoạn.
- Phát hiện và cảnh báo sớm nguy cơ dựa trên hồ sơ, có bộ lọc theo mức độ (Khẩn, Cảnh báo, Ổn định).
- Biểu đồ trực quan: tiến triển EF và chênh áp van qua các lần siêu âm, dấu hiệu sinh tồn, bảng xét nghiệm có xu hướng.
- So sánh hai lần tái khám cạnh nhau, thể hiện chỉ số tăng hay giảm theo ý nghĩa lâm sàng.
- Trợ lý ảo MedAmi: chatbot hỏi đáp chuyên sâu riêng cho từng hồ sơ, gợi ý câu hỏi thay đổi theo chế độ đang xem.
- Lời dặn của bác sĩ: nhập trực tiếp hoặc đọc bằng giọng nói (tiếng Việt) để đính kèm cùng hồ sơ.
- Xuất báo cáo và in theo từng chế độ: bản lâm sàng, biên bản hội chẩn, tài liệu giảng dạy.
- Lịch sử bệnh án, tìm nhanh trong báo cáo, sao chép nhanh các kết luận.
- Giao diện sáng và tối, điều hướng theo mục, tối ưu cho trải nghiệm bác sĩ.

---

## 6. Quy trình sử dụng

1. Đăng nhập vào hệ thống.
2. Tải lên hồ sơ xuất từ HIS (PDF, ảnh, Word, Excel, PowerPoint). Có thể kèm lời dặn của bác sĩ.
3. Hệ thống phân tích và tạo báo cáo có cấu trúc trong khoảng 30 giây.
4. Bác sĩ xem báo cáo, chuyển đổi giữa ba chế độ, đặt câu hỏi cho MedAmi và xuất báo cáo khi cần.

---

## 7. Công nghệ

- **Giao diện (Frontend):** React, triển khai dạng web tĩnh.
- **Xử lý (Backend):** dịch vụ phân tích bằng Python (FastAPI).
- **Trí tuệ nhân tạo:** mô hình ngôn ngữ lớn cho bước đọc hiểu và diễn giải, kết hợp bộ luật lâm sàng tất định cho các đánh giá an toàn.
- **Xử lý tài liệu:** trích xuất văn bản từ PDF ngay trên trình duyệt để hồ sơ lớn vẫn xử lý mượt.

---

## 8. Trải nghiệm bản demo

- **Tài khoản dùng thử:** `hackaithon2026`
- **Mật khẩu:** `medparcours`

Có sẵn hai hồ sơ minh họa đã ẩn danh để ban giám khảo trải nghiệm đầy đủ tính năng:

- **Nguyễn Văn A:** sau phẫu thuật thay van động mạch chủ cơ học On-X, theo dõi ngoại trú.
- **Nguyễn Văn B:** sửa van hai lá và van ba lá, diễn tiến hậu phẫu phức tạp, có chuỗi siêu âm tim theo thời gian.

Mọi dữ liệu bệnh nhân trong bản demo đều đã được ẩn danh.

---

## 9. Hướng phát triển

- Mở rộng bộ luật lâm sàng cho nhiều chuyên khoa hơn.
- Tăng độ phong phú của thư viện ca bệnh mẫu phục vụ giảng dạy.
- Bổ sung so sánh đa lần khám và theo dõi dài hạn.
- Hoàn thiện trải nghiệm trên thiết bị di động.

---

## 10. Đội ngũ Team UN1SVENGERS

| Thành viên | Vai trò |
|---|---|
| Đăng | Tech Lead, Quản lý sản phẩm |
| Đức Thành | Frontend, Đồng trưởng nhóm kỹ thuật |
| Tấn | Chuyên môn lâm sàng |
| Ngân | Chuyên môn lâm sàng |
| An | Phụ trách kinh doanh |

---

## Lưu ý

MedParcours AI là công cụ hỗ trợ ra quyết định. Mọi báo cáo do hệ thống tạo ra cần được bác sĩ xem xét và chịu trách nhiệm trước khi sử dụng cho mục đích lâm sàng.

*Sản phẩm dự thi Vietnamese Student HackAIthon 2026 - Team UN1SVENGERS.*
