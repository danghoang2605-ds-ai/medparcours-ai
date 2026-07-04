# Nhờ anh Tấn chọn/lọc 3 hồ sơ mẫu gửi BTC — giải thích mục đích kỹ thuật

Gửi anh Tấn,

Team cần 3 hồ sơ mẫu gửi Ban Tổ chức để họ tự chạy thử hệ thống, phục vụ tiêu
chí chấm điểm Vòng 2: **"Script test tự động/pass"** và **"Ổn định (không lỗi,
chạy ≥ 3 lần)"**. Vì BTC chấm phần này chủ yếu là dân kỹ thuật (không chuyên
y tế), mục tiêu không phải chọn ca "hay nhất về mặt y khoa" mà là chọn/chuẩn bị
sao cho hệ thống **chạy trơn tru, không lỗi, và thể hiện rõ ràng nhất giá trị kỹ
thuật** trong vài phút họ bấm thử.

Em viết rõ bên dưới **rule engine đang làm gì** để anh hiểu đúng mục đích khi
chọn/lọc hồ sơ — không phải để anh học kỹ thuật, mà để anh biết loại thông tin
nào trong hồ sơ thật sẽ "kích hoạt" đúng phần hệ thống cần khoe.

---

## 1. Vấn đề cần anh giúp: hồ sơ thật quá dài cho mục đích demo ổn định

Em biết hồ sơ thật tối thiểu 200-300 trang. Hệ thống **có** cơ chế tự lọc bớt
trang khi hồ sơ quá dài (giữ 6 trang đầu + 4 trang cuối + các trang có nhiều từ
khóa lâm sàng quan trọng nhất, bỏ bớt phần lặp lại như phiếu theo dõi thường
quy hàng ngày) — nên về lý thuyết hệ thống vẫn xử lý được hồ sơ dài. **Nhưng**
với đúng 3 ca **bắt buộc phải chạy ổn định khi BTC tự bấm thử** (không phải lúc
em ngồi cạnh xử lý sự cố), hồ sơ càng dài thì rủi ro càng cao:

- Đọc/OCR 200-300 trang tốn thời gian hơn nhiều so với hồ sơ ngắn — có giới hạn
  240 giây/lượt phân tích, hồ sơ càng dài càng dễ sát ngưỡng.
- Nếu trong 200-300 trang có nhiều trang là ảnh scan/chữ viết tay (không phải
  chữ đánh máy), hệ thống phải xử lý từng trang một cách chậm hơn nhiều.
- BTC tự bấm thử, không có em bên cạnh để retry nếu lỗi mạng/timeout — 1 lần
  thất bại giữa lúc chấm điểm là mất điểm oan uổng.

**Điều em nhờ anh:** thay vì gửi nguyên bộ hồ sơ HIS xuất ra (200-300 trang),
anh giúp chọn ra **bản tóm tắt/trích đoạn ngắn hơn nhiều** cho đúng 3 ca demo
này — ví dụ loại giấy tờ bác sĩ vẫn hay dùng để bàn giao nhanh: bệnh án tóm
tắt lúc vào viện + kết quả xét nghiệm chính (không cần từng phiếu xét nghiệm
lẻ) + diễn biến các mốc quan trọng + giấy ra viện. Ước chừng **10-20 trang** là
đủ cho mục đích này (không cần đầy đủ như hồ sơ lưu trữ chính thức).

Hồ sơ 200-300 trang đầy đủ **vẫn rất quý** — mình giữ riêng để dùng khi giám
khảo hỏi phản biện "hệ thống có xử lý được hồ sơ thật phức tạp không", lúc đó
em có thể chạy trực tiếp cho họ xem (chấp nhận rủi ro cao hơn vì là câu hỏi mở,
không phải bài test bắt buộc).

---

## 2. Rule engine đang làm gì (để anh biết cần loại thông tin nào)

Hệ thống chạy 3 bước:

1. **AI đọc hồ sơ** → trích thành dữ liệu có cấu trúc (chẩn đoán, xét nghiệm
   kèm ngày đo, thuốc, phẫu thuật...). AI **không** được tự đánh giá/tính toán
   gì ở bước này.
