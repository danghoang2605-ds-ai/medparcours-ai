# MedParcours AI — Kế hoạch nâng cấp & tinh chỉnh (Vòng 2)

Cập nhật: 27/06/2026
Người soạn: Claude (theo yêu cầu Đăng, Tech Lead)

Mục đích file: tổng hợp (1) việc cần sửa/nâng cấp ở bản proposal Vòng 1 (đã đạt 86.5/100) để chuẩn bị hồ sơ/pitch Vòng 2, và (2) roadmap kỹ thuật chi tiết — pipeline từng bước cho ECG, các API VNPT, và các tính năng lâm sàng còn lại.

---

## MỤC LỤC

1. [Tình trạng hiện tại (đối chiếu code thật)](#1-tình-trạng-hiện-tại-đối-chiếu-code-thật)
2. [PHẦN A — Business Proposal: việc cần sửa](#2-phần-a--business-proposal-việc-cần-sửa)
3. [PHẦN B — Roadmap kỹ thuật chi tiết](#3-phần-b--roadmap-kỹ-thuật-chi-tiết)
   - 3.1 [ECG số hóa — pipeline 3 mức](#31-ecg-số-hóa--pipeline-3-mức)
   - 3.2 [API VNPT — pipeline tích hợp](#32-api-vnpt--pipeline-tích-hợp)
   - 3.3 [Tính năng lâm sàng còn lại](#33-tính-năng-lâm-sàng-còn-lại)
   - 3.4 [Hạ tầng & vận hành](#34-hạ-tầng--vận-hành)
4. [Thứ tự thực thi đề xuất](#4-thứ-tự-thực-thi-đề-xuất)
5. [Rủi ro & điểm cần Tấn/Ngân duyệt](#5-rủi-ro--điểm-cần-tấnngân-duyệt)

---

## 1. TÌNH TRẠNG HIỆN TẠI (đối chiếu code thật)

Trước khi lên kế hoạch, đây là sự khác biệt quan trọng giữa **bản proposal Vòng 1** (71 trang, đã nộp) và **code thật** hiện tại — vì đây là chỗ Giám khảo/Mentor Vòng 2 dễ hỏi xoáy nhất khi đối chiếu slide với demo.

| Mục trong proposal | Trạng thái thật (27/06/2026) |
|---|---|
| Sơ đồ pipeline 3 bước (trang 13) | ✅ Đúng — đã chạy thật: REPORT_SYSTEM → rule engine Python → TREND_SYSTEM |
| Prompt Caching (trang 51, giả định "= 1") | ✅ Đã làm xong trong phiên này — cache REPORT_SYSTEM + ho_so_text trong /chat |
| Thang điểm CHA2DS2-VASc/HAS-BLED | ✅ Đã làm — tất định, dò keyword tiếng Việt trên chẩn đoán/tiền sử |
| Kiến trúc tài khoản bác sĩ + Supabase + RLS + audit log (trang 14) | ❌ Chưa làm — vẫn là **kế hoạch**, hệ thống hiện dùng đăng nhập demo cứng |
| 3 chế độ Bác sĩ / Hội chẩn AI (MDT) / Học vụ (trang 12, 27-30) | ❌ Chưa có trong code hiện tại — không thấy endpoint `/mdt`, `/teaching` |
| ECG số hóa (trang 40, mục "tính nâng cấp") | 🟡 Đang làm — Mức 1 (số hóa + vẽ lại) đã xong, dùng ảnh tổng hợp test; Mức 2-3 chưa làm; ảnh thật từ anh Tấn chưa có |
| An toàn thuốc nâng cao (tương tác, eGFR) | ✅ Đã có nền tảng tốt trong `clinical_rules.py` (interaction rules, renal rules, favorable rules) |
| Docker 1-lệnh + pytest | ❌ Chưa làm |
| Care-gap detector | ❌ Chưa làm |
| TTR anticoagulation tracking | ❌ Chưa làm |
| API VNPT (SmartVoice, SmartReader, Smartbot) | ❌ Chưa làm — đang chờ key thật từ An; có thể viết khung gọi API trước |

**Khuyến nghị tổng quát:** Mentor Vòng 2 sẽ đọc proposal trước khi xem demo. Bất kỳ chỗ nào proposal "nói lớn hơn thực tế" cần được làm thật **hoặc** được nói rõ trong pitch là "đây là roadmap, chưa triển khai" — không để mơ hồ giữa 2 trạng thái.

---

## 2. PHẦN A — BUSINESS PROPOSAL: VIỆC CẦN SỬA

Barem Vòng 2 khác Vòng 1 — không còn chấm "ý tưởng" mà chấm **sản phẩm + chiến lược GTM cụ thể**. Dưới đây là việc cần sửa trong slide/proposal, xếp theo 5 nhóm tiêu chí Vòng 2 (Hoàn thiện sản phẩm 20đ, UX 20đ, Triển khai & mở rộng 20đ, Go-to-market 25đ, Tính nâng cấp 10đ).

### 2.1 Hoàn thiện sản phẩm (20đ)

**Vấn đề:** Proposal Vòng 1 mô tả kiến trúc tài khoản/Supabase/RLS (trang 14) như đã có, nhưng đây vẫn là thiết kế trên giấy.

**Việc cần làm:**
- Hoặc làm thật phần Docker 1-lệnh + script test (xem mục 3.4) để khi giám khảo hỏi "demo MVP chạy được bao nhiêu lần không lỗi" thì có số liệu thật trả lời, không phải hứa.
- Trong slide Vòng 2, **tách rõ 2 cột**: "Đã triển khai và demo được" vs "Thiết kế kỹ thuật, chưa triển khai (roadmap)". Đừng để giám khảo tự suy luận nhầm.
- Bổ sung 1 slide "Bảo mật dữ liệu thực tế hiện tại" — vì giám khảo Vòng 2 quan tâm "đảm bảo an toàn thông tin" là 1 ý trong nhóm 20đ này. Hiện tại hệ thống dùng tài khoản demo cứng — cần nói thật và có lộ trình ngắn (vd: ẩn danh hóa số bệnh án trước khi gửi LLM, không lưu trữ hồ sơ sau phiên).

### 2.2 Trải nghiệm người dùng (20đ)

**Vấn đề:** Barem Vòng 2 yêu cầu rõ "Xây dựng bộ chỉ số đo lường trải nghiệm (UX Metrics) và lộ trình liên tục tối ưu". Proposal Vòng 1 chỉ có số ước lượng tổng quát ("80% tiết kiệm thời gian" — không rõ đo từ đâu).

**Việc cần làm:**
- Đo UX metric **thật**, dù chỉ là pilot nhỏ nội bộ: thời gian từ lúc tải PDF tới khi đọc xong báo cáo, so với thời gian đọc thủ công hồ sơ tương đương (có thể tự đo bằng cách cho 2-3 người không phải nhóm thử cả 2 cách).
- Thêm 1 slide UX Metrics Framework: định nghĩa rõ sẽ đo gì khi ra thị trường thật (Time-to-Insight, Click count đến hành động ưu tiên, NPS bác sĩ dùng thử) — kể cả nếu chưa đo được số thật ngay, có khung đo là điểm cộng.

### 2.3 Triển khai & mở rộng (20đ) — "Phát triển hạ tầng theo BTC"

Đây là tên gọi đầy đủ trong barem chính thức: **"Khả năng triển khai và mở rộng"**, gồm 2 ý — (a) tính tối ưu trên hạ tầng đang dùng, (b) phương án tăng cường khi mở rộng quy mô. Đây cũng là nhóm tiêu chí mà mentor (cấp tài nguyên API + đánh giá "hiệu quả làm việc, mức độ khả thi") soi kỹ nhất, vì là người trực tiếp hỗ trợ kỹ thuật cho các đội.

**(a) Tính tối ưu trên hạ tầng — đã làm được gì, còn thiếu gì:**
- ✅ Prompt Caching (REPORT_SYSTEM + ho_so_text trong /chat) — giảm chi phí input lặp lại.
- ✅ `select_relevant_text()` lọc trang theo điểm tín hiệu lâm sàng — giữ hồ sơ trong ngân sách token mà không cắt cụt đầu/cuối.
- ❌ Chưa đo số liệu *thật* — bảng chi phí hiện tại (trang 51-53 proposal) là giả lập, chưa có log request thật để chứng minh số tiết kiệm sau khi bật caching.

**(b) Phương án mở rộng quy mô — đây là phần proposal V1 còn thiếu nhất (chỉ 1 dòng), và PHẢI nối tiếp đúng kiến trúc đã thiết kế ở trang 14 (Supabase + RLS + on-premise), không đề xuất hướng khác mâu thuẫn.**

Bối cảnh quan trọng cần nhắc lại: kiến trúc tài khoản bác sĩ + lịch sử phân tích (trang 14) đã được thiết kế kỹ trước đó theo đúng 3 nguyên tắc:
1. Supabase (Postgres + Auth) cho giai đoạn demo/pilot — giải quyết việc HF Spaces free tier mất dữ liệu khi Space restart (lưu trữ tạm).
2. Row Level Security (RLS) — mỗi bác sĩ chỉ thấy dữ liệu bệnh viện mình.
3. **On-premise là hướng triển khai thật** khi bệnh viện chấp nhận — vì dữ liệu bệnh nhân là dữ liệu cá nhân nhạy cảm theo Luật Bảo vệ dữ liệu cá nhân 2025 (Luật 91/2025/QH15), bệnh viện thật sẽ không cho dữ liệu nằm trên cloud công khai nếu chưa có thỏa thuận riêng.

Phương án scale phải xây trên đúng 3 nguyên tắc này — không phải nghĩ kiến trúc mới. Cụ thể, "điều gì xảy ra khi 10 bệnh viện cùng dùng" được trả lời theo 2 giai đoạn khác hẳn nhau:

**Giai đoạn Pilot/Demo (1-5 bệnh viện, dữ liệu ẩn danh, đúng quy mô Vòng 2/Chung kết):**

| Điểm nghẽn | Vấn đề | Phương án |
|---|---|---|
| HF Spaces free tier | Sleep khi không dùng → cold start chậm (vài chục giây) lần đầu | Nâng cấp "luôn bật" (~$9/tháng, đã có trong bảng giá trang 53) — chỉ cần làm khi pilot thật, KHÔNG cần cho demo Vòng 2 |
| Anthropic API rate limit | Nhiều bác sĩ phân tích cùng lúc → có thể chạm rate limit theo tier tài khoản | Hiện tại traffic thấp (vài đội demo) nên chưa chạm ngưỡng — ghi vào roadmap: theo dõi usage dashboard Anthropic Console, nâng tier khi cần, không cần làm queue ngay |
| Không có database | Mỗi lần phân tích là 1 phiên độc lập, không lưu lịch sử | Đúng kiến trúc trang 14: Supabase (Postgres + Auth + RLS) cho **dữ liệu bệnh nhân ẩn danh** — đủ để demo tính năng "Lịch sử truy vấn hồ sơ" (trang 11) mà không vướng pháp lý |

**Giai đoạn thương mại hóa thật (Giai đoạn 3 GTM, theo proposal trang 61-63):**

| Điểm nghẽn | Vấn đề | Phương án |
|---|---|---|
| Dữ liệu bệnh nhân thật, không ẩn danh | Vướng Luật 91/2025/QH15 trực tiếp | **On-premise**: backend + database chạy trên hạ tầng bệnh viện, dữ liệu không rời hệ thống — đúng định hướng đã chốt, biến thành lợi thế cạnh tranh khi pitch ("dữ liệu không rời viện" là câu trả lời sẵn cho câu hỏi bảo mật mà giám khảo VNPT AI gần như chắc chắn hỏi) |
| 1 bệnh viện → nhiều bệnh viện | Mỗi viện cần instance riêng (vì on-premise) | Đóng gói Docker Compose (đang làm ở mục 3.4 dưới) thành **bộ cài đặt chuẩn cho IT bệnh viện**, không phải chỉ để dev tự chạy — đây là điểm cộng kép: vừa giải quyết "Docker 1-lệnh" (Hoàn thiện sản phẩm 20đ), vừa giải quyết "mở rộng quy mô" (mục này) |
| Nhiều viện, cần thống nhất rule engine | Nếu mỗi viện chạy bản riêng, cập nhật ngưỡng lâm sàng (CHA2DS2-VASc, drug safety...) phải đẩy lại cho từng viện | Tách `clinical_rules.py` + `ecg_engine.py` thành phiên bản đóng gói (vd: PyPI package nội bộ hoặc Docker image versioned) — cập nhật 1 lần, các viện pull bản mới theo lịch riêng |

**Slide cần thêm cho Vòng 2:** 1 sơ đồ "2 giai đoạn hạ tầng" (Pilot cloud-ẩn-danh → Thương mại on-premise) — biến đúng điểm yếu (chưa scale) thành câu chuyện có chủ đích ("chúng tôi thiết kế để scale đúng cách, không phải scale bằng mọi giá bất kể pháp lý y tế").

### 2.4 Go-to-market (25đ) — phần của An, nhưng có vài điểm kỹ thuật cần khớp lại

**Vấn đề kỹ thuật cần An biết để sửa số liệu GTM:**
- Trang 53 (SOM): nói "Hơn 1.100/1.650 cơ sở y tế đã áp dụng EMR" để đo thị trường — nhưng định vị sản phẩm (trang 47) là "**không cần EHR**, nhập PDF độc lập". Đây là **mâu thuẫn logic**: nếu lợi thế là không cần EHR, sao đo SOM bằng số bệnh viện đã có EHR? Nên đổi cách đo SOM theo số bệnh viện **có hồ sơ PDF xuất từ HIS** (rộng hơn, vì hầu hết HIS nào cũng xuất được PDF, không cần EHR đầy đủ).
- Mô hình giá (Giai đoạn 3, trang 62) đề ra "B2B SaaS Licensing theo số ca lâm sàng" — cần khớp với chi phí AI thật đã tính (1.040đ/hồ sơ ở thời điểm Vòng 1; **giờ có Prompt Caching, số này sẽ giảm** — cần An cập nhật lại bảng giá cho khớp số mới).

### 2.5 Tính nâng cấp (10đ)

**Việc cần làm — đây là phần dễ ăn điểm nhất vì có thể show ngay:**
- CHA2DS2-VASc + HAS-BLED: đã làm — đưa vào slide Vòng 2 kèm screenshot Card thật.
- ECG Mức 1: đã làm — đưa ảnh tổng hợp + signal trích xuất vào slide minh họa pipeline (xem mục 3.1 để biết cách trình bày).
- Ghi rõ trong slide: "đã áp dụng phản hồi mentor [cụ thể nếu có]" — barem Vòng 2 chấm điểm cho mục này riêng, không nói chung "đã cải tiến".

---

## 3. PHẦN B — ROADMAP KỸ THUẬT CHI TIẾT

### 3.1 ECG số hóa — pipeline 3 mức

Định vị bắt buộc: **trực quan hóa hỗ trợ, không phải máy chẩn đoán.** Không tự gán nhãn bệnh ("AFib", "nhịp chậm"...) ở bất kỳ mức nào.

#### Mức 1 — Số hóa + vẽ lại (✅ ĐÃ XONG)

```
Ảnh ECG (base64)
      │
      ▼
[1] Đọc ảnh, chuyển không gian màu BGR → HSV
      │
      ▼
[2] Tách lưới hồng/đỏ:
    - Mask theo Hue đỏ/hồng (0-25° và 340-360°)
    - Saturation ≤ 140 (lưới nhạt, không bão hòa cao)
    - Giữ lại pixel KHÔNG thuộc lưới VÀ có Value ≤ 110 (đậm = đường tín hiệu)
      │
      ▼
[3] Trích cột pixel:
    - Mỗi cột x: lấy vị trí trung bình các pixel "tín hiệu" trong cột đó
    - Cột không có pixel tín hiệu → đánh dấu NaN
      │
      ▼
[4] Nội suy + làm mượt:
    - Nội suy tuyến tính các cột NaN (đứt nét do nhiễu/mờ)
    - Savitzky-Golay filter (window=9, polyorder=2) làm mượt nhiễu
      │
      ▼
[5] Chuẩn hóa 0-1, đảo trục y (ảnh: y tăng xuống dưới ↔ tín hiệu: giá trị tăng lên)
      │
      ▼
signal[] → FE vẽ lại bằng SVG (đường mượt, có thể khoanh vùng)
```

**File:** `ecg_engine.py` (đã tạo). **Endpoint:** `POST /ecg` (ảnh thật), `GET /ecg/synthetic` (ảnh giả test pipeline).

**Trạng thái kiểm thử:** đã test với ảnh tự sinh (sóng PQRST xấp xỉ + lưới hồng chuẩn) — trích được 100% cột tín hiệu, không nhiễu từ lưới. **Chưa test với ảnh thật** (anh Tấn chưa gửi) — ngưỡng màu (`GRID_HUE_RANGES`, `SIGNAL_VALUE_MAX`) gần như chắc chắn cần tinh chỉnh lại khi có ảnh chụp điện thoại thật (lóa, nghiêng, độ phân giải thấp).

#### Mức 2 — Đo R-R + nhịp tim (CHƯA LÀM)

```
signal[] (từ Mức 1)
      │
      ▼
[6] Detect đỉnh R bằng scipy.signal.find_peaks:
    - Ngưỡng biên độ tối thiểu (height) — lọc nhiễu nhỏ không phải QRS
    - Khoảng cách tối thiểu giữa 2 đỉnh (distance) — tránh đếm trùng trong 1 QRS
      │
      ▼
[7] Tính khoảng R-R (px) giữa các đỉnh liên tiếp
      │
      ▼
[8] Chuyển R-R (px) → R-R (giây) → nhịp tim (bpm):
    - CẦN: tốc độ giấy ECG chuẩn (thường 25mm/s) + độ phân giải ảnh (px/mm)
    - Nếu ảnh KHÔNG có thước chuẩn để suy ra px/mm:
      → Cho bác sĩ NHẬP tay mm/s, HOẶC
      → Ước lượng dựa theo độ rộng lưới ô lớn chuẩn (thường 5mm/ô)
      → BẮT BUỘC ghi rõ "ước lượng" trên giao diện nếu dùng cách suy luận gián tiếp
      │
      ▼
{bpm: ước tính, peaks: [...], "ước lượng": true/false}
```

**Rủi ro chính:** nếu suy sai tỉ lệ px/mm, nhịp tim tính ra sẽ sai hoàn toàn (không phải sai lệch nhỏ — có thể gấp đôi/giảm nửa). Đây là lý do mức 2 cần ảnh thật để test kỹ trước khi đưa vào demo chính thức.

#### Mức 3 — Cờ nhịp bất thường (CHƯA LÀM, RỦI RO CAO — chỉ làm nếu dư thời gian)

```
R-R intervals (từ Mức 2)
      │
      ▼
[9] Tính độ biến thiên R-R (vd: hệ số biến thiên CV = std/mean)
      │
      ▼
[10] Nếu CV vượt ngưỡng (cần Tấn/Ngân chốt ngưỡng cụ thể):
     → Cờ: "Nhịp R-R không đều rõ rệt, cần bác sĩ xác nhận"
     → TUYỆT ĐỐI KHÔNG ghi "AFib", "rung nhĩ", hay bất kỳ tên bệnh nào
```

**Khuyến nghị:** xếp Mức 3 cuối cùng và chỉ làm khi Mức 1-2 đã chạy ổn trên ảnh thật. Đây là phần dễ bị hiểu nhầm thành "AI tự chẩn đoán" nhất nếu UI trình bày không cẩn thận — rủi ro uy tín cao hơn lợi ích demo.

#### Việc làm được ngay (không cần ảnh thật)

- Test pipeline Mức 1 với ảnh "khó" tự tạo: nghiêng vài độ, thêm vùng lóa sáng, nhiễu mạnh hơn, mô phỏng 12-lead (nhiều đường chồng nhau) — để biết trước cần thêm bước tiền xử lý gì (deskew, cân bằng sáng CLAHE) trước khi nhận ảnh thật.
- Viết sẵn code Mức 2 (`find_peaks`) trên `signal[]` đã có từ Mức 1 — logic peak detection không phụ thuộc ảnh thật để viết, chỉ phụ thuộc ảnh thật để **tinh chỉnh tham số ngưỡng**.

---

### 3.2 API VNPT — pipeline tích hợp

**Nguyên tắc bắt buộc:** gọi từ BACKEND (giấu AppKey/SecretKey), không gọi trực tiếp từ React. Mỗi API là 1 endpoint riêng + xử lý lỗi rõ (timeout, key sai, rate limit).

**Việc chặn:** cần An lấy AppKey/SecretKey từ hệ thống BTC. Trong lúc chờ, viết khung gọi API (`vnpt_client.py`) với cấu trúc rõ ràng, dùng key giả để test logic — khi có key thật chỉ cần đổi biến môi trường.

#### 3.2.a SmartVoice (Speech-to-Text) — làm trước, rủi ro thấp nhất

```
Bác sĩ bấm "Ghi âm" trên Smart Input Box (component AudioRecorder, đã có sẵn FE)
      │
      ▼
[1] FE ghi âm → gửi file audio (base64 hoặc multipart) lên BE
      │
      ▼
[2] BE gọi VNPT SmartVoice Speech-to-Text API
    (endpoint riêng: POST /voice/transcribe)
      │
      ▼
[3] Hậu xử lý: medical_abbreviation_expander(text)
    - Dịch viết tắt/khẩu ngữ bác sĩ nói thành cụm chuẩn
    - Ví dụ: "EF giảm" → "Phân suất tống máu (EF) giảm"
             "INR vọt" → "INR tăng đột ngột"
             "ĐMC khít" → "Hẹp van động mạch chủ mức độ khít"
    - Cần Tấn/Ngân cung cấp thêm danh sách viết tắt khẩu ngữ thường gặp
      │
      ▼
[4] Trả text đã chuẩn hóa → FE đính kèm vào hồ sơ / ghi chú bác sĩ
```

**Lỗi cần xử lý:** timeout ghi âm dài, audio chất lượng kém (tiếng ồn phòng bệnh), key VNPT sai/hết hạn.

#### 3.2.b SmartReader (OCR) — làm sau, giải đúng vấn đề thật

```
Hồ sơ là ảnh chụp/scan mờ, hoặc trang viết tay (pypdf không đọc được text layer)
      │
      ▼
[1] FE phát hiện: pypdf/pdf.js trích text layer ra rỗng hoặc quá ít ký tự
    (logic đã có sẵn: MIN_TOTAL_CHARS trong main.py — tận dụng lại signal này)
      │
      ▼
[2] FE gửi ảnh/trang đó lên BE qua endpoint riêng: POST /ocr/extract
      │
      ▼
[3] BE gọi VNPT SmartReader OCR + Bóc tách thông tin
      │
      ▼
[4] Chuẩn hóa output OCR → JSON text giống định dạng pypdf đang trả
    (để không phải sửa lại pipeline run_analysis_pipeline() hiện có)
      │
      ▼
[5] Gộp vào ho_so_text → tiếp tục pipeline 3 bước như cũ (Claude → rule engine → Claude)
```

**Lý do làm sau SmartVoice:** rủi ro tích hợp cao hơn (phải đảm bảo output OCR tương thích với cách `select_relevant_text()` đang phân trang dựa trên marker "TRANG X" — cần test kỹ để không phá luồng dòng thời gian hồ sơ).

#### 3.2.c Smartbot — để cuối, không ưu tiên

MedAmi (chatbot hỏi đáp theo hồ sơ, dùng trực tiếp Claude qua `/chat`) đã làm tốt vai trò này. Smartbot LLM của VNPT sẽ trùng chức năng — chỉ nên tích hợp nếu BTC có yêu cầu rõ ràng phải dùng (vd: 1 phần điểm riêng cho "tích hợp API tài trợ"), không phải vì cần thêm tính năng.

---

### 3.3 Tính năng lâm sàng còn lại

#### 3.3.a Mở rộng an toàn thuốc (đã có nền, cần mở rộng)

`clinical_rules.py` hiện có `INTERACTION_RULES`, `RENAL_RULES`, `FAVORABLE_RULES` — đã đủ khung, chỉ cần mở rộng dữ liệu:
- Thêm cặp tương tác thuốc khác ngoài nhóm tim mạch/chống đông (vd: nhóm tiêu hóa, nội tiết) — cần Tấn/Ngân cung cấp danh sách.
- Thêm `RENAL_RULES` cho các thuốc thường gặp khác (hiện chỉ có metformin, dapagliflozin, levofloxacin).
- Thêm chỉnh liều theo **eGFR cụ thể theo mốc** (không chỉ ngưỡng cắt cứng) nếu Tấn/Ngân muốn chi tiết hơn.

#### 3.3.b Care-gap detector (mục 9, B3 — chưa làm)

```
Report đã phân tích (từ Bước 1 + Bước 2)
      │
      ▼
[1] Quét các trường: xet_nghiem_key, sieu_am_tim.lan_kham, ngay_ra_vien
      │
      ▼
[2] So với checklist tất định theo guideline (Tấn/Ngân soạn), ví dụ:
    - "Đã ra viện > 30 ngày nhưng chưa có NT-proBNP sau ra viện" → cảnh báo thiếu
    - "Van cơ học nhưng không có lần đo INR nào trong 14 ngày gần nhất" → cảnh báo
    - "Có Creatinin nhưng tuổi/giới thiếu" → "chưa tính được eGFR"
      │
      ▼
[3] Trả về danh sách "khoảng trống cần bổ sung" qua analysis.care_gaps
      │
      ▼
FE hiển thị Card riêng, dạng checklist, kèm "cần bác sĩ xác nhận"
```

**Lưu ý thiết kế:** giống cách đã làm CHA2DS2-VASc — tất định 100% trong Python, không qua LLM, vì đây là logic "thiếu/đủ dữ liệu" chứ không phải suy luận lâm sàng phức tạp.

#### 3.3.c TTR anticoagulation tracking (mục 9, B4 — chưa làm)

```
INR trend[] + trendDates[] (đã có trong schema xet_nghiem_key)
      │
      ▼
[1] Chọn phương pháp: % thời gian trong đích (đơn giản) HOẶC Rosendaal (nội suy tuyến tính)
    Khuyến nghị: làm % đơn giản trước (ít rủi ro tính sai), Rosendaal sau nếu có thời gian
      │
      ▼
[2] Với mỗi lần đo INR: kiểm tra có trong đích 2.0-3.0 không (với van cơ học)
      │
      ▼
[3] % TTR = (số lần trong đích / tổng số lần đo) × 100
    (hoặc nội suy Rosendaal: tính thời gian thực tế trong đích giữa 2 lần đo,
     giả định INR thay đổi tuyến tính giữa 2 mốc)
      │
      ▼
[4] Cảnh báo nếu TTR < 65% (ngưỡng kinh điển trong y văn, Tấn/Ngân xác nhận lại)
      │
      ▼
FE: vẽ vùng đích 2.0-3.0 trên biểu đồ INR đã có (MultiTrend/VisitCompare),
    đánh dấu riêng các điểm ngoài đích
```

---

### 3.4 Hạ tầng & vận hành

#### Kiến trúc 2 giai đoạn (nối tiếp thiết kế Supabase/RLS đã chốt — xem mục 2.3.b)

```
GIAI ĐOẠN 1 — Pilot/Demo (Vòng 2, Chung kết, vài bệnh viện đầu tiên)

  Bác sĩ ──► Frontend React (GitHub Pages)
                    │
                    ▼ JWT
            Supabase Auth (đăng nhập bác sĩ)
                    │
                    ▼
            Backend FastAPI (HF Spaces)
                    │
        ┌───────────┼───────────┐
        ▼                       ▼
  Anthropic API          Supabase Postgres + RLS
  (phân tích hồ sơ)      (LƯU DỮ LIỆU ẨN DANH:
                          mã bệnh án thay tên, mã hóa
                          định danh — KHÔNG lưu tên
                          thật/CCCD bệnh nhân)

  Đủ để demo: đăng nhập, lịch sử truy vấn (trang 11 proposal),
  audit log — mà KHÔNG vướng Luật 91/2025/QH15 vì dữ liệu đã ẩn danh.


GIAI ĐOẠN 2 — Thương mại hóa thật (GTM Giai đoạn 3, theo proposal trang 61-63)

  ┌─────────────────── Hạ tầng bệnh viện (on-premise) ───────────────────┐
  │                                                                       │
  │   Bác sĩ ──► Frontend (LAN nội bộ hoặc VPN viện)                     │
  │                    │                                                  │
  │                    ▼                                                  │
  │            Backend FastAPI (Docker, server viện)                     │
  │                    │                                                  │
  │            Postgres self-host (Docker, server viện)                  │
  │            ── Dữ liệu bệnh nhân THẬT không rời hệ thống ──           │
  │                                                                       │
  └─────────────────────────┬─────────────────────────────────────────────┘
                             │ Chỉ phần KHÔNG nhạy cảm gửi ra ngoài:
                             ▼
                    Anthropic API (phân tích hồ sơ)
                    [Cân nhắc thêm: thỏa thuận xử lý dữ liệu (DPA) với
                     Anthropic, hoặc lớp ẩn danh hóa trước khi gửi]
```

**Điểm mấu chốt cần nói rõ trong pitch:** ngay cả ở Giai đoạn 2 (on-premise), nội dung hồ sơ vẫn phải gửi ra Anthropic API để phân tích — đây là giới hạn thật của kiến trúc dùng LLM bên thứ ba, không thể né tránh hoàn toàn. Cách xử lý trung thực: nói rõ trong proposal là dữ liệu **lưu trữ** không rời viện (DB on-premise), còn dữ liệu **xử lý tức thời** (gọi API phân tích) có gửi ra ngoài trong thời gian xử lý — và nêu phương án giảm rủi ro (ẩn danh hóa trường định danh trước khi gửi, không lưu log phía Anthropic nếu dùng Zero Data Retention nếu Anthropic có hỗ trợ theo tier).

#### Docker 1-lệnh (chưa làm — vẫn treo từ đầu Vòng 2, là công cụ triển khai cho Giai đoạn 2 trên)

```
docker-compose.yml
      │
      ├─── service: backend
      │      - Dockerfile: python:3.11-slim
      │      - pip install -r requirements.txt (đã cập nhật: pypdf, opencv, scipy...)
      │      - uvicorn main:app --host 0.0.0.0 --port 8000
      │      - env: ANTHROPIC_API_KEY (từ .env, KHÔNG hardcode)
      │
      ├─── service: db (MỚI — chỉ cần khi triển khai Giai đoạn 2 on-premise,
      │      KHÔNG cần cho demo Vòng 2 vì demo dùng Supabase cloud)
      │      - postgres:16-alpine
      │      - volume bind mount để dữ liệu không mất khi container restart
      │
      └─── service: frontend
             - Build App.jsx bằng esbuild TRONG container (nhất quán với cách
               production build, KHÔNG dùng Vite — tránh 2 luồng build khác nhau)
             - Serve tĩnh bằng nginx hoặc `npx serve`, cổng 80
```

**Quyết định cần Đăng xác nhận trước khi viết:** build FE trong container hay copy bundle có sẵn vào image? (đã hỏi ở phiên trước, chưa chốt vì ưu tiên ECG/Prompt Caching trước). Cũng cần xác nhận: bản Docker cho **demo Vòng 2** có cần kèm service `db` không, hay chỉ cần backend+frontend là đủ (vì Supabase đã là dịch vụ ngoài, không cần tự host Postgres trong lúc demo)?

#### Script test (pytest — chưa làm)

```
test_health()        → GET /health → 200, đúng field "service"
test_analyze_text()  → POST /analyze_text với hồ sơ mock
                        → success=True, report có đủ field bắt buộc
                        → nếu có ≥2 lần đo, trend & trendDates cùng độ dài
test_risk_scores()   → kiểm tra risk_scores.cha2ds2_vasc/has_bled xuất hiện
                        đúng cấu trúc khi report có rung nhĩ + van cơ học
test_ecg_synthetic() → GET /ecg/synthetic → columns_with_signal > 90% width
test_idempotent()    → chạy /analyze_text 3 lần liên tiếp, không lỗi
```

Nên mock `call_claude()` trong test (như đã làm khi kiểm thử Prompt Caching/ECG phiên này) để không tốn token thật khi CI chạy.

---

## 4. THỨ TỰ THỰC THI ĐỀ XUẤT

```
Đã xong:  CHA2DS2-VASc/HAS-BLED → Prompt Caching → ECG Mức 1 (ảnh tổng hợp)
Tiếp theo (đề xuất, có thể đổi thứ tự theo ưu tiên của Đăng):

1. Khung gọi API VNPT (vnpt_client.py) — không cần key thật để viết khung
2. Docker 1-lệnh + pytest (chỉ backend+frontend, KHÔNG cần service db cho demo)
   — củng cố điểm "Hoàn thiện sản phẩm" (20đ, dễ mất nhất)
3. Care-gap detector — tất định, nhanh, tận dụng schema đã có
4. TTR tracking (% đơn giản trước) — tận dụng INR trend đã có sẵn
5. Mở rộng an toàn thuốc — cần Tấn/Ngân cung cấp thêm dữ liệu thuốc
6. ECG Mức 2 — khi có ảnh thật từ anh Tấn
7. Tích hợp SmartVoice/SmartReader thật — khi có key từ An
8. ECG Mức 3 — chỉ nếu dư thời gian, rủi ro uy tín cao nhất
9. Slide "kiến trúc 2 giai đoạn hạ tầng" cho pitch — không cần code thêm,
   chỉ cần trình bày lại đúng thiết kế Supabase/RLS/on-premise đã có (mục 3.4)
   thành 1 sơ đồ rõ ràng — làm SỚM vì là nội dung pitch, không phụ thuộc code
```

---

## 5. RỦI RO & ĐIỂM CẦN TẤN/NGÂN DUYỆT

| Việc | Cần duyệt gì |
|---|---|
| CHA2DS2-VASc bối cảnh van cơ học | Đã có nhãn cảnh báo trong code — cần Tấn/Ngân xác nhận câu chữ đúng chuẩn y khoa |
| Keyword dò bệnh kèm theo (THA, ĐTĐ...) | Bộ từ khóa hiện tại dựa trên 1 mẫu bệnh án — cần test thêm trên nhiều hồ sơ thật để bổ sung từ viết tắt còn thiếu |
| Ngưỡng TTR (65%) | Ngưỡng kinh điển trong y văn quốc tế — cần xác nhận áp dụng được cho bối cảnh Việt Nam |
| Ngưỡng CV cho "nhịp không đều" (ECG Mức 3) | Hoàn toàn chưa có — bắt buộc Tấn/Ngân chốt trước khi code, vì đây là phần rủi ro uy tín cao nhất |
| Care-gap checklist | Cần Tấn/Ngân soạn danh sách "khoảng trống" cụ thể theo guideline nào |
| Danh sách viết tắt khẩu ngữ bác sĩ (cho SmartVoice) | Cần Tấn/Ngân bổ sung thêm ví dụ ngoài 3 cái đã có trong file tóm tắt |

---

*File này được tạo theo yêu cầu của Đăng, dựa trên đối chiếu trực tiếp giữa bản proposal Vòng 1 (PDF 71 trang) và code thật (App.jsx, main.py, clinical_rules.py, ecg_engine.py) tại thời điểm 27/06/2026. Mọi số liệu/ngưỡng lâm sàng trong file này là ĐỀ XUẤT, cần Tấn/Ngân xác nhận trước khi đưa vào sản phẩm chính thức.*
