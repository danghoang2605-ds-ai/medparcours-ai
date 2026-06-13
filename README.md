# MediFlow AI

Trợ lý lâm sàng: bác sĩ tải hồ sơ bệnh án PDF (xuất từ HIS) lên, hệ thống trích xuất,
phân tích theo 3 giai đoạn (Tiền phẫu / Hậu phẫu nội trú / Ngoại trú tái khám) và trả về
báo cáo có cấu trúc kèm chatbot hỏi đáp.

HackAIthon 2026 - Bảng B Challenger - Đề tài 5: Y tế.

---

## Cấu trúc thư mục đề xuất cho GitHub

```
mediflow-ai/
├─ README.md
├─ .gitignore
├─ backend/
│  ├─ main.py              # FastAPI: pipeline 3 bước (trích xuất → rule engine → diễn đạt)
│  ├─ clinical_rules.py    # Rule engine lâm sàng (tất định, do bác sĩ chốt)
│  ├─ requirements.txt     # Thư viện Python
│  └─ .env.example         # Mẫu khóa API (sao chép thành .env, KHÔNG commit .env)
└─ frontend/
   ├─ src/
   │  ├─ App.jsx           # Toàn bộ giao diện (1 file React)
   │  └─ main.jsx          # Điểm vào Vite (đã có sẵn trong dự án của bạn)
   ├─ public/
   │  └─ logos/            # Logo các đơn vị (đặt file ảnh vào đây)
   │     ├─ hackaithon.png
   │     ├─ hoi-sinh-vien.png
   │     ├─ vietcombank.png
   │     ├─ vnpt-ai.png
   │     └─ vsds.png
   ├─ index.html
   ├─ package.json         # Đã có sẵn trong dự án Vite của bạn
   └─ .env.example         # Mẫu VITE_API_URL khi deploy
```

Lưu ý: thư mục `frontend/` chính là dự án Vite bạn đang chạy. Chỉ cần đặt `App.jsx` vào
`frontend/src/App.jsx` và logo vào `frontend/public/logos/`.

---

## Chạy ở máy (local)

### Backend
```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    |    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # rồi mở .env điền ANTHROPIC_API_KEY thật
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev                   # mở http://localhost:5173
```

Bấm "Xem demo" để xem báo cáo mẫu (không cần backend). Tải PDF thật thì cần backend chạy.

---

## Bảo mật khóa API (quan trọng)

- Khóa `ANTHROPIC_API_KEY` chỉ nằm ở **backend**, trong file `.env` (đã được `.gitignore`
  loại trừ) hoặc trong biến môi trường của nơi host backend.
- **Không bao giờ** đặt khóa trong frontend hay commit lên GitHub. Frontend chỉ biết URL
  của backend, không biết khóa.
- Nếu lỡ commit khóa: vào bảng điều khiển Anthropic thu hồi (revoke) khóa đó và tạo khóa mới.

---

## Đẩy code lên GitHub (nhanh)

```bash
# tại thư mục gốc mediflow-ai/
git init
git add .
git commit -m "MediFlow AI: frontend + backend"
git branch -M main
git remote add origin https://github.com/<tai-khoan>/mediflow-ai.git
git push -u origin main
```

Trước khi push, chạy `git status` và chắc chắn **không** thấy file `.env` trong danh sách.

---

## Deploy (host thật)

GitHub Pages chỉ chạy được trang tĩnh, **không chạy được Python**. Vì vậy tách hai phần:

- **Frontend** (tĩnh) → GitHub Pages, Vercel, hoặc Netlify.
  Build: `cd frontend && npm run build` → thư mục `dist/`.
  Đặt biến `VITE_API_URL` = URL backend đã host.
- **Backend** (FastAPI cần máy chủ) → Render, Railway, hoặc Fly.io.
  Lệnh chạy: `uvicorn main:app --host 0.0.0.0 --port $PORT`
  Đặt biến môi trường `ANTHROPIC_API_KEY` trong dashboard của nơi host (không dùng file .env).

Sau khi backend có URL công khai, sửa `allow_origins` trong `main.py` từ `["*"]` thành đúng
tên miền frontend để an toàn hơn.

---

## Kiến trúc pipeline (backend)

1. **Trích xuất** (LLM): đọc PDF → JSON thuần (xét nghiệm, sinh hiệu, siêu âm, thuốc). Không đánh giá.
2. **Rule engine** (`clinical_rules.py`, thuần Python, không AI): tính eGFR, sàng lọc ưu tiên,
   an toàn thuốc, diễn giải theo giai đoạn. Mọi ngưỡng do bác sĩ chốt.
3. **Diễn đạt** (LLM): viết lại kết quả thành câu tóm tắt.

> Lưu ý lâm sàng: toàn bộ ngưỡng và diễn giải trong `clinical_rules.py` và prompt là bản nháp
> kỹ thuật, cần bác sĩ chuyên môn rà soát và phê duyệt trước khi dùng cho mục đích lâm sàng thật.
> Kết quả mang tính hỗ trợ, bác sĩ là người ra quyết định cuối cùng.