2. **Bộ luật code cứng (không qua AI)** — đây là phần "chất xám" của sản phẩm,
   quyết định mọi con số an toàn tính mạng:
   - Phân loại bệnh nhân vào 10 nhóm bệnh hệ tuần hoàn theo ICD-10 (van tim,
     mạch vành, rối loạn nhịp, suy tim...) — 1 bệnh nhân có thể thuộc nhiều
     nhóm cùng lúc.
   - Tính eGFR (chức năng thận) theo công thức CKD-EPI 2021 — cần **Creatinin
     + tuổi + giới tính**.
   - Ngưỡng INR mục tiêu **phân biệt theo từng loại can thiệp van** (sửa van /
     thay van sinh học / thay van cơ học / không liên quan van) — đây là phần
     mới sửa, trước đây hệ thống nhầm coi mọi bệnh nhân đều là ca van cơ học.
   - Phát hiện "khoảng trống guideline" — ví dụ nghi ngờ suy tim nhưng chưa đo
     lại NT-proBNP sau ra viện, van cơ học nhưng chưa đủ số lần đo INR để đánh
     giá TTR.
   - Cảnh báo tương tác thuốc, trùng nhóm thuốc, ưu tiên khi phối hợp nhiều
     thuốc chống huyết khối.
3. **AI diễn đạt lại xu hướng** thành câu văn — chỉ dựa đúng số liệu bước 2 đã
   tính, không được bịa thêm.

**Nói ngắn gọn cho mục đích chọn hồ sơ:** hồ sơ càng có nhiều **con số lặp lại
theo thời gian, kèm ngày rõ ràng** (ví dụ Creatinin đo 3 lần khác ngày, INR đo
nhiều lần) thì càng khoe được rõ phần biểu đồ xu hướng + phát hiện khoảng
trống — đây là phần trực quan nhất, dễ hiểu nhất với người không chuyên y.

---

## 3. Tiêu chí cụ thể cho 3 ca (đã điều chỉnh theo ràng buộc hồ sơ ngắn)

| # | Tiêu chí | Vì sao |
|---|---|---|
| 1 | 3 ca thuộc **3 nhóm bệnh cảnh khác nhau** — không cả 3 đều là van tim | Chứng minh hệ thống không còn mặc định mọi bệnh nhân là ca van tim (điểm yếu đã biết trước đây, giờ đã sửa) |
| 2 | Mỗi ca **chỉ 1 đợt nằm viện, 1 mốc phẫu thuật/can thiệp (nếu có)** — không chọn ca nhiều đợt nhập viện chồng chéo | Loại dữ liệu nhiều mốc thời gian là dễ lỗi nhất hiện tại — để dành cho phần hỏi đáp, không đưa vào bài test bắt buộc |
| 3 | Có **Creatinin + tuổi + giới tính** rõ ràng | Để tính được eGFR — 1 con số cụ thể, dễ giải thích cho người không chuyên y |
| 4 | Có **ít nhất 1 chỉ số xét nghiệm đo từ 2-3 lần trở lên, mỗi lần ghi rõ ngày** | Để khoe biểu đồ xu hướng + phát hiện khoảng trống — phần trực quan nhất |
| 5 | Bản rút gọn khoảng **10-20 trang**, ưu tiên chữ đánh máy rõ (hạn chế ảnh scan/chữ viết tay nếu được) | Giảm rủi ro timeout/lỗi OCR khi BTC tự bấm thử |

Nếu khó tìm đủ 3 nhóm bệnh cảnh khác nhau (như anh có nói ở câu hỏi 11, ít làm
ở Viện Tim mạch nên khó xin đa dạng ca), **ưu tiên tối thiểu**: đảm bảo **không
phải cả 3 ca đều là bệnh nhân van tim** — chỉ cần né đúng điểm yếu cũ là đủ,
không bắt buộc phải đủ 3 nhóm hoàn toàn khác nhau.

---

## 4. Định dạng mong muốn

- File PDF (chữ đánh máy, không cần scan lại nếu bản gốc đã là văn bản).
- Đã ẩn danh/thay tên giả theo đúng cách team vẫn làm với 2 ca demo hiện có
  (Nguyễn Văn A/B) — không cần thông tin định danh thật.
- Không cần đúng format HIS xuất ra — bản tóm tắt do anh biên soạn lại là ổn,
  miễn giữ đúng số liệu thật (ngày tháng, giá trị xét nghiệm) để hệ thống chạy
  đúng ý nghĩa.

Anh xem giúp em có thể chuẩn bị được không, và nếu cần trao đổi thêm để rõ hơn
ca nào phù hợp thì mình gọi trực tiếp cho nhanh. Cảm ơn anh nhiều!
