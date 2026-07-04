# Hướng dẫn cho Thành — Kích hoạt FAQ Bot (VNPT Smartbot)

Gửi Thành,

Phần code gọi FAQ Bot đã viết xong và **đã hoạt động chờ sẵn** (`vnpt_client.py` hàm
`ask_vnpt_faq_bot()`, endpoint `POST /faq-bot`, widget MedAmi trên frontend có sẵn
tab "Hỗ trợ hệ thống"). Đúng như Đăng nói, **1 biến môi trường duy nhất** cần điền
để bật tính năng này lên — không cần sửa code gì thêm.

---

## Bước 1 — Tạo bot trên console VNPT (nếu Thành chưa tạo)

1. Vào `console-smartbot.vnpt.vn`, đăng nhập bằng tài khoản đã cấp cho team.
2. Tạo dự án/bot mới — chọn đúng loại **"Tạo Bot dùng kịch bản, ý định, thực thể"**
   (không phải "Tạo Bot dùng GenAI/RAG" — loại đó dùng cho kho tri thức tĩnh,
   không hợp use case FAQ đơn giản này).
3. Xây vài "ý định" (intent) cơ bản cho các câu hỏi thường gặp về sản phẩm, ví dụ:
   - "MedParcours là gì?"
   - "Làm sao để đổi tên hồ sơ?"
   - "Làm sao để lưu hồ sơ?"
   - "Có thể tải lên định dạng file nào?"
4. Sau khi tạo xong, vào phần cấu hình bot → copy đúng **`bot_id`** (chuỗi định
   danh của bot, không phải tên bot).

## Bước 2 — Điền đúng 1 biến môi trường

Tên biến bắt buộc: **`VNPT_FAQ_BOT_ID`**

Điền giá trị `bot_id` vừa copy vào đây — đặt ở đúng nơi backend đang chạy thật
(nếu Thành deploy backend riêng, đặt vào `.env`/Secrets của bản deploy đó; nếu
dùng chung HF Space với Đăng thì nhờ Đăng điền vào HF Space → Settings →
Repository secrets, tên biến phải khớp chính xác `VNPT_FAQ_BOT_ID`).

Lưu ý: biến này **độc lập** với `VNPT_TOKEN_ID`/`VNPT_TOKEN_KEY`/`VNPT_ACCESS_TOKEN`
(3 biến đó Đăng đang tự điền cho phần SmartReader) — nhưng **endpoint FAQ Bot
vẫn dùng chung 3 token đó để xác thực** (đã xác nhận qua Postman collection
thật). Nghĩa là: nếu Đăng chưa điền `VNPT_TOKEN_ID/KEY/ACCESS_TOKEN`, dù Thành
điền đúng `VNPT_FAQ_BOT_ID` thì FAQ Bot vẫn chưa gọi được — cần **cả 4 biến**
cùng lúc đều có giá trị đúng.

## Bước 3 — Cách kiểm tra đã chạy đúng chưa

Cách nhanh nhất — gọi thẳng endpoint bằng `curl` hoặc Postman:

```bash
curl -X POST https://<địa-chỉ-backend>/faq-bot \
  -H "Content-Type: application/json" \
  -d '{"question": "MedParcours là gì?"}'
```

- Nếu cấu hình đúng → trả về `{"text": "..."}` với nội dung thật từ bot vừa tạo.
- Nếu thiếu/sai bất kỳ biến nào trong 4 biến → tự động trả về câu **"Trợ lý hệ
  thống đang bảo trì cục bộ..."** — **không báo lỗi, không crash**, đây là thiết
  kế cố ý (an toàn cho demo), không phải dấu hiệu code sai. Cần xem log console
  của backend để biết chính xác đang thiếu biến nào (in rõ dòng
  `[VNPT FAQ Bot lỗi/chưa sẵn sàng] ...`).

Trên giao diện: mở app → nút tròn "MedAmi" góc dưới phải → tab "Hỗ trợ hệ
thống" → gõ thử 1 câu hỏi.

---

Có vướng gì trong lúc set up thì nhắn lại nhóm, Đăng/mình hỗ trợ tiếp.
