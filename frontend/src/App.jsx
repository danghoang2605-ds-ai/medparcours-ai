import { useState, useRef, useEffect, useCallback, Component } from "react"

// API_URL: trỏ tới backend trên Hugging Face Spaces.
// SAU KHI tạo Space, thay URL bên dưới bằng URL thật, dạng:
//   https://<tên-tài-khoản-HF>-mediflow-ai.hf.space   (chữ thường, dùng dấu gạch ngang)
// Có thể ghi đè bằng window.MEDIFLOW_API_URL trong index.html mà không cần sửa file này.
const API_URL = (typeof window !== "undefined" && window.MEDIFLOW_API_URL) || "https://danghoang2605-mediflow-ai.hf.space"

// ─── Lớp gọi Backend (Hugging Face Spaces) ───────────────────────────────────
// analyzeText/analyze: phân tích hồ sơ. mdt/teaching: lấy biên bản hội chẩn và
// bài giảng từ medparcours_modes_backend.py. Mọi lỗi sẽ ném ra để nơi gọi fallback.
async function mpFetchJSON(path, body, ms=45000){
  const ctrl = new AbortController()
  const timer = setTimeout(()=>ctrl.abort(), ms)
  try {
    const res = await fetch(`${API_URL}${path}`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body), signal: ctrl.signal })
    if(!res.ok) throw new Error("API "+res.status)
    return await res.json()
  } finally { clearTimeout(timer) }
}
const mpApi = {
  analyzeText: (ho_so_text, pages=0) => mpFetchJSON("/analyze_text", { ho_so_text, pages }),
  analyzeFile: async (file) => {
    const fd = new FormData(); fd.append("file", file)
    const res = await fetch(`${API_URL}/analyze`, { method:"POST", body: fd })
    if(!res.ok) throw new Error("API "+res.status)
    return res.json()
  },
  mdt: (report) => mpFetchJSON("/mdt", { report }),
  teaching: (report) => mpFetchJSON("/teaching", { report }),
}

// ─── Bóc chữ PDF NGAY TRONG TRÌNH DUYỆT (pdf.js từ CDN) ───────────────────────
// File lớn (vd 100 trang, 14MB) chỉ chứa vài trăm KB chữ. Bóc chữ ở client rồi
// gửi mình phần chữ lên server, nên không bị nghẽn ở giới hạn dung lượng upload.
const PDFJS_VER = "3.11.174"
let _pdfjsPromise = null
function ensurePdfJs() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"))
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib)
  if (_pdfjsPromise) return _pdfjsPromise
  _pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script")
    s.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.min.js`
    s.onload = () => {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.worker.min.js`
        resolve(window.pdfjsLib)
      } catch (e) { reject(e) }
    }
    s.onerror = () => reject(new Error("Không tải được pdf.js"))
    document.head.appendChild(s)
  })
  return _pdfjsPromise
}

// Bóc toàn bộ text của 1 file PDF (đọc HẾT trang để không bỏ sót; có trần an toàn
// 1500 trang). Server sẽ lọc giữ phần lâm sàng. onProgress(done,total) để báo tiến độ.
//
// TỐI ƯU: đọc theo BATCH song song (PDF_BATCH_SIZE trang/lượt) thay vì tuần tự
// từng trang. pdf.js (>=2.x, bản đang dùng 3.11.174) cho phép gọi getPage() đồng
// thời an toàn — mỗi PDFPageProxy độc lập, không chia sẻ state. Rủi ro thực tế là
// RAM (giữ nhiều trang cùng lúc) và worker quá tải nếu batch quá lớn -> dùng
// batch nhỏ (8 trang) thay vì Promise.all toàn bộ, và gọi page.cleanup() ngay
// sau khi lấy text xong để giải phóng bộ nhớ trang đó trước khi qua batch sau.
// Thứ tự trang trong kết quả VẪN ĐÚNG 1..N dù xử lý song song, vì mỗi batch ghi
// kết quả vào đúng vị trí mảng theo số trang, không dựa vào thứ tự hoàn thành.
const PDF_BATCH_SIZE = 8

async function extractPdfText(file, onProgress) {
  const lib = await ensurePdfJs()
  const buf = await file.arrayBuffer()
  const pdf = await lib.getDocument({ data: buf }).promise
  const maxPages = Math.min(pdf.numPages, 1500)
  const parts = new Array(maxPages)
  let done = 0

  const readOnePage = async (pageNum) => {
    const page = await pdf.getPage(pageNum)
    try {
      const tc = await page.getTextContent()
      const txt = tc.items.map(it => it.str).join(" ").trim()
      parts[pageNum - 1] = `==== TRANG ${pageNum} ====\n${txt}`
    } finally {
      // Giải phóng tài nguyên trang ngay (canvas/text layer cache nội bộ của
      // pdf.js) - quan trọng khi đọc hàng trăm trang để RAM không tích dần.
      try { page.cleanup() } catch {}
    }
    done++
    if (onProgress) onProgress(done, maxPages)
  }

  for (let batchStart = 1; batchStart <= maxPages; batchStart += PDF_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + PDF_BATCH_SIZE - 1, maxPages)
    const batch = []
    for (let p = batchStart; p <= batchEnd; p++) batch.push(readOnePage(p))
    await Promise.all(batch)
  }

  return { text: parts.join("\n\n"), pages: pdf.numPages }
}

// ASSET_BASE: thư mục gốc trang web lúc chạy. Trên GitHub Pages là "/mediflow-ai/",
// chạy local là "/". Tự tính nên ảnh logo trỏ đúng dù deploy ở subpath nào.
// (Không dùng import.meta để tránh lỗi "import.meta outside a module" ở môi trường preview.)
const ASSET_BASE = (typeof window !== "undefined" && window.MEDIFLOW_BASE)
  || (typeof window !== "undefined" ? window.location.pathname.replace(/[^/]*$/, "") : "/")
const asset = (p) => ASSET_BASE + String(p).replace(/^\/+/, "")

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap');
  :root {
    --blue:#1B5FCB; --blue-dk:#13408C; --blue-lt:#EAF1FC;
    --cyan:#0E9488; --navy:#102942; --navy2:#1E3A5C; --navy3:#3C5878;
    --muted:#6E89A8; --muted2:#52708F;
    --border:#E3E9F1; --glass:#FFFFFF;
    --red:#DC2626; --amber:#D97706; --teal:#0E9488; --green:#16A34A;
    --page-bg:#F3F6FA;
    --shadow-sm:0 1px 2px rgba(16,41,66,0.04),0 2px 6px rgba(16,41,66,0.05);
    --shadow-md:0 1px 3px rgba(16,41,66,0.05),0 8px 22px rgba(16,41,66,0.07);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{font-family:'Be Vietnam Pro',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--page-bg);min-height:100vh;color:var(--navy);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}

  /* SHARED */
  .card{background:var(--glass);border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:var(--shadow-sm);transition:box-shadow .2s}
  .card.collapsed .card-body{display:none}
  .card-head{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid var(--border);background:#FAFBFD}
  .card.collapsed .card-head{border-bottom:none}
  .card-head-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--navy3)}
  .card-head-right{margin-left:auto;display:flex;align-items:center;gap:6px}
  .card-body{padding:20px}
  .collapse-btn{width:24px;height:24px;border-radius:7px;border:none;background:rgba(29,111,232,0.07);cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--muted);transition:all .15s;flex-shrink:0;font-size:11px}
  .collapse-btn:hover{background:rgba(29,111,232,0.14);color:var(--blue)}

  .badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:4px 10px;border-radius:8px;border:1px solid;white-space:nowrap}
  .badge-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
  .badge.cao{background:#FEF2F2;color:#B91C1C;border-color:#FECACA}
  .badge.medio{background:#FFFBEB;color:#92400E;border-color:#FDE68A}
  .badge.low{background:#F0F9FF;color:#075985;border-color:#BAE6FD}
  .badge.cao .badge-dot{background:#EF4444}
  .badge.medio .badge-dot{background:#F59E0B}
  .badge.low .badge-dot{background:#38BDF8}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}

  /* SOURCE CHIP */
  .src-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:500;color:var(--muted);background:rgba(200,220,255,0.15);border:1px solid rgba(200,220,255,0.4);padding:3px 9px;border-radius:999px;cursor:pointer;margin-top:6px;transition:all .15s}
  .src-chip:hover{background:rgba(29,111,232,0.1);border-color:rgba(29,111,232,0.25);color:var(--blue)}

  /* BULLET LIST */
  .bullet-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:5px;text-align:left}
  .alert-item,.risk-item,.prio-box,.ai-insight,.traj-card,.drug-alert,.prio-col{text-align:left}
  .bullet-list li{display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--navy2);line-height:1.5}
  .bullet-list li::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--blue);flex-shrink:0;margin-top:6px}

  /* UPLOAD */
  .upload-page{min-height:100vh;position:relative;overflow:hidden;background:var(--page-bg)}
  .upload-bg-circle1{position:absolute;top:-80px;right:-80px;width:400px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(29,111,232,0.07) 0%,transparent 70%);pointer-events:none}
  .upload-bg-circle2{position:absolute;bottom:0;left:-60px;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,rgba(6,182,212,0.06) 0%,transparent 70%);pointer-events:none}
  .top-nav{position:relative;z-index:10;padding:16px 40px;background:rgba(255,255,255,0.7);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid rgba(200,220,255,0.4);display:flex;align-items:center;justify-content:space-between}
  .logo{display:flex;align-items:center;gap:10px}
  .logo-icon{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--blue),var(--cyan));display:flex;align-items:center;justify-content:center}
  .logo-text{font-size:17px;font-weight:700;color:var(--navy);letter-spacing:-.02em}
  .logo-text em{color:var(--blue);font-style:normal}
  .logo-sub{font-size:13px;font-weight:300;color:var(--muted)}
  .status-pill{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:6px 14px;border-radius:999px;background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.2);color:#0E7490}
  .status-dot{width:7px;height:7px;border-radius:50%;background:#2DD4BF;animation:blink 2s infinite}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
  .hero-wrap{position:relative;z-index:10;max-width:1180px;margin:0 auto;padding:52px 44px 32px;display:grid;grid-template-columns:3fr 2fr;gap:72px;align-items:center}
  .hero-tag{display:inline-flex;align-items:center;gap:9px;background:rgba(29,111,232,0.08);border:1px solid rgba(29,111,232,0.18);color:var(--blue);padding:10px 16px;border-radius:14px;margin-bottom:18px}
  .hero-tag-lines{display:flex;flex-direction:column;gap:1px;line-height:1.34}
  .hero-tag-lines span{font-size:12px;font-weight:600}
  .hero-tag-lines span:first-child{font-size:13px;font-weight:800}
  .hero-h1{font-size:2.75rem;font-weight:700;line-height:1.14;letter-spacing:-.03em;color:var(--navy);margin-bottom:16px}
  .hero-h1 em{color:var(--blue);font-style:normal}
  .hero-desc{font-size:16.5px;color:var(--muted2);line-height:1.62;max-width:490px;margin-bottom:26px}
  .feat-list{display:flex;flex-direction:column;gap:11px;margin-bottom:30px}
  .feat-item{display:flex;align-items:center;gap:11px;font-size:14.5px;color:var(--navy3)}
  .feat-icon{width:27px;height:27px;border-radius:9px;background:rgba(29,111,232,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .stats-row{display:flex;gap:14px}
  .stat-block{flex:1;padding:16px 18px;background:rgba(255,255,255,0.72);border:1px solid var(--border);border-radius:18px;backdrop-filter:blur(8px)}
  .stat-n{font-size:27px;font-weight:700;color:var(--blue);letter-spacing:-.03em;margin:4px 0 2px}
  .stat-label{font-size:13.5px;font-weight:700;color:var(--navy2)}
  .stat-sub{font-size:11px;color:var(--muted);margin-top:2px;line-height:1.4}
  .upload-zone{border-radius:28px;padding:44px 36px;text-align:center;cursor:pointer;transition:all .2s;border:2px dashed rgba(29,111,232,0.3);background:rgba(255,255,255,0.82);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 8px 40px rgba(30,80,200,0.1)}
  .upload-zone:hover{border-color:var(--blue);background:rgba(235,244,255,0.6)}
  .upload-zone.drag{border-color:var(--blue);background:rgba(235,244,255,0.7);transform:scale(1.012);box-shadow:0 0 0 6px rgba(29,111,232,0.08),0 12px 40px rgba(29,111,232,0.12)}
  .upload-icon{width:70px;height:70px;margin:0 auto 18px;border-radius:20px;background:linear-gradient(135deg,rgba(29,111,232,0.1),rgba(6,182,212,0.1));display:flex;align-items:center;justify-content:center}
  .upload-title{font-size:17.5px;font-weight:600;color:var(--navy);margin-bottom:6px}
  .upload-sub{font-size:14px;color:var(--muted);margin-bottom:22px}
  .btn-primary{display:inline-flex;align-items:center;gap:8px;padding:10px 24px;border-radius:12px;background:linear-gradient(135deg,var(--blue),var(--cyan));color:#fff;font-size:13px;font-weight:600;border:none;cursor:pointer;box-shadow:0 4px 14px rgba(29,111,232,0.3);transition:all .15s;font-family:inherit}
  .btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(29,111,232,0.35)}
  .upload-privacy{font-size:11px;color:#BDD0EE;margin-top:12px}
  .upload-err{background:rgba(254,242,242,0.95);border:1px solid #FECACA;border-radius:14px;padding:12px 14px;margin-bottom:14px;backdrop-filter:blur(8px)}
  .upload-err-row{display:flex;align-items:center;gap:8px}
  .upload-err-title{font-size:13px;font-weight:700;color:#B91C1C;flex:1}
  .upload-err-x{width:22px;height:22px;border-radius:6px;border:none;background:rgba(254,202,202,0.5);cursor:pointer;display:flex;align-items:center;justify-content:center}
  .upload-err-msg{font-size:12px;color:#7F1D1D;line-height:1.5;margin-top:6px}
  .fmt-row{display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:16px}
  .fmt-lbl{font-size:11px;color:#94A3B8}
  .fmt-chips{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;max-width:320px}
  .fmt-chip{font-size:10px;font-weight:700;padding:3px 9px;border-radius:999px}
  .fmt-chip-soon{font-size:10px;font-weight:600;padding:3px 9px;border-radius:999px;color:#94A3B8;background:#F1F5F9;border:1px dashed #CBD5E1}
  .stage-wrap{border-radius:28px;padding:20px;background:rgba(255,255,255,0.9);backdrop-filter:blur(20px);box-shadow:0 8px 40px rgba(30,80,200,0.1);border:1px solid rgba(200,220,255,0.5)}
  .stage-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
  .stage-title{font-size:14px;font-weight:700;color:var(--navy)}
  .stage-clear{font-size:12px;color:#94A3B8;background:none;border:none;cursor:pointer;font-family:inherit}
  .stage-clear:hover{color:var(--red)}
  .stage-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:12px;margin-bottom:16px}
  .stage-card{position:relative;border:1px solid rgba(200,220,255,0.5);border-radius:14px;padding:10px;background:#fff;transition:box-shadow .15s}
  .stage-card:hover{box-shadow:0 6px 18px rgba(29,111,232,0.12)}
  .stage-x{position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:50%;border:none;background:rgba(241,245,249,0.9);cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2}
  .stage-x:hover{background:#FEE2E2}
  .stage-thumb{height:84px;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;position:relative;overflow:hidden}
  .stage-tag{font-size:18px;font-weight:800;letter-spacing:.03em}
  .stage-img{width:100%;height:100%;object-fit:cover;border-radius:9px}
  .stage-view{position:absolute;bottom:6px;right:6px;display:flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:#fff;background:rgba(15,30,60,0.72);padding:3px 8px;border-radius:999px}
  .fp-overlay{position:fixed;inset:0;background:rgba(8,20,45,0.72);backdrop-filter:blur(4px);z-index:1000;display:flex;align-items:center;justify-content:center;padding:28px}
  .fp-modal{background:#fff;border-radius:16px;width:min(920px,94vw);height:min(88vh,920px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,0.4)}
  .fp-head{display:flex;align-items:center;gap:12px;padding:13px 18px;border-bottom:1px solid #E2E8F0}
  .fp-name{font-size:14px;font-weight:700;color:#0A1628;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fp-meta{font-size:12px;color:#7A96C8;white-space:nowrap}
  .fp-close{margin-left:auto;background:#F1F5F9;border:none;border-radius:8px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;cursor:pointer}
  .fp-body{flex:1;background:#475569;display:flex;align-items:center;justify-content:center;overflow:auto}
  .fp-frame{width:100%;height:100%;border:none;background:#fff}
  .fp-img{max-width:100%;max-height:100%;object-fit:contain}
  .logo-bar{display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;gap:28px 52px;max-width:1180px;margin:10px auto 0;padding:22px 18px 16px;border-top:1px solid rgba(200,220,255,0.5)}
  .logo-bar.compact{margin-top:22px;padding-top:20px;gap:24px 40px}
  .logo-group{display:flex;flex-direction:column;align-items:center;gap:14px}
  .logo-group-lbl{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--navy2);white-space:nowrap}
  .logo-group-imgs{display:flex;align-items:center;gap:22px}
  .logo-slot{position:relative;height:80px;min-width:100px;display:flex;align-items:center;justify-content:center}
  .logo-bar.compact .logo-slot{height:64px;min-width:88px}
  .partner-logo{max-height:100%;max-width:180px;object-fit:contain;position:relative;z-index:1}
  .partner-logo.hide{display:none}
  .partner-logo.hide + .logo-ph{display:flex}
  .logo-ph{display:none;align-items:center;justify-content:center;text-align:center;font-size:11px;color:#94A3B8;border:1px dashed #CBD5E1;border-radius:10px;padding:6px 12px;height:100%;width:100%;line-height:1.3}
  .stage-name{font-size:11px;font-weight:600;color:var(--navy3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px}
  .stage-meta{font-size:10px;color:#94A3B8}
  .stage-add{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:120px;border:2px dashed rgba(29,111,232,0.3);border-radius:14px;background:rgba(235,244,255,0.4);cursor:pointer;font-size:12px;font-weight:600;color:var(--blue);font-family:inherit;transition:all .15s}
  .stage-add:hover,.stage-add.drag{background:rgba(235,244,255,0.8);border-color:var(--blue)}
  .stage-go{width:100%;justify-content:center}
  .stage-wrap .upload-privacy{color:#94A3B8;text-align:center}
  .demo-link{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:500;color:var(--blue);background:rgba(29,111,232,0.05);border:1px solid rgba(29,111,232,0.12);padding:6px 14px;border-radius:10px;cursor:pointer;margin-top:14px;transition:all .15s}
  .demo-link:hover{background:rgba(29,111,232,0.1)}
  .load-steps{display:flex;align-items:center;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:14px}
  .load-step{font-size:12px;font-weight:600;padding:5px 14px;border-radius:999px;background:rgba(29,111,232,0.1);color:var(--blue)}
  .load-arr{font-size:10px;color:#BDD0EE}
  .loading-spin{width:48px;height:48px;border-radius:50%;margin:0 auto 16px;border:3px solid rgba(29,111,232,0.15);border-top:3px solid var(--blue);animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}

  /* REPORT NAV */
  .report-nav{position:sticky;top:0;z-index:50;background:rgba(255,255,255,0.92);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-bottom:1px solid var(--border);box-shadow:0 1px 0 rgba(16,41,66,0.04),0 4px 16px rgba(16,41,66,0.04)}
  .report-nav-inner{max-width:1120px;margin:0 auto;padding:0 24px;height:52px;display:flex;align-items:center;justify-content:space-between}
  .nav-left{display:flex;align-items:center;gap:14px}
  .nav-sep{color:rgba(200,220,255,0.5);font-size:10px}
  .nav-patient{display:flex;align-items:center;gap:8px}
  .patient-avatar{width:28px;height:28px;flex:0 0 28px;flex-shrink:0;border-radius:50%;background:linear-gradient(135deg,#DBEAFE,#BFDBFE);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--blue)}
  .patient-name{font-size:13px;font-weight:600;color:var(--navy2)}
  .patient-meta{font-size:11px;background:rgba(29,111,232,0.08);color:var(--navy3);padding:3px 8px;border-radius:6px}
  .nav-right{display:flex;align-items:center;gap:8px}
  .tab-group{display:flex;background:rgba(235,244,255,0.8);border:1px solid var(--border);border-radius:12px;padding:3px;gap:2px}
  .tab-btn{display:flex;align-items:center;gap:6px;padding:5px 14px;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer;border:none;background:transparent;color:var(--muted);transition:all .15s;font-family:inherit}
  .tab-btn.active{background:white;color:var(--blue);box-shadow:0 1px 6px rgba(30,80,200,0.12);border:1px solid rgba(200,220,255,0.5)}
  .btn-action{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;border:none;transition:all .15s;font-family:inherit}
  .btn-print{background:rgba(29,111,232,0.08);color:var(--blue);border:1px solid rgba(29,111,232,0.15)}
  .btn-print:hover{background:rgba(29,111,232,0.14)}
  .btn-back{background:transparent;color:var(--muted);border:1px solid var(--border)}
  .btn-back:hover{background:rgba(235,244,255,0.8)}

  /* PATIENT CHIP BAR */
  .chip-bar{background:rgba(255,255,255,0.6);backdrop-filter:blur(8px);border-bottom:1px solid var(--border);padding:7px 24px}
  .chip-bar-inner{max-width:1120px;margin:0 auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .chip-tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;border:1px solid;white-space:nowrap}
  .chip-tag.warn{background:#FEF2F2;color:#B91C1C;border-color:#FECACA}
  .chip-tag.info{background:#F0F9FF;color:#075985;border-color:#BAE6FD}
  .chip-tag.med{background:#F0FDF4;color:#166534;border-color:#BBF7D0}
  .chip-lbl{font-size:10px;color:var(--muted);font-weight:500}

  /* REPORT LAYOUT */
  .report-outer{max-width:1120px;margin:0 auto;padding:24px 24px 60px;display:flex;gap:20px;align-items:flex-start}
  .report-main{flex:1;min-width:0}
  .report-stack>*+*{margin-top:14px}

  /* SIDEBAR */
  .sidebar{width:186px;flex-shrink:0;position:sticky;top:108px;align-self:flex-start;max-height:calc(100vh - 124px);overflow-y:auto}
  .sidebar-label{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--navy2);margin-bottom:8px;padding-left:10px}
  .sidebar-item{display:flex;align-items:center;gap:7px;padding:7px 10px;border-radius:10px;font-size:11.5px;font-weight:600;color:var(--navy3);cursor:pointer;transition:all .15s;border:1px solid transparent;margin-bottom:3px;background:none;width:100%;text-align:left;font-family:inherit;white-space:nowrap}
  .sidebar-item svg{flex-shrink:0}
  .sidebar-item:hover{background:rgba(255,255,255,0.7);color:var(--navy);border-color:var(--border)}
  .sidebar-item.active{background:rgba(255,255,255,0.9);color:var(--blue);border-color:rgba(29,111,232,0.2);font-weight:700}

  /* BANNER */
  .banner{border-radius:16px;overflow:hidden;box-shadow:var(--shadow-md);border:1px solid var(--border)}
  .banner-top{padding:22px 24px;background:linear-gradient(118deg,#13335E 0%,#1B56A8 100%)}
  .banner-row{display:flex;align-items:flex-start;justify-content:space-between}
  .banner-ba{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:rgba(200,220,255,0.65);margin-bottom:4px}
  .banner-name{font-size:22px;font-weight:700;color:#fff;letter-spacing:-.02em;margin-bottom:4px}
  .banner-info{font-size:13px;color:rgba(200,225,255,0.82)}
  .banner-dob{font-size:11px;color:rgba(180,210,255,0.6);margin-top:2px}
  .banner-dates{display:flex;flex-direction:column;gap:7px}
  .date-row{display:flex;align-items:center;justify-content:flex-end;gap:8px}
  .date-lbl{font-size:11px;color:rgba(180,210,255,0.7)}
  .date-val{font-size:12px;font-weight:600;color:#fff;background:rgba(255,255,255,0.15);padding:4px 10px;border-radius:8px}
  .banner-bot{padding:12px 24px;background:rgba(26,63,143,0.92)}
  .diag-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:rgba(180,210,255,0.6);margin-bottom:4px}
  .diag-val{font-size:13px;font-weight:500;color:#fff;line-height:1.5}

  /* RISK DONUT */
  .banner-donut{display:flex;align-items:center;gap:18px;padding:14px 24px;background:rgba(26,63,143,0.78);border-top:1px solid rgba(255,255,255,0.1)}
  .donut-legend{display:flex;flex-direction:column;gap:5px}
  .donut-item{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:rgba(238,246,255,0.95)}
  .donut-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}

  /* HERO STATUS (tong quan 15 giay) */
  .hero-status{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:22px;align-items:center;background:#fff;border:1px solid var(--border);border-left:4px solid var(--hero-accent,#1B5FCB);border-radius:14px;padding:15px 20px;box-shadow:var(--shadow-sm)}
  .hero-status-phase{display:flex;flex-direction:column;gap:4px}
  .hs-phase-tag{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:var(--navy);letter-spacing:-.01em}
  .hs-phase-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
  .hs-phase-sub{font-size:11.5px;color:var(--muted);font-weight:500;padding-left:18px}
  .hero-status-verdict{display:flex;align-items:center;gap:12px;padding-left:22px;border-left:1px solid var(--border);min-width:0}
  .hs-verdict-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .hs-verdict-lbl{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin-bottom:2px}
  .hs-verdict-txt{font-size:15px;font-weight:700;line-height:1.2;letter-spacing:-.01em;white-space:nowrap}
  .hs-verdict-lbl{white-space:nowrap}
  .hero-status-counts{display:flex;gap:8px}
  .hs-count{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:62px;padding:8px 6px;border-radius:11px;border:1px solid}
  .hs-count-n{font-size:21px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}
  .hs-count-lbl{font-size:10px;font-weight:700}
  @media(max-width:1040px){.hero-status{grid-template-columns:1fr;gap:13px}.hero-status-verdict{padding-left:0;border-left:none;border-top:1px solid var(--border);padding-top:12px}.hs-verdict-txt{white-space:nowrap}.hero-status-counts{justify-content:flex-start}}
  @media(max-width:430px){.hs-verdict-txt{white-space:normal}.hero-status-counts{justify-content:space-between}}

  /* PRIORITY ALERTS */
  .prio-wrap{border-radius:18px;overflow:hidden;border:1px solid rgba(200,220,255,0.5);box-shadow:0 4px 20px rgba(29,111,232,0.10)}
  .prio-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;padding:13px 18px;background:linear-gradient(120deg,#1A3F8F,var(--blue))}
  .prio-head-l{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#fff;letter-spacing:.01em}
  .prio-head-r{display:flex;align-items:center;gap:10px}
  .pt-timeline{background:var(--glass);backdrop-filter:blur(12px);border:1px solid var(--border);border-radius:18px;padding:16px 20px;box-shadow:0 2px 18px rgba(30,80,200,0.06)}
  .pt-status{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px}
  .pt-status-badge{font-size:12px;font-weight:700;padding:5px 13px;border-radius:999px}
  .pt-status-badge.out{background:#ECFDF5;color:#059669;border:1px solid #A7F3D0}
  .pt-status-badge.in{background:#FFF7ED;color:#C2410C;border:1px solid #FED7AA}
  .pt-status-rel{font-size:12px;color:var(--navy3);font-weight:500}
  .pt-track{display:flex;justify-content:space-between;gap:8px;position:relative}
  .pt-stop{flex:1;text-align:center;position:relative;padding-top:16px}
  .pt-stop::before{content:"";position:absolute;top:5px;left:50%;right:-50%;height:2px;background:rgba(200,220,255,0.6)}
  .pt-stop:last-child::before{display:none}
  .pt-dot{width:11px;height:11px;border-radius:50%;background:var(--blue);position:absolute;top:0;left:calc(50% - 5.5px);border:2px solid #fff;box-shadow:0 0 0 2px rgba(29,111,232,0.25);z-index:1}
  .pt-dot.now{background:#059669;box-shadow:0 0 0 2px rgba(5,150,105,0.3)}
  .pt-lbl{font-size:11px;font-weight:700;color:var(--navy2);margin-bottom:2px}
  .pt-date{font-size:11px;color:#5A7BB8}
  .pt-sub{font-size:10px;color:#059669;font-weight:600;margin-top:2px}
  .banner-collapse{width:28px;height:28px;border-radius:8px;border:none;background:rgba(255,255,255,0.18);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;flex-shrink:0}
  .banner-collapse:hover{background:rgba(255,255,255,0.32)}
  .banner-collapse.dark{background:rgba(0,0,0,0.05)}
  .banner-collapse.dark:hover{background:rgba(0,0,0,0.1)}
  .prio-counts{display:flex;gap:12px;background:rgba(255,255,255,0.95);padding:5px 12px;border-radius:999px}
  .prio-count{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700}
  .prio-count i{width:8px;height:8px;border-radius:50%}
  .prio-board{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(200,220,255,0.4);padding:1px}
  .prio-col{background:#fff;display:flex;flex-direction:column}
  .prio-col-head{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:8px 12px}
  .prio-col-dot{font-size:9px}
  .prio-col-n{margin-left:auto;font-size:11px;background:rgba(255,255,255,0.7);border-radius:999px;padding:0 8px;min-width:20px;text-align:center}
  .prio-col-body{padding:10px;display:flex;flex-direction:column;gap:8px;background:rgba(248,251,255,0.6);flex:1;min-height:96px}
  .prio-col-empty{font-size:11px;color:#94A3B8;text-align:center;padding:10px 0}
  .prio-box{background:#fff;border:1px solid rgba(200,220,255,0.5);border-radius:10px;padding:9px 11px}
  .prio-box-name{font-size:13px;font-weight:700;color:var(--navy);margin-bottom:3px}
  .prio-box-reason{font-size:11.5px;color:var(--navy3);line-height:1.45;margin-bottom:6px}
  .prio-box-lbl{font-weight:700;color:var(--muted2)}
  @media(max-width:720px){.prio-board{grid-template-columns:1fr}}
  .prio-src{font-size:10px;font-weight:600;color:var(--blue);background:rgba(235,244,255,0.9);border:1px solid rgba(191,219,254,0.7);border-radius:999px;padding:2px 9px;cursor:pointer;font-family:inherit}
  .prio-src:hover{background:var(--blue);color:#fff}
  /* DRUG SAFETY */
  .drug-egfr{margin-bottom:14px}
  .drug-egfr-box{background:rgba(235,244,255,0.6);border:1px solid rgba(200,220,255,0.4);border-radius:12px;padding:12px 14px}
  .drug-egfr-lbl{font-size:11px;color:var(--muted2);margin-bottom:5px}
  .drug-egfr-val{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
  .drug-egfr-num{font-size:26px;font-weight:700;color:var(--navy);line-height:1}
  .drug-egfr-unit{font-size:11px;color:#7A96C8}
  .drug-egfr-tag{font-size:10px;font-weight:700;padding:2px 9px;border-radius:999px;margin-left:4px}
  .drug-egfr-tag.ok{background:#F0FDF4;color:#059669}
  .drug-egfr-tag.warn{background:#FFFBEB;color:#D97706}
  .drug-egfr-tag.crit{background:#FEF2F2;color:#DC2626}
  .drug-egfr-note{font-size:10px;color:#94A3B8;margin-top:5px}
  .egfr-detail{margin-top:8px;padding-top:8px;border-top:1px dashed rgba(200,220,255,0.5)}
  .mf{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:15px;color:var(--navy);background:rgba(255,255,255,0.65);padding:12px 14px;border-radius:10px;margin-bottom:8px;font-family:'Cambria Math','Times New Roman',Georgia,serif;overflow-x:auto}
  .mf i{font-style:italic;font-family:inherit}
  .mf-op{color:#7A96C8;margin:0 1px}
  .mf-var{font-weight:600}
  .mf-frac{display:inline-flex;flex-direction:column;text-align:center;vertical-align:middle;margin:0 2px;font-size:12px;line-height:1.05}
  .mf-num{padding:0 4px}
  .mf-den{padding:1px 4px 0;border-top:1.3px solid currentColor}
  .mf-sup{font-size:0.66em;vertical-align:super;line-height:0}
  .egfr-inputs{display:flex;flex-wrap:wrap;gap:5px 14px;font-size:11px;color:#5A7BB8}
  .egfr-inputs b{color:var(--navy2);font-weight:600}
  .drug-empty{font-size:13px;color:#059669;font-weight:600;padding:8px 0}
  .drug-section{margin-bottom:12px}
  .drug-section-hd{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--navy3);margin-bottom:8px}
  .drug-alert{border:1px solid;border-radius:12px;padding:11px 13px;margin-bottom:8px}
  .drug-alert:last-child{margin-bottom:0}
  .drug-alert-top{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px}
  .drug-pair{font-size:13px;font-weight:700;color:var(--navy)}
  .drug-x{color:var(--muted2);font-weight:400;margin:0 2px}
  .drug-level{font-size:10px;font-weight:700;white-space:nowrap}
  .drug-conseq{font-size:12px;color:var(--navy3);line-height:1.5;margin-bottom:4px}
  .drug-caution{font-size:12px;color:#92400E;background:rgba(254,243,199,0.6);border:1px solid rgba(253,230,138,0.7);border-radius:8px;padding:7px 10px;margin-top:6px;line-height:1.5}
  .drug-caution b{color:#B45309}
  .drug-suggest{font-size:12px;color:var(--navy3);line-height:1.5;margin-bottom:6px}
  .drug-suggest strong{color:var(--navy)}
  .drug-disclaimer{font-size:10px;color:#94A3B8;font-style:italic;margin-top:10px;padding-top:10px;border-top:1px solid rgba(200,220,255,0.3)}

  /* ALERTS */
  .alerts-hi{background:rgba(254,242,242,0.88);border:1px solid rgba(252,165,165,0.5);border-radius:18px;padding:16px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
  .alerts-hi-hd{display:flex;align-items:center;gap:8px;margin-bottom:12px}
  .alerts-hi-hd span{font-size:12px;font-weight:700;text-transform:uppercase;color:#991B1B;letter-spacing:.06em}
  .alert-item{background:rgba(255,255,255,0.72);border:1px solid rgba(252,165,165,0.4);border-radius:12px;padding:12px 14px}
  .alert-item+.alert-item{margin-top:8px}
  .alert-item-title{font-size:13px;font-weight:600;color:#7F1D1D;line-height:1.5;margin-bottom:2px}

  /* SURGERY */
  .surg-row{display:flex;justify-content:space-between;align-items:center;font-size:13px;margin-bottom:10px}
  .surg-lbl{color:var(--muted)}
  .surg-val{font-weight:600;color:var(--navy)}
  .surg-method{background:rgba(235,244,255,0.6);border:1px solid rgba(200,220,255,0.4);border-radius:12px;padding:10px 12px;font-size:12px;color:var(--navy3);line-height:1.6;margin-bottom:10px}
  .surg-ok{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--teal)}
  .surg-ok-dot{width:8px;height:8px;border-radius:50%;background:#2DD4BF;flex-shrink:0}
  .surg-doc{padding-top:10px;border-top:1px solid rgba(200,220,255,0.3);margin-top:6px}
  .surg-grid{display:grid;grid-template-columns:1.6fr 1fr;gap:20px;align-items:start}
  .surg-grid .surg-doc{border-top:none;padding-top:0;margin-top:0;border-left:1px solid rgba(200,220,255,0.3);padding-left:20px;height:100%}
  @media(max-width:720px){.surg-grid{grid-template-columns:1fr}.surg-grid .surg-doc{border-left:none;border-top:1px solid rgba(200,220,255,0.3);padding-left:0;padding-top:10px}}

  /* LABS */
  .lab-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
  .lab-cell{border-radius:12px;padding:11px 12px;background:rgba(235,244,255,0.6);border:1px solid rgba(200,220,255,0.4);display:flex;flex-direction:column}
  .lab-top{display:flex;justify-content:space-between;align-items:center;gap:6px}
  .lab-key{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--navy3)}
  .lab-val-row{display:flex;align-items:baseline;gap:5px;margin:5px 0 2px}
  .lab-val{font-size:19px;font-weight:700;color:var(--navy);line-height:1}
  .lab-arrow{font-size:13px;font-weight:700}
  .lab-arrow.up{color:var(--red)}
  .lab-arrow.down{color:var(--green)}
  .lab-arrow.ok{color:var(--muted)}
  .lab-unit{font-size:10px;color:#7A96C8;margin-left:auto}
  .lab-status{font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px;flex-shrink:0;white-space:nowrap}
  .lab-status.high{background:#FEF2F2;color:var(--red)}
  .lab-status.normal{background:#F0FDF4;color:var(--green)}
  .lab-status.low{background:#FFF7ED;color:#EA580C}
  .lab-spark{margin:5px 0 7px;width:100%}
  .lab-foot{display:flex;justify-content:space-between;align-items:flex-end;gap:8px;margin-top:auto}
  .lab-desc{font-size:10px;color:var(--muted);line-height:1.3}
  .lab-normal{font-size:9px;color:#94A3B8;white-space:nowrap;flex-shrink:0}
  .lab-verdict{font-size:10px;font-weight:600;margin:1px 0 6px;display:flex;align-items:center;gap:4px}
  .lab-verdict.good{color:#059669}
  .lab-verdict.bad{color:#DC2626}
  .lab-verdict.neutral{color:#64748B}
  .lab-spark-dates{position:relative;height:11px;margin:3px 0 1px}
  .lab-spark-date{position:absolute;top:0;font-size:8px;color:#94A3B8;white-space:nowrap;line-height:1}
  .lab-verdict::before{content:"";width:4px;height:4px;border-radius:50%;background:currentColor;flex-shrink:0}
  .lab-filter{margin-bottom:12px}
  .lab-legend{display:flex;flex-wrap:wrap;gap:16px;font-size:11px;color:#7A96C8;margin-bottom:14px;padding:8px 12px;background:rgba(235,244,255,0.4);border-radius:10px}
  .lab-legend b{color:var(--navy2)}
  .lab-seg button{padding:4px 9px;font-size:11px}
  #sec-labs .card-head{flex-wrap:wrap;gap:8px}
  #sec-labs .card-head-right{flex-wrap:wrap}
  .lab-filter-n{font-size:9px;opacity:0.65;font-weight:700}
  .lab-empty{grid-column:1/-1;text-align:center;font-size:12px;color:#94A3B8;padding:14px}
  /* TRAJECTORY */
  .traj-card{border:1px solid;border-radius:16px;padding:15px 18px}
  .traj-head{display:flex;align-items:center;gap:12px;margin-bottom:11px}
  .traj-badge{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .traj-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted2)}
  .traj-verdict{font-size:17px;font-weight:700;letter-spacing:-.01em;margin-top:2px}
  .traj-list{list-style:none;display:flex;flex-direction:column;gap:6px}
  .traj-list li{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;color:var(--navy3);line-height:1.5}
  .traj-mark{font-size:9px;line-height:1.5;flex-shrink:0;margin-top:1px}

  /* VITAL SIGNS CHART: dùng chung style .echo-tl-wrap */

  /* TIMELINE */
  .tl-filters{display:flex;gap:6px;flex-wrap:wrap}
  .tl-filter-btn{font-size:11px;font-weight:600;padding:4px 12px;border-radius:999px;border:1px solid var(--border);background:rgba(255,255,255,0.6);color:var(--muted2);cursor:pointer;transition:all .15s;font-family:inherit}
  .tl-filter-btn.active{background:var(--blue);color:#fff;border-color:var(--blue)}
  .tl-wrap{position:relative;padding-left:22px}
  .tl-line{position:absolute;left:4px;top:6px;bottom:6px;width:1px;background:linear-gradient(to bottom,#BFDBFE,transparent)}
  .tl-item{position:relative;margin-bottom:8px}
  .tl-item:last-child{margin-bottom:0}
  .tl-dot{position:absolute;left:-22px;top:14px;width:12px;height:12px;border-radius:50%}
  .tl-dot.binh_thuong{background:#2DD4BF;box-shadow:0 0 0 3px rgba(45,212,191,0.15)}
  .tl-dot.bat_thuong{background:#F59E0B;box-shadow:0 0 0 3px rgba(245,158,11,0.15)}
  .tl-dot.canh_bao{background:#EF4444;box-shadow:0 0 0 3px rgba(239,68,68,0.15)}
  .tl-card{border-radius:12px;padding:10px 14px;border:1px solid}
  .tl-card.binh_thuong{background:rgba(255,255,255,0.62);border-color:var(--border)}
  .tl-card.bat_thuong{background:rgba(255,251,235,0.72);border-color:rgba(253,230,138,0.5)}
  .tl-card.canh_bao{background:rgba(254,242,242,0.72);border-color:rgba(252,165,165,0.4)}
  .tl-meta{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
  .tl-date{font-size:11px;font-weight:600;color:var(--muted)}
  .tl-tag{font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px}
  .tl-tag.canh_bao{background:rgba(239,68,68,0.1);color:#DC2626}
  .tl-tag.bat_thuong{background:rgba(245,158,11,0.1);color:#B45309}

  /* ECHO */
  .echo-card{border-radius:14px;padding:14px;border:1px solid}
  .echo-card.pre{background:rgba(255,251,235,0.8);border-color:rgba(253,230,138,0.5)}
  .echo-card.post{background:rgba(240,253,250,0.8);border-color:rgba(153,246,228,0.4)}
  .echo-card.post2{background:rgba(235,244,255,0.8);border-color:rgba(191,219,254,0.4)}
  .echo-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--navy3);margin-bottom:4px}
  .echo-date{font-size:11px;color:var(--muted);margin-bottom:8px}

  /* ECHO BAR CHART */
  .echo-bar-wrap{background:rgba(235,244,255,0.5);border:1px solid rgba(200,220,255,0.4);border-radius:14px;padding:16px;margin-top:14px}
  .echo-bar-title{font-size:11px;font-weight:700;color:var(--navy3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px}
  .echo-bar-row{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .echo-bar-row:last-child{margin-bottom:0}
  .echo-bar-label{font-size:11px;color:var(--muted2);width:80px;flex-shrink:0}
  .echo-bar-track{flex:1;height:20px;background:rgba(200,220,255,0.2);border-radius:6px;overflow:hidden;position:relative}
  .echo-bar-fill{height:100%;border-radius:6px;transition:width .6s cubic-bezier(.4,0,.2,1);display:flex;align-items:center;padding-left:8px}
  .echo-bar-val{font-size:11px;font-weight:700;color:#fff;white-space:nowrap}
  /* ECHO TIMELINE */
  .echo-tl-wrap{background:rgba(235,244,255,0.5);border:1px solid rgba(200,220,255,0.4);border-radius:14px;padding:16px}
  .echo-tl-head{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:6px}
  .echo-tl-legend{display:flex;flex-wrap:wrap;gap:12px}
  .echo-tl-modes{display:inline-flex;background:rgba(235,244,255,0.7);border:1px solid rgba(200,220,255,0.5);border-radius:9px;padding:2px;gap:2px}
  .echo-tl-modes button{border:none;background:transparent;font-family:inherit;font-size:11px;font-weight:600;color:var(--muted2);padding:4px 11px;border-radius:7px;cursor:pointer;transition:all .15s;white-space:nowrap}
  .echo-tl-modes button:hover{color:var(--blue)}
  .echo-tl-modes button.on{background:#fff;color:var(--blue);box-shadow:0 1px 4px rgba(29,111,232,0.15)}
  .echo-tl-legend span{display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--muted2)}
  .echo-tl-legend i{width:11px;height:11px;border-radius:3px;display:inline-block}
  .echo-tl-insight{display:flex;gap:8px;align-items:flex-start;margin-top:12px;padding:10px 12px;background:rgba(255,255,255,0.7);border:1px solid rgba(191,219,254,0.5);border-radius:10px;font-size:12px;line-height:1.55;color:var(--navy3)}
  .echo-tl-insight strong{color:var(--blue);font-weight:700}
  .echo-tl-insight svg{flex-shrink:0;margin-top:2px}
  .ai-insight{margin-top:12px;padding:11px 13px;background:linear-gradient(120deg,rgba(235,244,255,0.85),rgba(240,249,255,0.85));border:1px solid rgba(191,219,254,0.7);border-radius:12px}
  .ai-insight-tag{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--blue);margin-bottom:5px}
  .ai-insight-text{font-size:12.5px;line-height:1.55;color:var(--navy3)}
  .ai-insight-text strong{color:var(--blue);font-weight:700}
  /* ECHO TABLE */
  .echo-tbl-wrap{margin-top:14px}
  .echo-tbl-bar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px}
  .echo-tbl-controls{display:flex;gap:8px;flex-wrap:wrap}
  .echo-seg{display:inline-flex;background:rgba(235,244,255,0.7);border:1px solid rgba(200,220,255,0.5);border-radius:9px;padding:2px;gap:2px}
  .echo-seg button{border:none;background:transparent;font-family:inherit;font-size:11px;font-weight:600;color:var(--muted2);padding:4px 11px;border-radius:7px;cursor:pointer;transition:all .15s;white-space:nowrap}
  .echo-seg button:hover{color:var(--blue)}
  .echo-seg button.on{background:#fff;color:var(--blue);box-shadow:0 1px 4px rgba(29,111,232,0.15)}
  .echo-tbl-scroll{overflow-x:auto;border:1px solid rgba(200,220,255,0.4);border-radius:12px}
  .echo-tbl{width:100%;border-collapse:collapse;font-size:12px;min-width:780px}
  .echo-tbl th{text-align:left;padding:9px 12px;background:rgba(235,244,255,0.7);color:var(--navy3);font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid rgba(200,220,255,0.5);white-space:nowrap}
  .echo-tbl td{padding:9px 12px;border-bottom:1px solid rgba(200,220,255,0.25);color:var(--navy3);vertical-align:top}
  .echo-tbl tr:last-child td{border-bottom:none}
  .echo-tbl tr.warn{background:rgba(254,242,242,0.7)}
  .echo-tbl tr.latest{background:rgba(235,244,255,0.7)}
  .echo-tbl-badge{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;background:var(--blue);color:#fff;font-size:9px;font-weight:700;vertical-align:middle}
  .echo-phase-pill{display:inline-block;padding:2px 9px;border-radius:999px;border:1px solid;font-size:10px;font-weight:600;white-space:nowrap}


  /* MEDS */
  .med-item{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;background:rgba(235,244,255,0.5);border:1px solid rgba(200,220,255,0.35);border-radius:14px}
  .med-icon{width:32px;height:32px;border-radius:10px;background:rgba(29,111,232,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .med-name{font-size:13px;font-weight:600;color:var(--navy);line-height:1.3}
  .med-nhom{font-size:11px;font-weight:600;color:var(--blue);margin-top:2px}
  .med-dose{font-size:11px;color:var(--muted2);margin-top:2px}

  /* MED GANTT */
  .gantt-wrap{background:rgba(235,244,255,0.5);border:1px solid rgba(200,220,255,0.4);border-radius:14px;padding:16px;margin-top:14px}
  .gantt-title{font-size:11px;font-weight:700;color:var(--navy3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:14px}
  .gantt-row{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .gantt-row:last-child{margin-bottom:0}
  .gantt-label{width:150px;flex-shrink:0;line-height:1.35}
  .gantt-label-name{font-size:12px;font-weight:600;color:var(--navy3)}
  .gantt-label-date{font-size:10px;color:var(--muted2);font-variant-numeric:tabular-nums}
  .gantt-track{flex:1;height:22px;background:rgba(200,220,255,0.15);border-radius:6px;position:relative;overflow:hidden}
  .gantt-grid-line{position:absolute;top:0;bottom:0;width:1px;background:rgba(200,220,255,0.4)}
  .gantt-bar{height:100%;border-radius:6px;position:absolute;display:flex;align-items:center;justify-content:flex-end;padding-right:7px;min-width:2px}
  .gantt-bar-end{font-size:9px;font-weight:600;color:#fff;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,0.15)}
  .gantt-bar{cursor:pointer}
  .gantt-empty{font-size:12.5px;color:#7A96C8;line-height:1.6;padding:14px;background:rgba(235,244,255,0.4);border:1px dashed rgba(200,220,255,0.6);border-radius:12px}
  .gantt-tip{position:absolute;bottom:calc(100% + 8px);z-index:30;width:210px;background:#0F2A5E;color:#fff;border-radius:10px;padding:9px 11px;box-shadow:0 8px 24px rgba(15,42,94,0.35);pointer-events:none}
  .gantt-tip::after{content:"";position:absolute;top:100%;left:18px;border:5px solid transparent;border-top-color:#0F2A5E}
  .gantt-tip-name{font-size:12px;font-weight:700;margin-bottom:4px;line-height:1.3}
  .gantt-tip-row{display:flex;align-items:center;gap:5px;font-size:10.5px;color:rgba(200,225,255,0.9);margin-bottom:3px}
  .gantt-tip-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .gantt-tip-use{font-size:10.5px;color:rgba(200,225,255,0.75);line-height:1.4;margin-bottom:3px}
  .gantt-tip-date{font-size:10px;color:rgba(160,195,255,0.7);font-variant-numeric:tabular-nums}
  .gantt-axis{display:flex;gap:12px;padding-top:6px}
  .gantt-axis-spacer{width:150px;flex-shrink:0}
  .gantt-axis-track{flex:1;position:relative;height:14px}
  .gantt-axis-track span{position:absolute;transform:translateX(-50%);font-size:9px;color:#94A3B8;font-variant-numeric:tabular-nums}
  .gantt-axis-track span:first-child{transform:translateX(0)}
  .gantt-axis-track span:last-child{transform:translateX(-100%)}

  /* RISKS */
  .risks-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .risk-item{padding:14px;border-radius:14px;display:flex;flex-direction:column;gap:8px;border:1px solid}
  .risk-item.cao{background:rgba(254,242,242,0.72);border-color:rgba(252,165,165,0.5)}
  .risk-item.trung_binh{background:rgba(255,251,235,0.72);border-color:rgba(253,230,138,0.5)}
  .risk-item.thap{background:rgba(240,249,255,0.72);border-color:rgba(186,230,253,0.5)}

  /* SUMMARY */
  .summary-card{background:var(--glass);backdrop-filter:blur(12px);border:1px solid var(--border);border-radius:18px;padding:20px;box-shadow:0 2px 16px rgba(30,80,200,0.06)}
  .summary-hd{display:flex;align-items:center;gap:8px;margin-bottom:12px}
  .summary-hd-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--navy3)}
  .summary-phases{display:flex;flex-direction:column;gap:10px}
  .summary-phase{border:1px solid;border-radius:13px;padding:12px 15px}
  .summary-phase-hd{display:flex;align-items:center;gap:8px;margin-bottom:7px}
  .summary-phase-num{width:20px;height:20px;border-radius:50%;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .summary-phase-title{font-size:13px;font-weight:700;letter-spacing:.2px;line-height:1.4}
  .reason-list{display:flex;flex-direction:column;gap:10px}
  .reason-filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
  .reason-bullets{margin:9px 0 0;padding:9px 0 0 4px;border-top:1px dashed rgba(200,220,255,0.5);display:flex;flex-direction:column;gap:5px}
  .reason-bullets li{position:relative;padding-left:16px;font-size:12.5px;color:var(--navy2);line-height:1.55}
  .reason-bullets li::before{content:"";position:absolute;left:2px;top:7px;width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.55}
  .echo-note-bullets{margin:0;padding-left:15px;display:flex;flex-direction:column;gap:2px;text-align:left}
  .echo-note-bullets li{line-height:1.45}
  .reason-item{border:1px solid;border-radius:13px;padding:12px 15px}
  .reason-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer}
  .reason-sev,.reason-phase{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;background:#fff;border:1px solid;white-space:nowrap}
  .reason-sev i,.reason-phase i{width:7px;height:7px;border-radius:50%}
  .reason-title{font-size:13.5px;font-weight:700;color:var(--navy);flex:1;min-width:160px}
  .reason-chev{margin-left:auto;display:flex}
  .reason-body{font-size:12.5px;color:var(--navy2);line-height:1.65;margin-top:9px;padding-top:9px;border-top:1px dashed rgba(200,220,255,0.5)}
  .status-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
  .takeaway-card{background:#F1F7F6;border:1px solid #CFE6E2;border-left:4px solid var(--teal);border-radius:14px;padding:16px 18px}
  .sidebar-group{margin-bottom:6px}
  .sidebar-group + .sidebar-group{margin-top:10px}
  .takeaway-hd{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--navy3);margin-bottom:10px}
  .takeaway-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:7px}
  .takeaway-list li{display:flex;gap:9px;font-size:13px;color:var(--navy2);line-height:1.55;align-items:flex-start}
  .takeaway-mark{font-weight:800;flex-shrink:0;width:16px;text-align:center}
  .next-actions{background:#FCF6EE;border:1px solid #F0DEC2;border-left:4px solid var(--amber);border-radius:14px;padding:16px 18px}
  .ov-card{background:var(--glass);backdrop-filter:blur(10px);border:1px solid rgba(200,220,255,0.55);border-radius:16px;padding:15px 18px}
  .ov-head{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--navy);margin-bottom:13px}
  .prob-wrap{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  @media(max-width:760px){.prob-wrap{grid-template-columns:1fr}}
  .prob-col-hd{font-size:14px;font-weight:800;color:var(--navy);letter-spacing:-0.01em;margin-bottom:13px;padding-bottom:9px;border-bottom:1px solid var(--border)}
  .prob-col-dot{width:9px;height:9px;border-radius:50%}
  .prob-list{display:flex;flex-direction:column;gap:10px}
  .prob-item{display:flex;gap:10px;align-items:flex-start}
  .prob-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;margin-top:5px}
  .prob-body{flex:1;min-width:0}
  .prob-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .prob-name{font-size:13px;font-weight:600;color:var(--navy)}
  .prob-tag{font-size:10px;font-weight:700;padding:1px 8px;border-radius:999px;background:#fff;border:1px solid}
  .prob-tag.resolved{color:#059669;border-color:#A7F3D0;background:#ECFDF5}
  .prob-desc{font-size:11.5px;color:var(--navy2);line-height:1.5;margin-top:2px}
  .next-hd{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#B45309;margin-bottom:12px}
  .next-list{display:flex;flex-direction:column;gap:9px}
  .next-item{display:flex;gap:11px;align-items:flex-start}
  .next-num{flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#1D6FE8;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}
  .next-viec{font-size:13.5px;font-weight:600;color:var(--navy);line-height:1.4}
  .next-lydo{font-size:12px;color:var(--navy2);line-height:1.5;margin-top:2px}
  .lab-clarify{font-size:12px;color:#92400E;background:rgba(255,251,235,0.7);border:1px solid #FDE68A;border-radius:9px;padding:8px 11px;margin-bottom:11px;line-height:1.5}
  .med-status-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:6px}
  .med-status{font-size:11px;font-weight:700;padding:2px 10px;border-radius:999px}
  .med-status.active{background:#ECFDF5;color:#059669}
  .med-status.done{background:#F1F5F9;color:#64748B}
  .med-status.unknown{background:#FEF3C7;color:#B45309}
  .med-period{font-size:11px;color:#94A3B8}
  .status-card{background:var(--glass);backdrop-filter:blur(12px);border:1px solid;border-radius:16px;padding:14px 16px;box-shadow:0 2px 14px rgba(30,80,200,0.05)}
  .status-card-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
  .status-card-big{color:var(--navy);line-height:1.15;letter-spacing:-0.01em}
  .status-card-big.num{font-size:28px;font-weight:700}
  .status-card-big.text{font-size:19px;font-weight:700;margin-top:2px}
  .status-card-unit{font-size:13px;font-weight:600;color:#7A96C8}
  .status-card-sub{font-size:12px;color:var(--navy2);font-weight:600;margin-top:5px}
  .status-card-foot{font-size:11px;color:#94A3B8;margin-top:4px}
  @media(max-width:860px){.status-cards{grid-template-columns:1fr 1fr}}
  .phase-sec{border:1px solid;border-radius:18px;padding:18px 20px;background:rgba(255,255,255,0.55);backdrop-filter:blur(10px);box-shadow:0 2px 16px rgba(30,80,200,0.05)}
  .phase-sec-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px}
  .phase-sec-tag{display:inline-flex;align-items:center;gap:7px;color:#fff;font-size:12.5px;font-weight:700;padding:6px 14px;border-radius:999px}
  .phase-sec-tag i{width:7px;height:7px;border-radius:50%;background:#fff}
  .phase-sec-range{font-size:12px;font-weight:600;color:var(--navy3)}
  .phase-tl{display:flex;flex-direction:column}
  .phase-tl-row{display:grid;grid-template-columns:104px 22px 1fr;gap:0;align-items:stretch}
  .phase-tl-date{padding:10px 10px 10px 0;text-align:right}
  .phase-tl-day{display:block;font-size:12.5px;font-weight:700;color:var(--navy2)}
  .phase-tl-rel{display:block;font-size:10.5px;color:#94A3B8;margin-top:2px}
  .phase-tl-rail{position:relative}
  .phase-tl-rail::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:2px;background:rgba(160,190,240,0.5);transform:translateX(-50%)}
  .phase-tl-row:first-child .phase-tl-rail::before{top:15px}
  .phase-tl-row:last-child .phase-tl-rail::before{bottom:auto;height:15px}
  .phase-tl-dot{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:11px;height:11px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 2px rgba(200,220,255,0.5);z-index:1}
  .phase-tl-card{padding:8px 0 18px 14px;min-width:0}
  .phase-tl-title{display:flex;align-items:center;gap:7px;font-size:13.5px;font-weight:600;color:var(--navy);margin-bottom:7px}
  .phase-tl-desc{font-size:12.5px;color:var(--navy2);line-height:1.6}
  .phase-tl-chips{display:flex;flex-wrap:wrap;gap:7px}
  .phase-chip{font-size:12px;color:var(--navy2);background:rgba(237,244,255,0.7);border:1px solid rgba(200,220,255,0.6);border-radius:8px;padding:4px 10px;line-height:1.4}
  .phase-chip.lead{font-weight:700;background:#fff}
  .phase-ev-tag{font-size:10px;font-weight:700;padding:1px 8px;border-radius:999px}
  .phase-ev-tag.warn{background:#FEF2F2;color:#DC2626}
  .phase-ketluan{font-size:12.5px;color:var(--navy2);line-height:1.6;margin-top:6px;padding:11px 14px;background:rgba(235,244,255,0.45);border-left:3px solid;border-radius:0 10px 10px 0}
  .phase-ketluan-lbl{font-weight:700}

  /* MODAL */
  .modal-overlay{position:fixed;inset:0;background:rgba(10,22,40,0.45);backdrop-filter:blur(4px);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeIn .15s ease}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  .modal-box{background:#fff;border-radius:20px;max-width:540px;width:100%;box-shadow:0 24px 60px rgba(10,22,40,0.25);overflow:hidden;animation:slideUp .18s ease}
  @keyframes slideUp{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}
  .modal-head{padding:16px 20px;border-bottom:1px solid #E8F0FF;display:flex;align-items:center;justify-content:space-between;background:#F0F7FF}
  .modal-title{font-size:13px;font-weight:700;color:var(--navy2);display:flex;align-items:center;gap:7px}
  .modal-close{width:28px;height:28px;border-radius:8px;border:none;background:rgba(29,111,232,0.08);cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--muted2)}
  .modal-body{padding:20px}
  .modal-highlight{background:#FEF9C3;border-left:3px solid #EAB308;padding:10px 14px;border-radius:8px;font-size:13px;line-height:1.65;color:#713F12;margin-bottom:12px}
  .modal-footer{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px}

  /* SCROLL TO TOP */
  .scroll-top{position:fixed;bottom:28px;right:28px;width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--blue),var(--cyan));border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(29,111,232,0.35);transition:all .2s;z-index:100}
  .scroll-top:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(29,111,232,0.4)}
  .scroll-top.hidden{opacity:0;pointer-events:none;transform:translateY(8px)}

  /* FLOATING CHAT (Messenger-style) */
  .fab-chat{position:fixed;bottom:24px;right:24px;z-index:200;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#1D6FE8,#06B6D4);box-shadow:0 8px 24px rgba(29,111,232,0.4);display:flex;align-items:center;justify-content:center;transition:transform .15s}
  .fab-chat:hover{transform:scale(1.07)}
  .fab-badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;border-radius:999px;background:#EF4444;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;border:2px solid #fff}
  .fc-panel{position:fixed;bottom:24px;right:24px;z-index:200;width:370px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 48px);background:#fff;border-radius:18px;box-shadow:0 16px 48px rgba(15,42,94,0.28);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(200,220,255,0.5)}
  .fc-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:linear-gradient(120deg,#1A3F8F,var(--blue))}
  .fc-head-l{display:flex;align-items:center;gap:9px}
  .fc-avatar{width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;overflow:hidden}
  .fc-title{font-size:13px;font-weight:700;color:#fff}
  .fc-sub{font-size:11px;color:rgba(200,225,255,0.8)}
  .fc-head-r{display:flex;gap:4px}
  .fc-icon-btn{width:28px;height:28px;border-radius:8px;border:none;background:rgba(255,255,255,0.15);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s}
  .fc-icon-btn:hover{background:rgba(255,255,255,0.28)}
  .fc-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:9px;background:rgba(248,251,255,0.7)}
  .bot-avatar.sm{width:22px;height:22px}
  .bubble.sm{font-size:12.5px;padding:8px 11px;max-width:80%}
  .fc-sug{display:flex;gap:6px;overflow-x:auto;padding:8px 12px 0;scrollbar-width:none}
  .fc-sug::-webkit-scrollbar{display:none}
  .fc-sug button{flex-shrink:0;font-size:11px;font-weight:500;padding:5px 11px;border-radius:999px;border:1px solid rgba(200,220,255,0.6);background:#fff;color:var(--navy3);cursor:pointer;white-space:nowrap;font-family:inherit}
  .fc-sug button:hover{border-color:var(--blue);color:var(--blue)}
  .fc-sug button:disabled{opacity:0.5}
  .fc-input{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid rgba(200,220,255,0.4)}
  .fc-input input{flex:1;border:1px solid rgba(200,220,255,0.6);border-radius:999px;padding:8px 14px;font-size:13px;font-family:inherit;outline:none;color:var(--navy)}
  .fc-input input:focus{border-color:var(--blue)}
  .send-btn.sm{width:32px;height:32px;flex-shrink:0}

  /* CHAT */
  .chat-page{max-width:960px;margin:0 auto;padding:16px 24px}
  .chat-wrap{display:flex;flex-direction:column;height:calc(100vh - 130px)}
  .chat-msgs{flex:1;overflow-y:auto;padding-bottom:16px;display:flex;flex-direction:column;gap:10px}
  .chat-suggestions{display:flex;flex-wrap:nowrap;overflow-x:auto;gap:6px;padding:0 2px 8px;scrollbar-width:none}
  .chat-suggestions::-webkit-scrollbar{display:none}
  .sug-chip{font-size:12px;font-weight:500;padding:5px 14px;border-radius:999px;border:1px solid rgba(200,220,255,0.6);background:rgba(255,255,255,0.75);color:var(--navy3);cursor:pointer;transition:all .15s;font-family:inherit;backdrop-filter:blur(8px);white-space:nowrap;flex-shrink:0}
  .sug-chip:hover{border-color:var(--blue);background:rgba(235,244,255,0.9);color:var(--blue)}
  .sug-chip:disabled{opacity:0.5;cursor:default}
  .msg-row{display:flex;align-items:flex-end;gap:8px}
  .msg-row.user{justify-content:flex-end}
  .bot-avatar{width:28px;height:28px;border-radius:10px;background:linear-gradient(135deg,var(--blue),var(--cyan));display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden}
  .bubble{max-width:78%;border-radius:18px;padding:11px 15px;font-size:13px;line-height:1.6;text-align:left}
  .bubble.user{background:linear-gradient(135deg,var(--blue),var(--cyan));color:#fff;box-shadow:0 3px 12px rgba(29,111,232,0.22)}
  .bubble.bot{background:rgba(255,255,255,0.82);color:var(--navy2);border:1px solid rgba(200,220,255,0.45);backdrop-filter:blur(10px)}
  .bubble.bot ul{padding-left:18px;margin:5px 0;list-style:disc}
  .bubble.bot li{margin-bottom:4px}
  .bubble.bot p{margin:4px 0}
  .bubble .md-h2{font-size:13px;font-weight:700;color:var(--navy);margin:8px 0 3px}
  .bubble .md-h3{font-size:12.5px;font-weight:700;color:var(--navy2);margin:6px 0 2px}
  .bubble.user .md-h2,.bubble.user .md-h3{color:#fff}
  .typing{display:flex;gap:5px;align-items:center;padding:4px 0}
  .typing span{width:7px;height:7px;border-radius:50%;background:var(--blue);animation:bounce .9s infinite}
  .typing span:nth-child(2){animation-delay:.15s}
  .typing span:nth-child(3){animation-delay:.3s}
  @keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}
  .chat-input-row{display:flex;align-items:center;gap:10px;padding:10px 16px;background:rgba(255,255,255,0.82);border:1px solid rgba(200,220,255,0.5);border-radius:18px;backdrop-filter:blur(12px);box-shadow:0 2px 16px rgba(30,80,200,0.07)}
  .chat-input{flex:1;border:none;outline:none;background:transparent;font-size:13px;color:var(--navy);font-family:inherit}
  .chat-input::placeholder{color:var(--muted)}
  .send-btn{width:34px;height:34px;border-radius:10px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;background:linear-gradient(135deg,var(--blue),var(--cyan))}
  .send-btn:disabled{background:rgba(200,220,255,0.4);cursor:default}
  .send-btn:not(:disabled):hover{transform:translateY(-1px)}
  .kbd-hint{font-size:10px;color:var(--muted);display:flex;align-items:center;gap:4px}
  .kbd{background:rgba(200,220,255,0.3);border:1px solid rgba(200,220,255,0.6);border-radius:4px;padding:1px 5px;font-size:9px;color:var(--muted2)}
`

// ─── SVG ICONS ────────────────────────────────────────────────────────────────
function Svg({ d = 20, children, style, color }) {
  return (
    <svg width={d} height={d} viewBox="0 0 24 24" fill="none"
      stroke={color || "currentColor"} strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" style={style}>
      {children}
    </svg>
  )
}
const Icon = {
  Cross:      p => <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="12" y1="7" x2="12" y2="17"/><line x1="7" y1="12" x2="17" y2="12"/></Svg>,
  Upload:     p => <Svg {...p}><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></Svg>,
  FileText:   p => <Svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></Svg>,
  Chat:       p => <Svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></Svg>,
  Alert:      p => <Svg {...p}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></Svg>,
  Calendar:   p => <Svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></Svg>,
  Scalpel:    p => <Svg {...p}><path d="m19 2-7 7-4 1 1-4 7-7 3 3z"/><path d="M13 9 4.5 17.5"/><path d="M4.5 17.5 3 22l4.5-1.5L19 9"/></Svg>,
  Flask:      p => <Svg {...p}><path d="M9 3h6l2.5 9-8.5 0L9 3z"/><path d="M6.5 12c-.5 2-1.5 4-1.5 5.5A3.5 3.5 0 0 0 8.5 21h7a3.5 3.5 0 0 0 3.5-3.5c0-1.5-1-3.5-1.5-5.5"/></Svg>,
  Ultrasound: p => <Svg {...p}><circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4"/><path d="M17.7 6.3a8 8 0 0 1 0 11.4"/><path d="M3.5 3.5a14 14 0 0 0 0 17"/><path d="M20.5 3.5a14 14 0 0 1 0 17"/></Svg>,
  Pill:       p => <Svg {...p}><rect x="2" y="8" width="20" height="8" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/></Svg>,
  Print:      p => <Svg {...p}><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></Svg>,
  Back:       p => <Svg {...p}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></Svg>,
  Send:       p => <Svg {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></Svg>,
  Robot:      p => <Svg {...p}><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></Svg>,
  Heart:      p => <Svg {...p}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></Svg>,
  Pulse:      p => <Svg {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></Svg>,
  Close:      p => <Svg {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Svg>,
  Clock:      p => <Svg {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Svg>,
  Shield:     p => <Svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></Svg>,
  Search:     p => <Svg {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></Svg>,
  ChevUp:     p => <Svg {...p}><polyline points="18 15 12 9 6 15"/></Svg>,
  ChevDown:   p => <Svg {...p}><polyline points="6 9 12 15 18 9"/></Svg>,
  Layers:     p => <Svg {...p}><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></Svg>,
  ShieldCheck:p => <Svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></Svg>,
  Octagon:    p => <Svg {...p}><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></Svg>,
  TrendUp:    p => <Svg {...p}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></Svg>,
  Steps:      p => <Svg {...p}><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 0 0 3-3V7.5"/></Svg>,
  Brain:      p => <Svg {...p}><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z"/></Svg>,
  Stethoscope:p => <Svg {...p}><path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.3.3 0 1 0 .2.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/></Svg>,
  Dot:        ({color="#8B5CF6"}) => <svg width="11" height="11" viewBox="0 0 11 11"><circle cx="5.5" cy="5.5" r="4" fill={color}/></svg>,
}

// Logo mark: pulse/ECG flow trong khối bo tròn gradient (chủ đề tim mạch)
let _brandId = 0
function BrandMark({ size = 36, radius = 10 }) {
  const id = `bm${_brandId++}`
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display:"block" }}>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1A56DB"/><stop offset="0.55" stopColor="#1D6FE8"/><stop offset="1" stopColor="#0E9488"/>
        </linearGradient>
        <radialGradient id={`${id}h`} cx="0.3" cy="0.25" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22"/>
          <stop offset="0.5" stopColor="#fff" stopOpacity="0"/>
        </radialGradient>
        <filter id={`${id}gl`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect width="40" height="40" rx={radius} fill={`url(#${id}g)`}/>
      <rect width="40" height="40" rx={radius} fill={`url(#${id}h)`}/>
      <rect x="0.6" y="0.6" width="38.8" height="38.8" rx={radius-0.6} fill="none" stroke="#fff" strokeOpacity="0.18"/>
      {/* Tim viền mảnh (backdrop) */}
      <path d="M20 30.5 C20 30.5 8 23.2 8 15 C8 11.2 10.8 8.6 14.2 8.6 C16.6 8.6 18.7 10 20 12.2 C21.3 10 23.4 8.6 25.8 8.6 C29.2 8.6 32 11.2 32 15 C32 23.2 20 30.5 20 30.5 Z"
        fill="none" stroke="#fff" strokeWidth="1.4" strokeOpacity="0.28"/>
      {/* Đường ECG (the 'Parcours') */}
      <path d="M5.5 20.5 H13.5 L16 14.2 L20 27.2 L23 17.6 L25.5 20.5 H34.5"
        stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
      {/* 3 nốt = 3 phase, sáng dần; nốt cuối phát sáng = phase hiện tại */}
      <circle cx="10" cy="20.5" r="1.2" fill="#fff" fillOpacity="0.55"/>
      <circle cx="20" cy="27.2" r="1.7" fill="#fff"/>
      <circle cx="34.5" cy="20.5" r="2.1" fill="#7FE7F5" filter={`url(#${id}gl)`}/>
    </svg>
  )
}

// Ảnh avatar MedAmi nhúng sẵn (base64) — luôn hiển thị, không phụ thuộc file/deploy
const MEDAMI_AVATAR = "data:image/png;base64,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"
// Avatar MedAmi: ưu tiên ảnh medami.png, tự fallback về icon robot nếu ảnh lỗi/chưa deploy
function MedAmiAvatar({ robotSize = 13 }) {
  const [err, setErr] = useState(false)
  if (err) return <Icon.Robot d={robotSize} color="white"/>
  return (
    <img src={MEDAMI_AVATAR} alt="MedAmi"
      style={{ width:"100%", height:"100%", objectFit:"cover", borderRadius:"inherit", display:"block" }}
      onError={()=>setErr(true)}/>
  )
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
const ABBR_MAP = {
  "ĐMC":"Động Mạch Chủ (ĐMC)", "ĐMP":"Động Mạch Phổi (ĐMP)",
  "ĐTĐ":"Đái Tháo Đường (ĐTĐ)", "HoC":"Hở Chủ (HoC)",
  "HoBL":"Hở Ba Lá (HoBL)", "EF":"Phân Suất Tống Máu (EF)",
  "INR":"Chỉ Số Đông Máu (INR)", "CRP":"Protein Phản Ứng C (CRP)",
  "CVP":"Áp Lực Tĩnh Mạch Trung Tâm (CVP)",
  "PRVC":"Thông Khí Kiểm Soát Áp Lực Thể Tích (PRVC)",
}
function expandAbbr(text) {
  if (!text) return text
  let result = text
  // Hồ sơ HIS dùng "#" với nghĩa "khoảng/xấp xỉ". Đổi cho dễ đọc.
  result = result.replace(/\s*#\s*/g, " khoảng ")
  // Gọn khoảng trắng thừa
  result = result.replace(/\s{2,}/g, " ").trim()
  // Vá lỗi tách chữ tiếng Việt do AI sinh ra (vd "v ấn đề" -> "vấn đề"):
  // phụ âm đơn đứng tách giữa 2 dấu cách, ngay trước nguyên âm có dấu, không phải từ hợp lệ.
  result = result.replace(/(^|\s)([bcdghklmnpqrstvxBCDGHKLMNPQRSTVX]) (?=[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ])/g, "$1$2")
  Object.entries(ABBR_MAP).forEach(([abbr, full]) => {
    let replaced = false
    result = result.replace(new RegExp(`(?<!\\()\\b${abbr}\\b(?! \\()(?![^(]*\\))`, "g"), m => {
      if (!replaced) { replaced = true; return full }
      return m
    })
  })
  return result
}

// Split long text into bullet points on '. ' or '; '
function textToBullets(text) {
  const parts = text.split(/(?<=\.)\s+(?=[A-ZĐÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴ])/u)
    .filter(p => p.trim().length > 0)
  if (parts.length <= 1) return null
  return parts.map(p => p.replace(/\.$/, "").trim())
}

function BulletText({ text, className = "" }) {
  const bullets = textToBullets(text)
  if (!bullets) return <span className={className}>{expandAbbr(text)}</span>
  return (
    <ul className="bullet-list">
      {bullets.map((b, i) => <li key={i}>{expandAbbr(b)}</li>)}
    </ul>
  )
}

// Sparkline
function Sparkline({ values, color = "#1D6FE8", width = 80, height = 26, fluid = false, dates = null }) {
  if (!values || values.length < 2) return null
  const VW = fluid ? 100 : width
  const min = Math.min(...values), max = Math.max(...values)
  const range = max - min || 1
  const coords = values.map((v, i) => ({
    x: (i / (values.length - 1)) * VW,
    y: height - ((v - min) / range) * (height - 6) - 3,
    v,
  }))
  const pts = coords.map(c => `${c.x},${c.y}`).join(" ")
  return (
    <svg width={fluid ? "100%" : width} height={height} viewBox={`0 0 ${VW} ${height}`}
      preserveAspectRatio={fluid ? "none" : "xMidYMid meet"} style={{ display:"block", overflow:"visible" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect={fluid ? "non-scaling-stroke" : undefined} />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={i === coords.length-1 ? 2 : 1.5} fill={color}
          vectorEffect={fluid ? "non-scaling-stroke" : undefined} style={{ cursor:"pointer" }}>
          <title>{dates && dates[i] ? `${dates[i]}: ${c.v}` : `${c.v}`}</title>
        </circle>
      ))}
    </svg>
  )
}

// Donut chart (SVG, no lib)
function DonutChart({ data, size = 64, centerValue = null, centerLabel = "vấn đề" }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const shown = centerValue != null ? centerValue : total
  let offset = 0
  const R = 22, cx = size / 2, cy = size / 2
  const circ = 2 * Math.PI * R
  const segments = total > 0 ? data.map(d => {
    const pct = d.value / total
    const len = pct * circ
    const seg = { ...d, offset: circ - offset, dasharray: `${len} ${circ - len}` }
    offset += len
    return seg
  }) : []
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="10" />
      {segments.map((s, i) => (
        <circle key={i} cx={cx} cy={cy} r={R} fill="none"
          stroke={s.color} strokeWidth="10"
          strokeDasharray={s.dasharray}
          strokeDashoffset={s.offset}
          transform={`rotate(-90 ${cx} ${cy})`} />
      ))}
      <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
        fontSize="13" fontWeight="800" fill="#FFFFFF">{shown}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" dominantBaseline="middle"
        fontSize="7.5" fill="rgba(225,238,255,0.92)" fontWeight="600">{centerLabel}</text>
    </svg>
  )
}

// Source chip (replaces underline link)
function SrcChip({ text, onClick }) {
  return (
    <span className="src-chip" onClick={onClick}>
      <Icon.Search d={10} />
      Căn cứ
    </span>
  )
}

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const MOCK_REPORT = {
  thong_tin_benh_nhan: { ho_ten:"NGUYỄN VĂN A", ngay_sinh:"09/11/1963", tuoi:62, gioi_tinh:"Nam", dia_chi:"Phường Chương Mỹ, Hà Nội", ngay_vao_vien:"24/09/2025", ngay_ra_vien:"03/10/2025", so_benh_an:"25.019647" },
  chan_doan_chinh: "Sau phẫu thuật thay van ĐMC cơ học On-X số 23. Hở hẹp chủ (HHoC). Giãn ĐMC lên. Cầu cơ hẹp nhẹ ĐM liên thất trước. Đau thắt ngực (ĐTN). Suy tim (ST).",
  ly_do_vao_vien: "Mệt, khó thở, siêu âm tim phát hiện hẹp chủ khít, nhập viện để phẫu thuật thay van.",
  tien_su_benh: "Hở hẹp van ĐMC (bản thân). Nhân viên hành chính, không ghi nhận đái tháo đường.",
  phau_thuat: { ngay:"26/09/2025", phuong_phap:"Phẫu thuật thay van ĐMC cơ học On-X số 23", ket_qua:"Thành công. Van ĐMC cơ học đúng vị trí, hoạt động bình thường trên siêu âm kiểm tra.", bac_si_phau_thuat:"ThS.BS Nguyễn Trọng X / ThS.BS Trần Văn Y" },
  dien_bien_lam_sang: [
    { ngay:"24/09/2025", mo_ta:"Nhập viện khoa Phẫu Thuật Tim Người Lớn. Chẩn đoán hở hẹp chủ, lên lịch phẫu thuật.", loai:"binh_thuong" },
    { ngay:"26/09/2025", mo_ta:"Phẫu thuật lúc 12:42. Thay van ĐMC cơ học On-X số 23 thành công.", loai:"binh_thuong" },
    { ngay:"26/09/2025", mo_ta:"Sau mổ: CRP 241.42 mg/L, bạch cầu tăng cao. Bắt đầu kháng sinh Buflan 2g (Cefoperazone + Sulbactam).", loai:"canh_bao" },
    { ngay:"27/09/2025", mo_ta:"CRP giảm còn 130.17 mg/L. Tiếp tục Buflan 2g, Furosemid IV, Vincerol chống đông.", loai:"bat_thuong" },
    { ngay:"30/09/2025", mo_ta:"CRP còn 106.61 mg/L. Siêu âm: EF 50%, chênh áp ĐMC 16 mmHg, có dịch màng phổi. Van cơ học hoạt động.", loai:"bat_thuong" },
    { ngay:"03/10/2025", mo_ta:"Ra viện. CRP giảm còn 42.3 mg/L. INR 2.25 (trong ngưỡng). NT-proBNP 2280 pg/mL. Hẹn tái khám 10/10.", loai:"binh_thuong" },
  ],
  vital_signs: [
    { ngay:"28/09", crp:130.2, wbc:16.6 },
    { ngay:"29/09", crp:241.4, wbc:15.3 },
    { ngay:"01/10", crp:106.6, wbc:14.5 },
    { ngay:"03/10", crp:42.3,  wbc:11.8 },
  ],
  // Dynamic lab list thay vì 4 trường cố định
  xet_nghiem_truoc_mo: { ghi_chu:"Xét nghiệm trước mổ: EF 61 đến 74%, chênh áp ĐMC tối đa 71 mmHg (SA MINERVA 12/09, hẹp khít). INR chưa dùng chống đông." },
  xet_nghiem_meta: [
    { key:"HGB",       val:"116 g/L",      rawVal:116,   unit:"g/L",    desc:"Hemoglobin (hồng cầu)", normal:"130-172", status:"low",    trend:[122,127,115,116], trendDates:["26/09","27/09","01/10","03/10"], arrow:"down" },
    { key:"WBC",       val:"11.79 G/L",    rawVal:11.79, unit:"G/L",    desc:"Bạch cầu",              normal:"4-10",    status:"high",   trend:[17.2,14.5,11.79], trendDates:["27/09","01/10","03/10"], arrow:"down" },
    { key:"PLT",       val:"308 G/L",      rawVal:308,   unit:"G/L",    desc:"Tiểu cầu",              normal:"150-400", status:"normal", trend:[151,217,308], trendDates:["26/09","29/09","03/10"], arrow:"up" },
    { key:"Creatinin", val:"77 µmol/L",    rawVal:77,    unit:"µmol/L", desc:"Chức năng thận",        normal:"62-106",  status:"normal", trend:[74,77,77], trendDates:["27/09","29/09","03/10"], arrow:"ok" },
    { key:"Na+",       val:"131 mmol/L",   rawVal:131,   unit:"mmol/L", desc:"Natri máu",             normal:"135-145", status:"low",    trend:[133,127,131], trendDates:["29/09","30/09","03/10"], arrow:"up" },
    { key:"K+",        val:"3.82 mmol/L",  rawVal:3.82,  unit:"mmol/L", desc:"Kali máu",              normal:"3.5-5.1", status:"normal", trend:[3.34,5.1,3.82], trendDates:["29/09","30/09","03/10"], arrow:"down" },
    { key:"Albumin",   val:"31.8 g/L",     rawVal:31.8,  unit:"g/L",    desc:"Albumin máu",           normal:"35-52",   status:"low",    trend:[31.8], trendDates:["29/09"], arrow:"down" },
    { key:"CRP",       val:"42.3 mg/L",    rawVal:42.3,  unit:"mg/L",   desc:"Viêm nhiễm (gần nhất)", normal:"<5",      status:"high",   trend:[241.4,106.6,42.3], trendDates:["29/09","01/10","03/10"], arrow:"down" },
    { key:"INR",       val:"2.25",         rawVal:2.25,  unit:"",       desc:"Đông máu (ngày ra viện)",normal:"2.0-3.0", status:"normal", trend:[1.24,5.97,2.25], trendDates:["26/09","ra viện","03/10"], arrow:"down" },
    { key:"NT-proBNP", val:"2280 pg/mL",   rawVal:2280,  unit:"pg/mL",  desc:"Marker suy tim",        normal:"<125",    status:"high",   trend:[317,2280], trendDates:["24/09","29/09"], ngay:"29/09/2025", arrow:"up" },
    { key:"EF",        val:"71%",          rawVal:71,    unit:"%",      desc:"Phân suất tống máu (SA gần nhất 26/05/2026)", normal:"55-70", status:"high", trend:[50,44,58,71], trendDates:["30/09","10/10","28/10","26/05"], arrow:"up" },
  ],
  // Mảng động: tất cả lượt siêu âm theo thời gian. latest = lượt gần nhất.
  sieu_am_tim: {
    lan_kham: [
      { ngay:"31/07/2025", nguon:"MINERVA PACS", chan_doan:"HHoHL, HHoC", ef:61, grad_max:54, grad_tb:34, hoc:"Nhẹ-vừa", phase:"truoc_mo", ghi_chu:"Trước mổ. Hẹp ĐMC vừa, S mở van 1.23 cm². Nhĩ trái giãn LAVI 52.", canh_bao:false },
      { ngay:"12/09/2025", nguon:"MINERVA PACS", chan_doan:"HHoC", ef:74, grad_max:71, grad_tb:51, hoc:"Nhẹ-vừa", phase:"truoc_mo", ghi_chu:"Trước mổ. Hẹp van ĐMC KHÍT, S mở van 1.06 cm². Tổn thương nhiều.", canh_bao:false },
      { ngay:"30/09/2025", nguon:"HIS Doppler", chan_doan:"Van ĐMC cơ học", ef:50, grad_max:16, grad_tb:null, hoc:"Nhẹ (trong van)", phase:"sau_mo", ghi_chu:"Sau mổ 4 ngày. EF giảm còn 50%. Dịch màng phổi 2 bên, dịch màng ngoài tim ít.", canh_bao:true },
      { ngay:"10/10/2025", nguon:"MINERVA PACS", chan_doan:"Van ĐMC cơ học", ef:44, grad_max:20, grad_tb:16, hoc:"Nhẹ (trong van)", phase:"sau_mo", ghi_chu:"Tái khám 1 tuần. EF giảm nặng 44%. Dịch màng ngoài tim NHIỀU, dấu hiệu ÉP NHẸ THẤT PHẢI.", canh_bao:true },
      { ngay:"28/10/2025", nguon:"MINERVA PACS", chan_doan:"Van ĐMC cơ học", ef:58, grad_max:14, grad_tb:5, hoc:"Nhẹ (trong van)", phase:"hoi_phuc", ghi_chu:"EF phục hồi 58%. Hết dịch màng phổi, hết dịch màng ngoài tim.", canh_bao:false },
      { ngay:"25/11/2025", nguon:"MINERVA PACS", chan_doan:"Van ĐMC cơ học", ef:71, grad_max:15, grad_tb:9, hoc:"Nhẹ (trong van)", phase:"hoi_phuc", ghi_chu:"EF phục hồi tốt 71%. Không dịch màng phổi, không dịch màng ngoài tim.", canh_bao:false },
      { ngay:"21/01/2026", nguon:"MINERVA PACS", chan_doan:"Van ĐMC cơ học, HHoHL", ef:58, grad_max:13, grad_tb:8, hoc:"Nhẹ (trong van)", phase:"tai_kham", ghi_chu:"Hẹp hai lá nhẹ (S 2.0 cm²), HoHL nhẹ. Nhĩ trái giãn.", canh_bao:false },
      { ngay:"10/04/2026", nguon:"MINERVA PACS", chan_doan:"Van ĐMC cơ học", ef:69, grad_max:11, grad_tb:null, hoc:"Nhẹ (trong van)", phase:"tai_kham", ghi_chu:"Thất trái dày đồng tâm. Nhĩ trái giãn LAVI 55 ml/m².", canh_bao:false },
      { ngay:"26/05/2026", nguon:"MINERVA PACS", chan_doan:"Van ĐMC cơ học", ef:71, grad_max:8, grad_tb:null, hoc:"Nhẹ (trong van)", phase:"tai_kham", ghi_chu:"Van hoạt động bình thường. Nhĩ trái giãn LAVI 50 ml/m².", canh_bao:false, latest:true },
    ],
  },
  canh_bao_nguy_co: [
    { mo_ta:"Ngày 10/10/2025: dịch màng ngoài tim nhiều, dấu hiệu ép nhẹ thất phải kèm EF giảm còn 44%. Biến chứng tràn dịch sau mổ cần theo dõi sát, đã hồi phục ở các lần tái khám sau.", muc_do:"cao", can_cu:"Siêu âm tim MINERVA 10/10/2025: dịch MNT nhiều, ép nhẹ thất phải, EF 44%." },
    { mo_ta:"NT-proBNP 2280 pg/mL: rất cao, chỉ điểm suy tim cần theo dõi chặt sau xuất viện.", muc_do:"cao", can_cu:"XN ngày 29/09/2025: NT-proBNP 2280 pg/mL (ngưỡng bình thường dưới 125 pg/mL)." },
    { mo_ta:"INR biến động rộng quanh thời điểm chuyển thuốc: từ 1.24 (dưới ngưỡng, nguy cơ huyết khối van) tăng vọt 5.97 (trên ngưỡng, nguy cơ chảy máu) trước khi ổn định 2.25. Van cơ học On-X cần INR mục tiêu 2.0 đến 3.0, theo dõi sát.", muc_do:"cao", can_cu:"Theo dõi INR 26/09 đến 10/10/2025. Đổi Warfarin (nội trú) sang Vincerol khi ra viện." },
    { mo_ta:"CRP còn 42.3 mg/L khi ra viện (bình thường dưới 5). Phản ứng viêm sau mổ chưa về mức bình thường.", muc_do:"trung_binh", can_cu:"XN ngày 03/10/2025: CRP 42.3 mg/L, đỉnh 241.42 ngày 29/09." },
    { mo_ta:"Hạ natri máu kéo dài sau mổ: Na+ dao động 127 đến 133 mmol/L (bình thường 135 đến 145), thấp nhất 127 ngày 30/09. Theo dõi điện giải khi dùng lợi tiểu.", muc_do:"trung_binh", can_cu:"Điện giải đồ 24/09 đến 03/10/2025: Na+ thấp nhất 127 mmol/L (30/09)." },
    { mo_ta:"Albumin thấp 31.8 g/L (bình thường 35 đến 52) và thiếu máu nhẹ HGB 116 g/L. Ảnh hưởng phân bố thuốc và lành thương, cần dinh dưỡng hỗ trợ.", muc_do:"thap", can_cu:"XN 29/09/2025: Albumin 31.8 g/L. CTM 03/10: HGB 116 g/L." },
  ],
  // Kết luận ngắn từng giai đoạn (Clinical takeaway theo phase)
  ket_luan_giai_doan: {
    1: "BN nhập viện với hẹp van ĐMC khít (diện tích 1.06 cm², chênh áp 71/51 mmHg). Chỉ định phẫu thuật thay van đúng đắn. Chức năng tim tiền phẫu còn tốt (EF 74%), chức năng thận bình thường, INR 1.24 (chưa dùng chống đông).",
    2: "Phẫu thuật thành công. Hậu phẫu phức tạp: viêm phản ứng mạnh (CRP đỉnh 241 mg/L), INR biến động rộng (1.24 đến 5.97 rồi 2.25), hạ Na+ dai dẳng, Albumin thấp, EF giảm tạm thời (50%) khi ra viện. Ra viện ngày 03/10 với INR trong mục tiêu, CRP đang giảm.",
    3: "Biến chứng tràn dịch màng tim sau mổ (10/10) đã tự hồi phục hoàn toàn. EF phục hồi tốt đến 71%. Van On-X hoạt động bình thường (chênh áp 8 mmHg). Nhĩ trái còn giãn (LAVI 50 ml/m²), cần theo dõi rung nhĩ. Chưa có NT-proBNP mới sau xuất viện để đánh giá suy tim ngoại trú.",
  },
  // Clinical Takeaway tổng (đọc trong 15 giây)
  clinical_takeaway: [
    { txt:"Bệnh nhân đã vượt qua giai đoạn hậu phẫu nguy cơ cao, hiện ổn định ở giai đoạn ngoại trú.", loai:"good" },
    { txt:"Chức năng tim hồi phục gần hoàn toàn (EF 71%), van On-X hoạt động tốt, hết dịch màng tim.", loai:"good" },
    { txt:"Vấn đề còn theo dõi: chống đông van cơ học (INR mục tiêu 2.0 đến 3.0), điện giải, và nguy cơ rung nhĩ do nhĩ trái giãn.", loai:"watch" },
    { txt:"Chưa có NT-proBNP đo lại sau xuất viện để đánh giá suy tim ngoại trú thực sự.", loai:"watch" },
  ],
  // Lý luận lâm sàng đa biến theo giai đoạn (Clinical Reasoning Layer)
  ly_luan_lam_sang: [
    { muc:"critical", phase:2, tieu_de:"Bệnh cảnh phức tạp: Hạ Na+ kèm sau mổ tim lớn và Albumin thấp",
      noi_dung:"Cùng ngày 29/09: (1) Na+ 131 mmol/L (hạ nhẹ) cộng (2) Albumin 31.8 g/L (thấp) cộng (3) CRP còn 130 mg/L. Hạ albumin làm giảm áp lực keo, dễ thoát dịch, giải thích dịch màng phổi và màng tim. Đồng thời albumin thấp ảnh hưởng phân bố Vincerol làm INR khó đoán. Cần dinh dưỡng hỗ trợ song song với lợi tiểu." },
    { muc:"critical", phase:2, tieu_de:"INR biến động nguy hiểm: 1.24 rồi 5.97 rồi 2.25",
      noi_dung:"INR 1.24 (24/09): nguy cơ huyết khối van cơ học. INR 5.97 (27/09, đỉnh): nguy cơ chảy máu nghiêm trọng. Nguyên nhân: chuyển đổi phác đồ chống đông cộng Buflan (Cefoperazone có hoạt tính giống kháng vitamin K) làm tăng tác dụng Vincerol. INR ra viện 2.25 đã vào mục tiêu 2.0 đến 3.0 của van cơ học On-X." },
    { muc:"critical", phase:3, tieu_de:"EF 44% kèm dịch màng ngoài tim nhiều: Biến chứng sau mổ nghiêm trọng",
      noi_dung:"EF giảm từ 50% (30/09) còn 44% (10/10) kèm dịch màng ngoài tim nhiều và ép nhẹ thất phải: đây là biến chứng tràn dịch màng tim sau mổ (gặp khoảng 1 đến 3% trường hợp). Không phải suy tim mạn. Cần phân biệt với hội chứng Dressler. Kết cục: tự hồi phục ở lần tái khám 28/10 (EF 58%, hết dịch)." },
    { muc:"info", phase:3, tieu_de:"NT-proBNP 2280 pg/mL (ngày 29/09, Giai đoạn 2): Không kết luận suy tim giai đoạn này",
      noi_dung:"NT-proBNP đo ngày 29/09 (3 ngày sau mổ tim lớn). Tăng NT-proBNP ngay sau phẫu thuật tim là phổ biến và có thể không phản ánh suy tim mạn. BN hiện ở Giai đoạn 3, EF đã phục hồi 71% (26/05/2026). Khuyến cáo: đo lại NT-proBNP ở lần tái khám sắp tới để có giá trị baseline ngoại trú thực sự." },
    { muc:"warning", phase:3, tieu_de:"Nhĩ trái giãn LAVI 50 đến 55 ml/m² dai dẳng: Theo dõi rung nhĩ",
      noi_dung:"Nhĩ trái giãn từ trước mổ (LAVI 52) và vẫn giãn ở Giai đoạn 3 (LAVI 50 đến 55). Giãn nhĩ trái dai dẳng là yếu tố nguy cơ rung nhĩ. Kết hợp với van tim cơ học đang dùng chống đông: nếu xuất hiện rung nhĩ, INR mục tiêu cần điều chỉnh lên 2.5 đến 3.5. Đề nghị: ECG định kỳ, Holter nếu có triệu chứng hồi hộp." },
  ],
  // Trạng thái vấn đề: tách "đang tồn tại" với "biến cố đã qua"
  problem_status: {
    hien_tai: [
      { ten:"Van cơ học On-X", trang_thai:"active", mo_ta:"Hoạt động tốt, chênh áp 8 mmHg" },
      { ten:"Điều trị chống đông (Vincerol)", trang_thai:"active", mo_ta:"Bắt buộc suốt đời, INR mục tiêu 2.0 đến 3.0" },
      { ten:"Nhĩ trái giãn (LAVI 50 đến 55 ml/m²)", trang_thai:"monitoring", mo_ta:"Dai dẳng, nguy cơ rung nhĩ, cần ECG/Holter" },
      { ten:"Hẹp hai lá nhẹ", trang_thai:"monitoring", mo_ta:"Phát hiện 21/01/2026, theo dõi tiến triển" },
    ],
    da_qua: [
      { ten:"Tràn dịch màng tim ép nhẹ thất phải", mo_ta:"10/10/2025, đã hết dịch ở lần tái khám 28/10" },
      { ten:"EF giảm còn 44%", mo_ta:"10/10/2025 do dịch màng tim, đã hồi phục 71%" },
      { ten:"INR tăng 5.97", mo_ta:"27/09/2025, đã ổn định về 2.25" },
      { ten:"Hạ Natri máu hậu phẫu", mo_ta:"Na+ thấp nhất 127 (30/09), giai đoạn nội trú" },
      { ten:"Albumin thấp", mo_ta:"31.8 g/L (29/09), giai đoạn nội trú" },
    ],
  },
  // Hành động ưu tiên ở lần tái khám tới (Next Actions cho bác sĩ ngoại trú)
  hanh_dong_uu_tien: [
    { uu_tien:1, viec:"Kiểm tra INR định kỳ", ly_do:"Van cơ học On-X cần chống đông lâu dài suốt đời, giữ INR trong mục tiêu 2.0 đến 3.0. Đây là lý do hiện tại, không phụ thuộc kháng sinh ngắn ngày đã kết thúc." },
    { uu_tien:2, viec:"Làm lại điện giải đồ Na+, K+ và Creatinin", ly_do:"Đang phối hợp lợi tiểu Agifuros với SGLT2i Forxiga kéo dài, nguy cơ hạ Natri máu và rối loạn điện giải." },
    { uu_tien:3, viec:"Đo ECG, cân nhắc Holter 24h tầm soát rung nhĩ", ly_do:"Nhĩ trái giãn dai dẳng (LAVI 50 đến 55 ml/m²) là yếu tố nguy cơ rung nhĩ trên bệnh nhân van cơ học." },
    { uu_tien:4, viec:"Đo lại NT-proBNP để có giá trị nền ngoại trú", ly_do:"NT-proBNP 2280 pg/mL đo ở hậu phẫu ngày 3, chưa phản ánh tình trạng suy tim ngoại trú hiện tại." },
  ],
  thuoc_cuoi_ky: [
    { ten_thuoc:"Buflan 2g (Cefoperazone + Sulbactam)", nhom:"Kháng sinh",  lieu:"2 lọ/ngày",   cach_dung:"Tiêm truyền tĩnh mạch 9h-21h", bat_dau:"28/09", ket_thuc:"03/10", color:"#EF4444" },
    { ten_thuoc:"Medoxasol 500mg (Levofloxacin)",        nhom:"Kháng sinh", lieu:"2 viên/ngày",  cach_dung:"Uống 9h và 20h", bat_dau:"03/10", so_luong:14, vien_moi_ngay:2, color:"#F97316" },
    { ten_thuoc:"Vincerol 1mg (Acenocoumarol)",          nhom:"Chống đông", lieu:"1 viên/ngày",  cach_dung:"Uống 20h mỗi ngày",     bat_dau:"03/10", keo_dai:true, color:"#8B5CF6" },
    { ten_thuoc:"Agifuros 40mg (Furosemid)",             nhom:"Lợi tiểu",   lieu:"1 viên/ngày",  cach_dung:"Uống 9h",               bat_dau:"28/09", keo_dai:true, color:"#06B6D4" },
    { ten_thuoc:"Forxiga 10mg (Dapagliflozin)",          nhom:"Tim mạch",   lieu:"1 viên/ngày",  cach_dung:"Uống buổi sáng",        bat_dau:"26/09", keo_dai:true, color:"#10B981" },
    { ten_thuoc:"Pantoloc 40mg (Pantoprazole)",          nhom:"Dạ dày",     lieu:"1 viên/ngày",  cach_dung:"Uống 6h trước ăn",      bat_dau:"24/09", keo_dai:true, color:"#3B82F6" },
  ],
  tom_tat_toan_canh: "GIAI ĐOẠN TRƯỚC MỔ: Bệnh nhân nam 62 tuổi, tiền sử hở hẹp van ĐMC, nhập viện ngày 24/09/2025 vì đau ngực và khó thở. Siêu âm trước mổ cho thấy hẹp khít van ĐMC, chênh áp tối đa 71 mmHg, EF còn bảo tồn. GIAI ĐOẠN SAU MỔ - NỘI TRÚ: Ngày 26/09/2025 phẫu thuật thay van ĐMC cơ học On-X số 23 (ThS.BS Nguyễn Trọng X), kết quả thành công, van hoạt động tốt, chênh áp giảm còn 8 đến 16 mmHg. Hậu phẫu sớm có phản ứng viêm mạnh (CRP đỉnh 241 mg/L ngày 29/09 rồi giảm), NT-proBNP tăng 2280 pg/mL phù hợp giai đoạn ngay sau mổ tim. Ra viện ngày 03/10/2025 trong tình trạng ổn định, đơn ngoại trú gồm chống đông Vincerol, lợi tiểu, kháng sinh. GIAI ĐOẠN NGOẠI TRÚ - TÁI KHÁM: Tái khám 10/10/2025 (khoảng một tuần sau ra viện) ghi nhận EF giảm còn 44% kèm tràn dịch màng ngoài tim ép nhẹ thất phải - đây là vấn đề cần theo dõi sát nhất. Các lần sau cho thấy cải thiện rõ: hết dịch màng tim, EF hồi phục 58% (28/10) rồi 71% (lần gần nhất 26/05/2026). INR dao động và đã về mục tiêu điều trị van cơ học 2.0 đến 3.0.",
  // Dấu hiệu sinh tồn lúc ra viện (dùng cho sàng lọc ưu tiên: hô hấp, nhiễm khuẩn)
  dau_hieu_sinh_ton: { ngay:"03/10/2025", ha_tt:120, ha_ttr:70, mach:78, nhiet_do:36.8, nhip_tho:18, spo2:97, lactate:1.4 },
}

// ─── CLINICAL ENGINE: tri thức + luật xác định (deterministic) ─────────────────
// Lớp này KHÔNG dùng AI. Code thuần tra bảng và so ngưỡng để đảm bảo chính xác.
// AI (Claude) chỉ diễn giải kết quả mà lớp này bắt được.

// Bản đồ biệt dược Việt -> hoạt chất gốc (fallback khi hồ sơ không ghi trong ngoặc)
// ĐỒNG BỘ với BRAND_TO_GENERIC trong clinical_rules.py — sửa 1 nơi thì sửa cả 2.
const BRAND_TO_GENERIC = {
  "vincerol":"acenocoumarol", "sintrom":"acenocoumarol", "coumadin":"warfarin",
  "medoxasol":"levofloxacin", "tavanic":"levofloxacin", "ciprobay":"ciprofloxacin",
  "forxiga":"dapagliflozin", "jardiance":"empagliflozin",
  "agifuros":"furosemid", "lasix":"furosemid", "takizd":"furosemid",
  "buflan":"cefoperazone", "pantoloc":"pantoprazole", "nexium":"esomeprazole",
  "betaloc":"metoprolol", "concor":"bisoprolol", "lipitor":"atorvastatin",
  "glucophage":"metformin", "aldactone":"spironolactone", "cordarone":"amiodarone",
  "plavix":"clopidogrel", "brilinta":"ticagrelor", "xarelto":"rivaroxaban",
  "eliquis":"apixaban", "pradaxa":"dabigatran", "crestor":"rosuvastatin",
  "diamicron":"gliclazide", "amaryl":"glimepiride", "amlor":"amlodipine",
  "losartas":"losartan", "cozaar":"losartan", "diovan":"valsartan",
  "klacid":"clarithromycin", "zithromax":"azithromycin", "rocephin":"ceftriaxone",
  "lanoxin":"digoxin",
}

// ĐỒNG BỘ với GENERIC_GROUPS trong clinical_rules.py.
const GENERIC_INFO = {
  "acenocoumarol":{ ten:"Acenocoumarol", nhom:["khang_vitamin_k"] },
  "warfarin":{ ten:"Warfarin", nhom:["khang_vitamin_k"] },
  "levofloxacin":{ ten:"Levofloxacin", nhom:["fluoroquinolon"] },
  "ciprofloxacin":{ ten:"Ciprofloxacin", nhom:["fluoroquinolon"] },
  "furosemid":{ ten:"Furosemid", nhom:["loi_tieu_quai"] },
  "dapagliflozin":{ ten:"Dapagliflozin", nhom:["sglt2i"] },
  "empagliflozin":{ ten:"Empagliflozin", nhom:["sglt2i"] },
  "pantoprazole":{ ten:"Pantoprazole", nhom:["ppi"] },
  "esomeprazole":{ ten:"Esomeprazole", nhom:["ppi"] },
  "omeprazole":{ ten:"Omeprazole", nhom:["ppi"] },
  "cefoperazone":{ ten:"Cefoperazone", nhom:["cephalosporin"] },
  "ceftriaxone":{ ten:"Ceftriaxone", nhom:["cephalosporin"] },
  "cefuroxime":{ ten:"Cefuroxime", nhom:["cephalosporin"] },
  "metformin":{ ten:"Metformin", nhom:["biguanid"] },
  "spironolactone":{ ten:"Spironolacton", nhom:["loi_tieu_giu_kali"] },
  "metoprolol":{ ten:"Metoprolol", nhom:["chen_beta"] },
  "bisoprolol":{ ten:"Bisoprolol", nhom:["chen_beta"] },
  "carvedilol":{ ten:"Carvedilol", nhom:["chen_beta"] },
  "atorvastatin":{ ten:"Atorvastatin", nhom:["statin"] },
  "simvastatin":{ ten:"Simvastatin", nhom:["statin"] },
  "rosuvastatin":{ ten:"Rosuvastatin", nhom:["statin"] },
  "amiodarone":{ ten:"Amiodarone", nhom:["chong_loan_nhip"] },
  "clarithromycin":{ ten:"Clarithromycin", nhom:["macrolid"] },
  "azithromycin":{ ten:"Azithromycin", nhom:["macrolid"] },
  "ibuprofen":{ ten:"Ibuprofen", nhom:["nsaid"] },
  "diclofenac":{ ten:"Diclofenac", nhom:["nsaid"] },
  "meloxicam":{ ten:"Meloxicam", nhom:["nsaid"] },
  "celecoxib":{ ten:"Celecoxib", nhom:["nsaid"] },
  "enalapril":{ ten:"Enalapril", nhom:["acei"] },
  "lisinopril":{ ten:"Lisinopril", nhom:["acei"] },
  "captopril":{ ten:"Captopril", nhom:["acei"] },
  "losartan":{ ten:"Losartan", nhom:["arb"] },
  "valsartan":{ ten:"Valsartan", nhom:["arb"] },
  "telmisartan":{ ten:"Telmisartan", nhom:["arb"] },
  "aspirin":{ ten:"Aspirin", nhom:["khang_ket_tap_tieu_cau"] },
  "clopidogrel":{ ten:"Clopidogrel", nhom:["khang_ket_tap_tieu_cau"] },
  "ticagrelor":{ ten:"Ticagrelor", nhom:["khang_ket_tap_tieu_cau"] },
  "rivaroxaban":{ ten:"Rivaroxaban", nhom:["khang_dong_truc_tiep"] },
  "apixaban":{ ten:"Apixaban", nhom:["khang_dong_truc_tiep"] },
  "dabigatran":{ ten:"Dabigatran", nhom:["khang_dong_truc_tiep"] },
  "insulin":{ ten:"Insulin", nhom:["insulin"] },
  "gliclazide":{ ten:"Gliclazide", nhom:["sulfonylurea"] },
  "glimepiride":{ ten:"Glimepiride", nhom:["sulfonylurea"] },
  "amlodipine":{ ten:"Amlodipine", nhom:["chen_kenh_calci"] },
  "nifedipine":{ ten:"Nifedipine", nhom:["chen_kenh_calci"] },
  "digoxin":{ ten:"Digoxin", nhom:["digoxin"] },
}

// ĐỒNG BỘ với INTERACTION_RULES trong clinical_rules.py.
const INTERACTIONS = [
  { a:"khang_vitamin_k", b:"fluoroquinolon", muc:"warning",
    hau_qua:"Fluoroquinolon làm tăng tác dụng chống đông của thuốc kháng vitamin K, có thể đẩy INR lên cao và tăng nguy cơ chảy máu.",
    de_xuat:"Theo dõi INR sát hơn trong và sau đợt kháng sinh, cân nhắc chỉnh liều chống đông.",
    nguon:"Tương tác coumarin-fluoroquinolon (y văn lâm sàng)" },
  { a:"khang_vitamin_k", b:"nsaid", muc:"critical",
    hau_qua:"Tăng mạnh nguy cơ loét và xuất huyết tiêu hóa.",
    de_xuat:"Tránh phối hợp, dùng giảm đau thay thế (paracetamol).",
    nguon:"Tương tác kháng đông-NSAID" },
  { a:"khang_vitamin_k", b:"macrolid", muc:"warning",
    hau_qua:"Ức chế chuyển hóa thuốc chống đông, tăng INR, nguy cơ chảy máu.",
    de_xuat:"Theo dõi INR, cân nhắc kháng sinh nhóm khác.", nguon:"Tương tác coumarin-macrolid" },
  { a:"khang_vitamin_k", b:"chong_loan_nhip", muc:"critical",
    hau_qua:"Amiodarone tăng mạnh tác dụng chống đông, nguy cơ xuất huyết.",
    de_xuat:"Cần giảm liều thuốc chống đông ngay từ đầu, theo dõi INR.",
    nguon:"Tương tác warfarin-amiodarone" },
  { a:"loi_tieu_giu_kali", b:"acei", muc:"warning",
    hau_qua:"Tăng kali máu, nguy cơ rối loạn nhịp.", de_xuat:"Theo dõi kali máu và chức năng thận.",
    nguon:"Tương tác ACEI-lợi tiểu giữ kali" },
  { a:"loi_tieu_giu_kali", b:"arb", muc:"warning",
    hau_qua:"Tăng kali máu, nguy cơ rối loạn nhịp tim (cơ chế tương tự phối hợp với ACEI).",
    de_xuat:"Theo dõi kali máu và chức năng thận định kỳ.", nguon:"Tương tác ARB-lợi tiểu giữ kali" },
  { a:"acei", b:"arb", muc:"warning",
    hau_qua:"Phối hợp 2 thuốc ức chế hệ Renin-Angiotensin cùng lúc không tăng hiệu quả rõ rệt nhưng tăng nguy cơ tăng kali máu và suy thận.",
    de_xuat:"Thường KHÔNG phối hợp ACEI + ARB cùng lúc; xem lại chỉ định.", nguon:"ESC/ESH Tăng huyết áp" },
  { a:"statin", b:"macrolid", muc:"warning",
    hau_qua:"Tăng nồng độ statin, nguy cơ đau cơ và tiêu cơ vân.", de_xuat:"Tạm ngừng statin trong đợt kháng sinh.",
    nguon:"Tương tác statin-macrolid" },
  { a:"chen_beta", b:"chong_loan_nhip", muc:"warning",
    hau_qua:"Cộng gộp ức chế tim, nguy cơ nhịp chậm, block nhĩ thất.", de_xuat:"Theo dõi nhịp tim, ECG.",
    nguon:"Tương tác chẹn beta-chống loạn nhịp" },
  { a:"chen_beta", b:"chen_kenh_calci", muc:"warning",
    hau_qua:"Phối hợp có thể cộng gộp ức chế dẫn truyền nhĩ thất và co cơ tim, nguy cơ nhịp chậm/tụt huyết áp (đặc biệt nhóm non-dihydropyridine).",
    de_xuat:"Theo dõi nhịp tim và huyết áp sát khi mới phối hợp.", nguon:"Tương tác chẹn beta-chẹn kênh calci" },
  { a:"khang_ket_tap_tieu_cau", b:"khang_dong_truc_tiep", muc:"critical",
    hau_qua:"Phối hợp kháng kết tập tiểu cầu với kháng đông trực tiếp (DOAC) làm tăng đáng kể nguy cơ chảy máu.",
    de_xuat:"Chỉ phối hợp khi có chỉ định rõ ràng (vd sau đặt stent + rung nhĩ); xem lại thời gian điều trị kép.",
    nguon:"ESC Hội chứng mạch vành cấp / Rung nhĩ" },
  { a:"khang_vitamin_k", b:"khang_ket_tap_tieu_cau", muc:"critical",
    hau_qua:"Tăng nguy cơ chảy máu khi phối hợp kháng vitamin K với thuốc kháng kết tập tiểu cầu.",
    de_xuat:"Chỉ phối hợp khi có chỉ định rõ ràng, theo dõi sát dấu hiệu chảy máu.",
    nguon:"ESC Rung nhĩ / Hội chứng mạch vành cấp" },
  { a:"digoxin", b:"chong_loan_nhip", muc:"warning",
    hau_qua:"Amiodarone làm tăng nồng độ digoxin trong máu, có thể gây ngộ độc digoxin.",
    de_xuat:"Giảm liều digoxin (thường 30-50%) khi phối hợp với amiodarone, theo dõi nồng độ.",
    nguon:"Tương tác digoxin-amiodarone" },
  { a:"digoxin", b:"loi_tieu_quai", muc:"warning",
    hau_qua:"Lợi tiểu quai gây hạ kali máu, làm tăng nguy cơ ngộ độc digoxin dù nồng độ digoxin không đổi.",
    de_xuat:"Theo dõi kali máu định kỳ khi phối hợp.", nguon:"Tương tác digoxin-lợi tiểu quai" },
]

// ĐỒNG BỘ với RENAL_RULES trong clinical_rules.py.
const RENAL_RULES = [
  { generic:"metformin", egfr_lt:30, muc:"critical",
    note:"Chống chỉ định khi eGFR dưới 30 do nguy cơ nhiễm toan lactic.", nguon:"ADA 2025 / KDIGO" },
  { generic:"dapagliflozin", egfr_lt:25, muc:"warning",
    note:"Không khởi trị khi eGFR dưới 25.", nguon:"ESC / ADA 2025" },
  { generic:"levofloxacin", egfr_lt:50, muc:"warning",
    note:"Cần chỉnh liều khi độ thanh thải creatinin dưới 50 mL/phút.", nguon:"Hướng dẫn kê đơn fluoroquinolon" },
  { generic:"rivaroxaban", egfr_lt:30, muc:"critical",
    note:"Chống chỉ định/cần chỉnh liều khi eGFR dưới 30 — nguy cơ tích lũy thuốc, tăng chảy máu.", nguon:"ESC Rung nhĩ 2025" },
  { generic:"apixaban", egfr_lt:25, muc:"warning",
    note:"Cần chỉnh liều khi eGFR dưới 25-30, theo dõi sát dấu hiệu chảy máu.", nguon:"ESC Rung nhĩ 2025" },
  { generic:"dabigatran", egfr_lt:30, muc:"critical",
    note:"Chống chỉ định khi eGFR dưới 30 — thải trừ chủ yếu qua thận.", nguon:"ESC Rung nhĩ 2025" },
  { generic:"spironolactone", egfr_lt:30, muc:"critical",
    note:"Tăng nguy cơ tăng kali máu nặng khi eGFR dưới 30, cần theo dõi kali sát hoặc tránh dùng.", nguon:"ESC Suy tim 2025 / KDIGO" },
  { generic:"gliclazide", egfr_lt:30, muc:"warning",
    note:"Tăng nguy cơ hạ đường huyết khi chức năng thận giảm nặng, cần chỉnh liều.", nguon:"ADA 2025" },
]

// Thuốc phù hợp guideline trong bối cảnh cụ thể (gắn nhãn xanh, không cảnh báo)
const FAVORABLE = [
  { generic:"dapagliflozin", dieu_kien:(ctx)=>ctx.suy_tim,
    note:"SGLT2i được ESC khuyến cáo cho bệnh nhân suy tim, cải thiện tiên lượng.", nguon:"ESC suy tim 2025",
    caution_if:(ctx)=>ctx.ha_natri,
    caution_note:"Bệnh nhân đang hạ natri máu: SGLT2i có thể gây lợi niệu thẩm thấu làm rối loạn điện giải nặng hơn. Theo dõi sát natri máu khi dùng." },
]

// CKD-EPI 2021 (không dùng yếu tố chủng tộc). creat đơn vị µmol/L.
function computeEGFR(creatUmol, age, sexMale) {
  if (!creatUmol || !age) return null
  const scr = creatUmol / 88.4  // mg/dL
  const k = sexMale ? 0.9 : 0.7
  const alpha = sexMale ? -0.302 : -0.241
  let egfr = 142 * Math.pow(Math.min(scr/k, 1), alpha) * Math.pow(Math.max(scr/k, 1), -1.200) * Math.pow(0.9938, age)
  if (!sexMale) egfr *= 1.012
  return Math.round(egfr)
}

// Trả về chi tiết công thức + đầu vào để hiển thị minh bạch
function buildEgfrDetail(creatUmol, age, sexMale) {
  if (!creatUmol || !age) {
    return { value:null, ten_cong_thuc:"CKD-EPI 2021 (race-free)", thieu:"Thiếu Creatinin hoặc tuổi để tính eGFR.",
      creatinine_umol:creatUmol??null, age:age??null, sex:sexMale?"Nam":"Nữ" }
  }
  const scrMgdl = creatUmol / 88.4
  const k = sexMale ? 0.9 : 0.7
  const alpha = sexMale ? -0.302 : -0.241
  const value = computeEGFR(creatUmol, age, sexMale)
  return {
    value,
    ten_cong_thuc:"CKD-EPI 2021 (race-free)",
    formula:`eGFR = 142 × min(Scr/k, 1)^a × max(Scr/k, 1)^-1.200 × 0.9938^Tuổi${sexMale?"":" × 1.012 (nữ)"}`,
    creatinine_umol:Math.round(creatUmol*10)/10,
    creatinine_mgdl:Math.round(scrMgdl*100)/100,
    age, sex:sexMale?"Nam":"Nữ", k, alpha,
    dien_giai:`Scr ${Math.round(scrMgdl*100)/100} mg/dL (${Math.round(creatUmol*10)/10} µmol/L), tuổi ${age}, giới ${sexMale?"Nam":"Nữ"} (k=${k}, a=${alpha}) → eGFR ${value}`,
  }
}

// Chuẩn hóa danh sách thuốc -> hoạt chất gốc + nhóm
function resolveGenerics(meds) {
  return (meds || []).map(m => {
    const paren = (m.ten_thuoc.match(/\(([^)]+)\)/) || [])[1]
    let generic = null
    if (paren) {
      const first = paren.split(/[+/,]/)[0].trim().toLowerCase()
      generic = Object.keys(GENERIC_INFO).find(g => first.includes(g) || g.includes(first)) || null
    }
    if (!generic) {
      const brand = m.ten_thuoc.split(/\d/)[0].trim().toLowerCase()
      generic = BRAND_TO_GENERIC[brand] || null
    }
    const info = generic ? GENERIC_INFO[generic] : null
    return { ...m, generic, ten_goc: info?.ten || paren || m.ten_thuoc, nhom_duoc: info?.nhom || [] }
  })
}

// Kiểm tra an toàn đơn thuốc: tương tác + chỉnh liều thận + thuốc phù hợp + trùng nhóm
function checkDrugSafety(meds, egfr, ctx) {
  const resolved = resolveGenerics(meds)
  const interactions = []
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const A = resolved[i], B = resolved[j]
      for (const rule of INTERACTIONS) {
        const hit = (A.nhom_duoc.includes(rule.a) && B.nhom_duoc.includes(rule.b)) ||
                    (A.nhom_duoc.includes(rule.b) && B.nhom_duoc.includes(rule.a))
        if (hit) interactions.push({ thuoc_a:A.ten_goc, thuoc_b:B.ten_goc, ...rule })
      }
    }
  }
  const renalFlags = []
  if (egfr != null) {
    for (const m of resolved) {
      const rule = RENAL_RULES.find(rr => rr.generic === m.generic && egfr < rr.egfr_lt)
      if (rule) renalFlags.push({ thuoc:m.ten_goc, egfr, ...rule })
    }
  }
  const favorable = []
  for (const m of resolved) {
    const fav = FAVORABLE.find(f => f.generic === m.generic && f.dieu_kien(ctx))
    if (fav) {
      const entry = { thuoc:m.ten_goc, ...fav }
      if (fav.caution_if && fav.caution_if(ctx)) entry.than_trong = fav.caution_note
      favorable.push(entry)
    }
  }
  // Trùng nhóm thuốc — ĐỒNG BỘ với logic trong check_drug_safety() (clinical_rules.py)
  const duplicateGroups = []
  const seenPairs = new Set()
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const A = resolved[i], B = resolved[j]
      if (!A.generic || !B.generic || A.generic === B.generic) continue
      const common = A.nhom_duoc.filter(g => B.nhom_duoc.includes(g))
      for (const grp of common) {
        const pairKey = [A.generic, B.generic].sort().join("|") + "|" + grp
        if (seenPairs.has(pairKey)) continue
        seenPairs.add(pairKey)
        duplicateGroups.push({
          nhom: grp, thuoc_a: A.generic, thuoc_b: B.generic,
          ghi_chu: `Hai thuốc khác hoạt chất nhưng cùng nhóm dược lý (${grp}) — kiểm tra có cần dùng đồng thời hay là sai sót quên ngừng thuốc cũ.`,
        })
      }
    }
  }
  return { resolved, interactions, renalFlags, favorable, duplicateGroups }
}

// ─── Thang điểm nguy cơ (CHA2DS2-VASc + HAS-BLED) — bản JS CHỈ DÙNG CHO DEMO
// OFFLINE (MOCK_REPORT, khi analysis=null vì không gọi backend). Đây là bản
// PORT TRỰC TIẾP từ compute_cha2ds2_vasc()/compute_has_bled() trong
// clinical_rules.py — giữ đúng công thức, ngưỡng, cấu trúc trả về để tương
// thích với RiskScoresCard. KHÔNG dùng hàm này khi có backend: ReportPage chỉ
// gọi nó trong nhánh "else" (analysis null), mọi hồ sơ phân tích qua backend
// thật vẫn lấy risk_scores từ analysis — giữ đúng 1 nguồn sự thật khi có thể.
// Nếu sửa ngưỡng/từ khóa ở clinical_rules.py, PHẢI soát lại bản JS này theo.
const CRS_CV_KEYWORDS = {
  suy_tim: ["suy tim","ef giam","phan suat tong mau giam","rlcn tam thu"],
  tang_huyet_ap: ["tang huyet ap","tha","cao huyet ap"],
  dtd: ["dai thao duong","dtd","hba1c"],
  // LƯU Ý: đã bỏ "huyet khoi"/"thuyen tac" — quá rộng, thường khớp nhầm câu
  // CẢNH BÁO NGUY CƠ (vd "nguy cơ huyết khối van do INR thấp") không phải
  // biến cố tiền sử thật. Đồng bộ với clinical_rules.py CV_KEYWORDS.
  dot_quy: ["dot quy","tai bien mach mau nao","nhoi mau nao","tia ","thieu mau nao cuc bo"],
  // Bổ sung sau khi phát hiện bỏ sót thật với PATIENT_B ("Bệnh mạch vành đã
  // đặt 2 stent ĐMV" không khớp bộ cũ). Đồng bộ với clinical_rules.py.
  benh_mach_mau: ["nhoi mau co tim","nmct","benh dong mach ngoai bien","hep dong mach canh","mang xo vua dmc","xo vua dong mach","benh mach mau","benh mach vanh","dat stent","stent dmv","stent mach vanh","can thiep mach vanh","dat gia do mach vanh","bac cau mach vanh","cabg","pci"],
}
const CRS_HB_KEYWORDS = {
  benh_gan: ["xo gan","viem gan","suy gan","benh gan man"],
  // LƯU Ý: đã bỏ "chay mau" đơn lẻ — quá rộng, khớp nhầm câu cảnh báo nguy
  // cơ dự phòng. Đồng bộ với clinical_rules.py HB_KEYWORDS["tien_su_chay_mau"].
  chay_mau: ["xuat huyet","tien su chay mau","loet da day xuat huyet"],
  thuoc_chay_mau: ["nsaid","aspirin","khang ket tap tieu cau","ibuprofen","diclofenac"],
  ruou: ["nghien ruou","uong ruou nhieu","lam dung ruou","ruou bia"],
}
// Cụm phủ định + cửa sổ ký tự — ĐỒNG BỘ với NEGATION_PHRASES/NEGATION_WINDOW_CHARS
// trong clinical_rules.py. Sửa 1 nơi thì PHẢI sửa nơi kia theo.
const CRS_NEGATION_PHRASES = ["khong ghi nhan","khong co","khong bi","chua tung","chua co","khong phat hien","phu nhan","loai tru"]
const CRS_NEGATION_WINDOW = 35
function crsHasAnyPositive(haystack, keywords) {
  for (const kw of keywords) {
    let start = 0
    while (true) {
      const idx = haystack.indexOf(kw, start)
      if (idx === -1) break
      const windowStart = Math.max(0, idx - CRS_NEGATION_WINDOW)
      const window = haystack.slice(windowStart, idx)
      if (!CRS_NEGATION_PHRASES.some(neg => window.includes(neg))) return true
      start = idx + kw.length
    }
  }
  return false
}
function crsStripAccents(s) {
  if (!s) return ""
  return s.replace(/Đ/g,"D").replace(/đ/g,"d")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
}
function crsHasAny(haystack, words) { return words.some(w => haystack.includes(w)) }
function crsGatherText(report) {
  const parts = [report.chan_doan_chinh || "", report.tien_su_benh || ""]
  for (const c of (report.canh_bao_nguy_co || [])) { parts.push(c.mo_ta || ""); parts.push(c.can_cu || "") }
  return crsStripAccents(parts.join(" "))
}
function crsIsMechanicalValve(report) {
  const txt = crsGatherText(report)
  const pt = crsStripAccents((report.phau_thuat || {}).phuong_phap || "")
  const combined = txt + " " + pt
  return ["van co hoc","on-x","on x","st jude","thay van"].some(m => combined.includes(m))
}
function computeCha2ds2VascClient(report) {
  const info = report.thong_tin_benh_nhan || {}
  const tuoi = info.tuoi
  const gioiStripped = crsStripAccents(info.gioi_tinh || "")
  const gioiTinhNu = !gioiStripped.includes("nam") && gioiStripped.includes("nu")
  const txt = crsGatherText(report)
  const items = []
  let total = 0
  const item = (ten, diem, co, ghiChu) => { if (co) total += diem; items.push({ten, diem_neu_co:diem, co, ghi_chu:ghiChu}) }

  item("C - Suy tim / rối loạn chức năng thất trái", 1, crsHasAnyPositive(txt, CRS_CV_KEYWORDS.suy_tim), "Dò từ khóa suy tim/EF giảm trong chẩn đoán-tiền sử")
  item("H - Tăng huyết áp", 1, crsHasAnyPositive(txt, CRS_CV_KEYWORDS.tang_huyet_ap), "Dò từ khóa tăng huyết áp/THA")
  if (tuoi != null) {
    if (tuoi >= 75) item("A2 - Tuổi ≥ 75", 2, true, `Tuổi ${tuoi}`)
    else if (tuoi >= 65) item("A - Tuổi 65-74", 1, true, `Tuổi ${tuoi}`)
    else item("A/A2 - Nhóm tuổi nguy cơ (65-74 hoặc ≥75)", 0, false, `Tuổi ${tuoi} (dưới 65)`)
  } else item("A/A2 - Nhóm tuổi nguy cơ (65-74 hoặc ≥75)", 0, false, "Không xác định: thiếu tuổi")
  item("D - Đái tháo đường", 1, crsHasAnyPositive(txt, CRS_CV_KEYWORDS.dtd), "Dò từ khóa đái tháo đường/ĐTĐ/HbA1C")
  item("S2 - Tiền sử đột quỵ/TIA/thuyên tắc", 2, crsHasAnyPositive(txt, CRS_CV_KEYWORDS.dot_quy), "Dò từ khóa đột quỵ/TIA/thuyên tắc/huyết khối")
  item("V - Bệnh mạch máu (NMCT cũ, bệnh ĐM ngoại biên, mảng xơ vữa ĐMC)", 1, crsHasAnyPositive(txt, CRS_CV_KEYWORDS.benh_mach_mau), "Dò từ khóa NMCT/bệnh động mạch ngoại biên/xơ vữa ĐMC")
  if (info.gioi_tinh) item("Sc - Giới nữ", 1, gioiTinhNu, `Giới tính ghi nhận: ${info.gioi_tinh}`)
  else item("Sc - Giới nữ", 0, false, "Không xác định: thiếu giới tính")

  const mechanicalValve = crsIsMechanicalValve(report)
  return {
    ten_thang_diem: "CHA2DS2-VASc", tong_diem: total, thang_diem_toi_da: 9, chi_tiet: items,
    nguon_guideline: "ESC/AHA Atrial Fibrillation Guideline",
    canh_bao_boi_canh: mechanicalValve
      ? "Bệnh nhân có VAN CƠ HỌC: CHA2DS2-VASc được xây dựng cho rung nhĩ KHÔNG do van — với van cơ học, chỉ định chống đông (warfarin/kháng vitamin K) là BẮT BUỘC bất kể điểm số này. Điểm số ở đây chỉ mang tính minh họa thêm bối cảnh nguy cơ tổng quát, KHÔNG dùng để quyết định có chống đông hay không."
      : "Thang điểm áp dụng cho rung nhĩ không do bệnh van tim. Cần bác sĩ xác nhận trước khi dùng để ra quyết định chống đông.",
    mechanical_valve: mechanicalValve, nhan: "Hỗ trợ quyết định — cần bác sĩ xác nhận",
  }
}
function computeHasBledClient(report, egfr, inrTrend) {
  const info = report.thong_tin_benh_nhan || {}
  const tuoi = info.tuoi
  const txt = crsGatherText(report)
  const v = report.dau_hieu_sinh_ton || {}
  const sbp = v.ha_tt
  const items = []
  let total = 0
  const item = (ten, diem, co, ghiChu) => { if (co) total += diem; items.push({ten, diem_neu_co:diem, co, ghi_chu:ghiChu}) }

  if (sbp != null) item("H - Tăng huyết áp không kiểm soát (HATT > 160)", 1, sbp > 160, `Huyết áp tâm thu ghi nhận gần nhất: ${sbp} mmHg`)
  else item("H - Tăng huyết áp không kiểm soát (HATT > 160)", 0, false, "Không xác định: thiếu huyết áp tâm thu")

  if (egfr != null) item("A - Bất thường chức năng thận (eGFR < 60)", 1, egfr < 60, `eGFR ${egfr} mL/phút/1.73m2 (CKD-EPI 2021)`)
  else item("A - Bất thường chức năng thận (eGFR < 60)", 0, false, "Không xác định: thiếu eGFR (cần Creatinin + tuổi + giới)")

  item("A - Bất thường chức năng gan", 1, crsHasAnyPositive(txt, CRS_HB_KEYWORDS.benh_gan), "Dò từ khóa xơ gan/viêm gan/suy gan trong chẩn đoán-tiền sử")
  item("S - Tiền sử đột quỵ", 1, crsHasAnyPositive(txt, CRS_CV_KEYWORDS.dot_quy), "Dò từ khóa đột quỵ/tai biến mạch máu não")
  item("B - Tiền sử/cơ địa chảy máu", 1, crsHasAnyPositive(txt, CRS_HB_KEYWORDS.chay_mau), "Dò từ khóa xuất huyết/chảy máu trong tiền sử")

  let labile = false, labileNote = "Không xác định: chưa đủ dữ liệu INR (cần ≥ 3 lần đo)"
  if (inrTrend && inrTrend.length >= 3) {
    const lo = Math.min(...inrTrend), hi = Math.max(...inrTrend)
    labile = (hi - lo) >= 1.5
    labileNote = `Dải INR ghi nhận: ${lo} đến ${hi} (chênh ${Math.round((hi-lo)*100)/100})`
  }
  item("L - INR dao động (labile / TTR thấp)", 1, labile, labileNote)

  if (tuoi != null) item("E - Tuổi > 65", 1, tuoi > 65, `Tuổi ${tuoi}`)
  else item("E - Tuổi > 65", 0, false, "Không xác định: thiếu tuổi")

  let thuocNguyCo = false
  for (const d of (report.thuoc_cuoi_ky || [])) {
    const name = crsStripAccents(d.ten_thuoc || "")
    if (crsHasAny(name, CRS_HB_KEYWORDS.thuoc_chay_mau)) { thuocNguyCo = true; break }
  }
  item("D - Thuốc tăng nguy cơ chảy máu (kháng tiểu cầu/NSAID)", 1, thuocNguyCo, "Dò trong danh sách thuốc hiện dùng")
  item("D - Lạm dụng rượu", 1, crsHasAnyPositive(txt, CRS_HB_KEYWORDS.ruou), "Dò từ khóa lạm dụng rượu trong tiền sử")

  return {
    ten_thang_diem: "HAS-BLED", tong_diem: total, thang_diem_toi_da: 9, chi_tiet: items,
    nguon_guideline: "ESC Guideline on Atrial Fibrillation (HAS-BLED)",
    muc_nguy_co: total >= 3 ? "cao" : "thap_trung_binh",
    dien_giai_muc_nguy_co: total >= 3
      ? "Điểm ≥ 3: nguy cơ chảy máu cao — cần theo dõi sát hơn khi dùng chống đông, KHÔNG đồng nghĩa với việc ngừng chống đông (vẫn cần cân nhắc lợi ích/nguy cơ)."
      : "Điểm dưới 3: nguy cơ chảy máu thấp đến trung bình theo thang điểm này.",
    nhan: "Hỗ trợ quyết định — cần bác sĩ xác nhận",
  }
}
function computeRiskScoresClient(report) {
  const labs = report.xet_nghiem_meta || report.xet_nghiem_key || []
  const creat = labs.find(l => l.key === "Creatinin")
  const egfr = computeEGFR(creat?.rawVal, report.thong_tin_benh_nhan?.tuoi, /nam/i.test(report.thong_tin_benh_nhan?.gioi_tinh || ""))
  const inrLab = labs.find(l => (l.key || "").trim().toUpperCase() === "INR")
  const inrTrend = inrLab?.trend
  return {
    cha2ds2_vasc: computeCha2ds2VascClient(report),
    has_bled: computeHasBledClient(report, egfr, inrTrend),
  }
}

// Sàng lọc ưu tiên: so ngưỡng vital + lab, trả về findings 3 mức
function runPriorityScreens(report) {
  const v = report.dau_hieu_sinh_ton || {}
  const labs = report.xet_nghiem_key || report.xet_nghiem_meta || []
  const labOf = (key) => labs.find(l => l.key === key)
  const dx = (report.chan_doan_chinh || "") + " " + (report.tien_su_benh || "")
  const naForCtx = labOf("Na+")?.rawVal
  const phaseInfo = computePhaseInfo(report)
  const ctx = {
    suy_tim: /suy tim|ST\b|proBNP/i.test(dx) || (labOf("NT-proBNP")?.rawVal > 900),
    ha_natri: (naForCtx != null && naForCtx < 135),
    current_phase: phaseInfo.currentPhase,
  }
  const F = []
  const add = (muc, ten, ly_do, nguon) => F.push({ muc, ten, ly_do, nguon })

  // Hô hấp (ESC): SpO2, nhịp thở
  if (v.spo2 != null && v.spo2 < 92) add("critical","Suy hô hấp", `SpO2 ${v.spo2}% (dưới 92%)`, "ESC")
  else if (v.nhip_tho >= 25) add("warning","Theo dõi hô hấp", `Nhịp thở ${v.nhip_tho} lần/phút`, "ESC")
  else if (v.spo2 != null) add("stable","Hô hấp ổn định", `SpO2 ${v.spo2}%, nhịp thở ${v.nhip_tho} lần/phút`, "ESC")

  // Nhiễm khuẩn huyết (qSOFA rút gọn): HA tâm thu, nhịp thở, lactate, nhiệt độ
  let qsofa = 0
  if (v.ha_tt != null && v.ha_tt <= 100) qsofa++
  if (v.nhip_tho >= 22) qsofa++
  const sepsisSigns = []
  if (v.nhiet_do >= 38) sepsisSigns.push(`sốt ${v.nhiet_do} độ`)
  if (v.lactate >= 2) sepsisSigns.push(`lactate ${v.lactate} mmol/L`)
  if (qsofa >= 2 || sepsisSigns.length >= 2) add("critical","Nghi ngờ nhiễm khuẩn huyết", `qSOFA ${qsofa}, ${sepsisSigns.join(", ")||"dấu hiệu sinh tồn bất thường"}`, "Sepsis 2026 / KDIGO")
  else add("stable","Không dấu hiệu nhiễm khuẩn huyết cấp", `Huyết áp ${v.ha_tt}/${v.ha_ttr}, lactate ${v.lactate} mmol/L, nhiệt độ ${v.nhiet_do} độ`, "Sepsis 2026")

  // Suy thận (KDIGO): eGFR
  const creat = labOf("Creatinin")?.rawVal
  const egfr = computeEGFR(creat, report.thong_tin_benh_nhan?.tuoi, /nam/i.test(report.thong_tin_benh_nhan?.gioi_tinh))
  if (egfr != null) {
    if (egfr < 30) add("critical","Suy thận nặng", `eGFR ${egfr} mL/phút/1.73m2 (dưới 30)`, "KDIGO 2026")
    else if (egfr < 45) add("warning","Suy giảm chức năng thận", `eGFR ${egfr} mL/phút/1.73m2`, "KDIGO 2026")
    else add("stable","Chức năng thận bình thường", `eGFR ${egfr} mL/phút/1.73m2, creatinin ${creat} µmol/L`, "KDIGO 2026")
  }

  // Kali máu (KDIGO tăng kali)
  const k = labOf("K+")?.rawVal
  if (k != null) {
    if (k > 6.0) add("critical","Tăng kali máu nặng", `Kali ${k} mmol/L (trên 6.0)`, "KDIGO tăng kali")
    else if (k > 5.5) add("warning","Tăng kali máu", `Kali ${k} mmol/L (trên 5.5)`, "KDIGO tăng kali")
    else add("stable","Kali máu trong giới hạn", `Kali ${k} mmol/L`, "KDIGO")
  }

  // Natri máu
  const na = labOf("Na+")?.rawVal
  if (na != null) {
    if (na < 125) add("critical","Hạ natri máu nặng", `Na ${na} mmol/L (dưới 125)`, "Điện giải đồ")
    else if (na < 135) add("warning","Hạ natri máu", `Na ${na} mmol/L (dưới 135)`, "Điện giải đồ")
  }

  // Suy tim (NT-proBNP) - diễn giải theo GIAI ĐOẠN ĐO (không phải phase hiện tại)
  const bnpLab = labOf("NT-proBNP")
  const bnp = bnpLab?.rawVal
  const cphase = phaseInfo.currentPhase
  let bnpPhase = bnpLab?.ngay ? phaseOf(bnpLab.ngay, phaseInfo) : null
  if (bnpPhase == null) bnpPhase = cphase
  if (bnp != null && bnp > 900) {
    if (bnpPhase === 1 || bnpPhase === 2) {
      const extra = cphase === 3 ? " Bệnh nhân hiện ở giai đoạn ngoại trú nhưng chưa có NT-proBNP đo lại sau xuất viện để đánh giá suy tim hiện tại." : ""
      add("warning","NT-proBNP đo ở giai đoạn hậu phẫu", `NT-proBNP ${bnp} pg/mL đo ở giai đoạn hậu phẫu. Tăng NT-proBNP ngay sau mổ tim lớn là phổ biến, có thể không phản ánh suy tim mạn, cần đối chiếu lâm sàng.${extra}`, "ESC suy tim 2025")
    }
    else if (bnpPhase === 3) add(bnp > 2000 && ctx.suy_tim ? "critical" : "warning","NT-proBNP vẫn tăng ở giai đoạn ngoại trú", `NT-proBNP ${bnp} pg/mL đo ở giai đoạn ngoại trú, gợi ý nguy cơ suy giảm chức năng tim, cần đối chiếu lâm sàng.`, "ESC suy tim 2025")
    else add("warning","Marker suy tim tăng", `NT-proBNP ${bnp} pg/mL`, "ESC suy tim 2025")
  }

  // Viêm nhiễm (CRP)
  const crp = labOf("CRP")?.rawVal
  if (crp != null && crp > 100) add("warning","Phản ứng viêm cao", `CRP ${crp} mg/L`, "Xét nghiệm")
  else if (crp != null && crp > 10) add("warning","Phản ứng viêm còn cao", `CRP ${crp} mg/L (chưa về dưới 5)`, "Xét nghiệm")

  // Tổng hợp bệnh cảnh phối hợp (không đánh giá lẻ)
  const picture = []
  if (na != null && na < 135) picture.push("hạ natri máu")
  if (egfr != null && egfr < 60) picture.push("suy giảm chức năng thận")
  if (k != null && k > 5.5) picture.push("tăng kali máu")
  if (bnp != null && bnp > 900 && ctx.suy_tim) picture.push("gánh nặng suy tim (NT-proBNP tăng)")
  if (crp != null && crp > 50) picture.push("phản ứng viêm mạnh")
  if (picture.length >= 2) {
    const phaseLbl = { 1:"trước can thiệp", 2:"hậu phẫu nội trú", 3:"theo dõi ngoại trú" }[cphase] || ""
    add(picture.length >= 3 ? "critical" : "warning", "Bệnh cảnh lâm sàng phối hợp",
      `Cùng thời điểm (${phaseLbl}) ghi nhận: ${picture.join(", ")}. Cần xử trí theo bệnh cảnh tổng thể thay vì từng chỉ số riêng lẻ, đối chiếu lâm sàng.`, "Tổng hợp đa chỉ số")
  }

  return { findings: F, egfr, ctx }
}

const TIER_META = {
  critical: { label:"Xử lý", full:"Cần xử lý ngay", color:"#DC2626", bg:"#FEF2F2", border:"#FECACA", dot:"🔴", icon:"critical" },
  warning:  { label:"Theo dõi", full:"Cần theo dõi sát", color:"#D97706", bg:"#FFFBEB", border:"#FDE68A", dot:"🟡", icon:"warning" },
  stable:   { label:"Ổn định", full:"Ổn định", color:"#059669", bg:"#F0FDF4", border:"#BBF7D0", dot:"🟢", icon:"stable" },
}
const TIER_ORDER = { critical:0, warning:1, stable:2 }

// Nhận xét xu hướng từng chỉ số xét nghiệm dựa trên chuỗi giá trị theo thời gian
function labVerdict(m) {
  const t = m.trend
  if (!t || t.length < 2) return null
  const delta = t[t.length - 1] - t[0]
  const down = delta < 0, up = delta > 0
  const V = {
    CRP:        () => down ? { txt:"Nhiễm trùng đang cải thiện", good:true } : { txt:"Phản ứng viêm tăng", good:false },
    WBC:        () => down ? { txt:"Đáp ứng viêm đang giảm", good:true } : { txt:"Bạch cầu tăng", good:false },
    "NT-proBNP":() => ({ txt:"Đo hậu phẫu ngày 3 (29/09), chưa có giá trị ngoại trú để kết luận suy tim", neutral:true }),
    EF:         () => up ? { txt:"Chức năng tim đang hồi phục", good:true } : { txt:"Chức năng tim giảm", good:false },
    HGB:        () => down ? { txt:"Thiếu máu, cần theo dõi", good:false } : { txt:"Cải thiện", good:true },
    "Na+":      () => up ? { txt:"Natri đang về bình thường", good:true } : { txt:"Hạ natri", good:false },
    Albumin:    () => up ? { txt:"Dinh dưỡng cải thiện", good:true } : { txt:"Albumin thấp", good:false },
    INR:        () => { const last = t[t.length-1]; return last < 2 ? { txt:"Dưới mục tiêu, nguy cơ huyết khối van", good:false } : last > 3 ? { txt:"Trên mục tiêu, nguy cơ chảy máu", good:false } : { txt:"Trong mục tiêu điều trị (van cơ học 2.0-3.0)", good:true } },
  }
  return V[m.key] ? V[m.key]() : null
}

// ─── DÒNG THỜI GIAN & PHÂN GIAI ĐOẠN ──────────────────────────────────────────
function parseVNDate(s) {
  if (!s) return null
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  return new Date(+m[3], +m[2]-1, +m[1])
}
function daysBetween(a, b) {
  if (!a || !b) return null
  return Math.round((b - a) / 86400000)
}
// Phân loại bệnh nhân + tính mốc tương đối. "Hiện tại" = ngày SA/XN gần nhất trong hồ sơ.
function computePhaseInfo(report) {
  const surg = parseVNDate(report.phau_thuat?.ngay)
  const admit = parseVNDate(report.thong_tin_benh_nhan?.ngay_vao_vien)
  const discharge = parseVNDate(report.thong_tin_benh_nhan?.ngay_ra_vien)
  const echoDates = (report.sieu_am_tim?.lan_kham || []).map(s => parseVNDate(s.ngay)).filter(Boolean)
  const labDates = (report.xet_nghiem_key || []).map(l => parseVNDate(l.ngay)).filter(Boolean)
  const allDates = [...echoDates, ...labDates]
  const current = allDates.length ? new Date(Math.max(...allDates.map(d=>d.getTime()))) : (discharge || surg)
  const isOutpatient = !!discharge && current && current >= discharge
  const currentPhase = isOutpatient ? 3 : (surg && current && current >= surg ? 2 : 1)
  const fmtRel = (n) => {
    if (n == null || n < 0) return ""
    if (n < 31) return `ngày thứ ${n}`
    const months = Math.floor(n / 30)
    return `tháng thứ ${months} (khoảng ${n} ngày)`
  }
  return {
    surg, admit, discharge, current, isOutpatient, currentPhase,
    daysPostOp: daysBetween(surg, current),
    daysPostDischarge: daysBetween(discharge, current),
    relPostOp: fmtRel(daysBetween(surg, current)),
    relPostDischarge: fmtRel(daysBetween(discharge, current)),
  }
}
function phaseOf(dateStr, info) {
  const d = parseVNDate(dateStr)
  if (!d || !info.surg) return null
  if (d < info.surg) return 1
  if (info.discharge && d > info.discharge) return 3
  return 2
}
const PHASE_NAMES = { 1:"Trước phẫu thuật", 2:"Sau mổ - Nội trú", 3:"Ngoại trú - Tái khám" }

// Đánh giá tiến triển tổng thể: bệnh nhân đang tốt lên hay xấu đi
function assessTrajectory(report) {
  const labs = report.xet_nghiem_key || report.xet_nghiem_meta || []
  const lab = (k) => labs.find(l => l.key === k)
  const ev = []
  let score = 0
  const push = (good, txt) => { ev.push({ good, txt }); score += good ? 1 : -1 }

  const crp = lab("CRP")
  if (crp?.trend?.length > 1) {
    const d = crp.trend[crp.trend.length-1] - crp.trend[0]
    if (d < 0) push(true, `CRP giảm từ ${crp.trend[0]} xuống ${crp.trend[crp.trend.length-1]} mg/L: nhiễm trùng đang cải thiện`)
    else push(false, `CRP tăng: phản ứng viêm đang xấu đi`)
  }
  const wbc = lab("WBC")
  if (wbc?.trend?.length > 1) {
    const d = wbc.trend[wbc.trend.length-1] - wbc.trend[0]
    if (d < 0) push(true, `Bạch cầu giảm từ ${wbc.trend[0]} về ${wbc.trend[wbc.trend.length-1]} G/L: đáp ứng viêm thuyên giảm`)
  }
  // EF: ưu tiên từ xét nghiệm; nếu không có thì lấy từ các lượt siêu âm (dữ liệu thật)
  let efFirst = null, efLast = null
  const efLab = lab("EF")
  if (efLab?.trend?.length > 1) { efFirst = efLab.trend[0]; efLast = efLab.trend[efLab.trend.length-1] }
  else {
    const echo = (report.sieu_am_tim?.lan_kham || []).filter(s => s.ef != null)
    if (echo.length > 1) { efFirst = echo[0].ef; efLast = echo[echo.length-1].ef }
  }
  if (efFirst != null && efLast != null) {
    if (efLast > efFirst) push(true, `EF hồi phục từ ${efFirst}% lên ${efLast}%: chức năng tim đang tốt lên`)
    else if (efLast < efFirst) push(false, `EF giảm từ ${efFirst}% còn ${efLast}%: chức năng tim đi xuống`)
  }
  const bnp = lab("NT-proBNP")
  if (bnp?.rawVal > 2000) ev.push({ good:false, txt:`NT-proBNP ${bnp.rawVal} pg/mL còn cao: cần tiếp tục theo dõi suy tim` })
  const na = lab("Na+")
  if (na?.rawVal != null && na.rawVal < 135) ev.push({ good:false, txt:`Natri ${na.rawVal} mmol/L vẫn dưới ngưỡng: theo dõi điện giải` })

  // Phân loại: chủ yếu dựa trên các chỉ số có xu hướng rõ (viêm, tim).
  // proBNP cao và hạ Na chỉ là lưu ý theo dõi, không kéo tụt đánh giá khi đang hồi phục.
  const verdict = score >= 2 ? "tot" : score >= 1 ? "on_dinh" : score <= -1 ? "xau" : "on_dinh"
  return { verdict, evidence: ev, score }
}

const TRAJECTORY_META = {
  tot:      { label:"Đang đáp ứng điều trị tốt", color:"#059669", bg:"linear-gradient(120deg,#ECFDF5,#F0FDFA)", border:"#A7F3D0", icon:"up" },
  on_dinh:  { label:"Tiến triển ổn định", color:"#1D6FE8", bg:"linear-gradient(120deg,#EFF6FF,#F0F9FF)", border:"#BFDBFE", icon:"flat" },
  xau:      { label:"Có dấu hiệu xấu đi, cần chú ý", color:"#DC2626", bg:"linear-gradient(120deg,#FEF2F2,#FFF1F2)", border:"#FECACA", icon:"down" },
}

// Sinh chip nhắc nhanh động từ hồ sơ (van cơ học, chống đông, chỉ số cao, hậu phẫu)
function buildChips(report) {
  const chips = []
  const dx = `${report.chan_doan_chinh || ""} ${report.phau_thuat?.phuong_phap || ""}`
  // Van cơ học
  const valve = dx.match(/(On-X|Saint Jude|St\.? Jude|cơ học)/i)
  if (/van.*(cơ học|On-X|Saint Jude)/i.test(dx) || /(On-X|Saint Jude)/i.test(dx)) {
    const model = (dx.match(/On-X|Saint Jude|St\.? Jude/i) || [])[0]
    chips.push({ label: model ? `Van cơ học ${model}` : "Van cơ học", cls:"warn" })
  }
  // Chống đông
  const ac = (report.thuoc_cuoi_ky || []).find(m => /chống đông|acenocoumarol|warfarin|coumarin/i.test(`${m.nhom} ${m.ten_thuoc}`))
  if (ac) {
    const name = (ac.ten_thuoc.split(/\d/)[0] || "").trim()
    chips.push({ label:`Chống đông ${name}`, cls:"warn" })
  }
  // Chỉ số cao đáng chú ý
  const labs = report.xet_nghiem_key || report.xet_nghiem_meta || []
  const bnp = labs.find(l => l.key === "NT-proBNP")
  if (bnp && bnp.status === "high") chips.push({ label:"NT-proBNP cao", cls:"warn" })
  const na = labs.find(l => l.key === "Na+")
  if (na && na.status === "low") chips.push({ label:"Hạ Na+", cls:"med" })
  const crp = labs.find(l => l.key === "CRP")
  if (crp && crp.status === "high" && chips.length < 4) chips.push({ label:"CRP còn cao", cls:"med" })
  return chips.length ? chips : [{ label: report.chan_doan_chinh ? report.chan_doan_chinh.slice(0,40) : "Hồ sơ bệnh nhân", cls:"info" }]
}


// ─── PRINT ────────────────────────────────────────────────────────────────────
function mpCards(collapsed){ if(typeof window!=="undefined") window.dispatchEvent(new CustomEvent("mp-cards",{detail:{collapsed}})) }
function useGlobalCollapse(initial){
  const [c, setC] = useState(initial)
  useEffect(() => {
    const h = (e) => setC(!!(e.detail && e.detail.collapsed))
    window.addEventListener("mp-cards", h)
    return () => window.removeEventListener("mp-cards", h)
  }, [])
  return [c, setC]
}
function reportToText(r){
  if(!r) return ""
  const p = r.thong_tin_benh_nhan || {}
  const L = []
  L.push("BÁO CÁO LÂM SÀNG - MedParcours AI")
  L.push(`Bệnh nhân: ${p.ho_ten||""} | ${p.tuoi||"?"} tuổi | ${p.gioi_tinh||""}`)
  if(p.so_benh_an) L.push(`Số bệnh án: ${p.so_benh_an}`)
  if(p.ngay_vao_vien||p.ngay_ra_vien) L.push(`Vào viện: ${p.ngay_vao_vien||"-"} | Ra viện: ${p.ngay_ra_vien||"-"}`)
  if(r.chan_doan_chinh){ L.push(""); L.push("CHẨN ĐOÁN CHÍNH:"); L.push(r.chan_doan_chinh) }
  if(r.tom_tat_toan_canh){ L.push(""); L.push("TÓM TẮT TOÀN CẢNH:"); L.push(r.tom_tat_toan_canh) }
  if(r.clinical_takeaway && r.clinical_takeaway.length){ L.push(""); L.push("KẾT LUẬN NHANH:"); r.clinical_takeaway.forEach(t=>L.push("- "+t.txt)) }
  if(r.problem_status && r.problem_status.hien_tai && r.problem_status.hien_tai.length){ L.push(""); L.push("TRẠNG THÁI VẤN ĐỀ:"); r.problem_status.hien_tai.forEach(x=>L.push("- "+x.ten+": "+(x.mo_ta||""))) }
  if(r.hanh_dong_uu_tien && r.hanh_dong_uu_tien.length){ L.push(""); L.push("HÀNH ĐỘNG ƯU TIÊN:"); r.hanh_dong_uu_tien.forEach((a,i)=>L.push((i+1)+". "+(a.viec||"")+(a.ly_do?" ("+a.ly_do+")":""))) }
  if(r.thuoc_cuoi_ky && r.thuoc_cuoi_ky.length){ L.push(""); L.push("THUỐC:"); r.thuoc_cuoi_ky.forEach(m=>L.push("- "+(m.ten_thuoc||"")+(m.lieu?" "+m.lieu:"")+(m.cach_dung?", "+m.cach_dung:""))) }
  L.push(""); L.push("(Tạo bởi MedParcours AI. Cần bác sĩ xem xét trước khi dùng cho mục đích lâm sàng.)")
  return L.join("\n")
}
function exportLabsCSV(r) {
  const labs = (r.xet_nghiem_meta || r.xet_nghiem_key || [])
  const rows = [["Chi so","Mo ta","Don vi","Ngay","Gia tri","Binh thuong","Trang thai"]]
  labs.forEach(l => {
    if (!l) return
    const dates = l.trendDates || [], vals = l.trend || []
    if (dates.length && vals.length === dates.length) {
      dates.forEach((d, i) => rows.push([l.key, l.desc||"", l.unit||"", d, vals[i], l.normal||"", l.status||""]))
    } else {
      rows.push([l.key, l.desc||"", l.unit||"", l.ngay||"", l.rawVal!=null?l.rawVal:l.val, l.normal||"", l.status||""])
    }
  })
  const esc = v => { const s = String(v==null?"":v); return /[",\n\r]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s }
  const csv = "\uFEFF" + rows.map(row => row.map(esc).join(",")).join("\r\n")
  try {
    const blob = new Blob([csv], { type:"text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    const name = (r.thong_tin_benh_nhan && r.thong_tin_benh_nhan.so_benh_an) || "benh_an"
    a.href = url; a.download = "xet_nghiem_" + name + ".csv"
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1500)
    mpToast("Đã xuất CSV xét nghiệm")
  } catch { mpToast("Không xuất được CSV", "err") }
}

function triggerHandoff(r, docNote, bookmarks) {
  const p = r.thong_tin_benh_nhan || {}
  const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
  let findings = []
  try { findings = (runPriorityScreens(r).findings||[]).filter(f=>f.muc!=="stable").sort((a,b)=>TIER_ORDER[a.muc]-TIER_ORDER[b.muc]) } catch {}
  const PH = ["","Tiền phẫu","Hậu phẫu nội trú","Ngoại trú tái khám"]
  let phaseLabel = ""
  try { const pi = computePhaseInfo(r); phaseLabel = "Giai đoạn " + pi.currentPhase + (PH[pi.currentPhase] ? ": " + PH[pi.currentPhase] : "") } catch {}
  const labs = r.xet_nghiem_meta || r.xet_nghiem_key || []
  const ef = labs.find(l => l && l.key === "EF")
  const meds = r.thuoc_cuoi_ky || []
  const prios = (r.hanh_dong_uu_tien||[]).slice().sort((a,b)=>(a.uu_tien||9)-(b.uu_tien||9))
  const alertRows = findings.length
    ? findings.map(f=>`<li><b>[${TIER_META[f.muc].label}]</b> ${esc(f.ten)} - ${esc(f.ly_do)}</li>`).join("")
    : "<li>Khong co canh bao can xu tri ngay.</li>"
  const medRows = meds.length
    ? meds.map(m=>`<tr><td><b>${esc(m.ten_thuoc)}</b></td><td>${esc(m.nhom||"")}</td><td>${esc(m.lieu||"")}</td><td>${esc(m.cach_dung||"")}${m.keo_dai?" (duy tri)":""}</td></tr>`).join("")
    : `<tr><td colspan="4">Khong co thuoc duy tri.</td></tr>`
  const prioRows = prios.length
    ? prios.map(a=>`<li>${esc(a.viec)}${a.ly_do?` <span style="color:#555">- ${esc(a.ly_do)}</span>`:""}</li>`).join("")
    : "<li>Theo y lenh tai kham.</li>"
  const bmBlk = (bookmarks && bookmarks.length)
    ? `<h2>Muc bac si da danh dau</h2><ul>${bookmarks.map(b=>`<li>${esc(b.label)}${b.sub?" - "+esc(b.sub):""}</li>`).join("")}</ul>` : ""
  const noteBlk = (docNote && docNote.trim())
    ? `<h2>Ghi chu bac si</h2><div class="box" style="white-space:pre-wrap">${esc(docNote)}</div>` : ""
  const win = window.open("", "_blank", "width=850,height=700")
  win.document.write(`<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>Tom tat ban giao: ${esc(p.ho_ten)}</title>
<style>body{font-family:'Times New Roman',serif;color:#000;font-size:11pt;line-height:1.5;background:#fff;margin:0}.page{padding:14mm 14mm;max-width:210mm;margin:0 auto}h1{font-size:14pt;text-transform:uppercase;margin:0 0 3pt}h2{font-size:10pt;font-weight:700;text-transform:uppercase;border-bottom:1.5px solid #000;padding-bottom:2pt;margin:11pt 0 5pt}.hdr{border-bottom:2.5px solid #000;padding-bottom:8pt;margin-bottom:6pt;display:flex;justify-content:space-between}.hdr-r{text-align:right;font-size:8.5pt;color:#444}.sub{font-size:9pt;color:#444;margin:1pt 0}.diag{font-size:11pt;font-weight:700;margin:4pt 0}ul{margin:4pt 0;padding-left:18pt}li{margin:2pt 0;font-size:10pt}table{width:100%;border-collapse:collapse;font-size:9.5pt;margin:4pt 0}th{background:#eee;font-weight:700;text-align:left;padding:3pt 6pt;border:1px solid #aaa;font-size:8.5pt;text-transform:uppercase}td{padding:3pt 6pt;border:1px solid #ccc;vertical-align:top}.box{border:1px solid #999;border-left:4px solid #000;padding:5pt 9pt;margin:4pt 0;font-size:9.5pt}.pill{display:inline-block;border:1px solid #555;border-radius:9pt;padding:1pt 8pt;font-size:9pt;margin-right:5pt}.footer{border-top:1px solid #999;margin-top:14pt;padding-top:5pt;font-size:8pt;color:#666;display:flex;justify-content:space-between}@media print{@page{size:A4;margin:14mm}}</style>
</head><body><div class="page">
<div class="hdr"><div><div style="font-size:8.5pt;text-transform:uppercase;letter-spacing:.1em;color:#555;margin-bottom:3pt">MedParcours AI - Tom tat ban giao 1 trang</div><h1>${esc(p.ho_ten)}</h1><div class="sub">So benh an: ${esc(p.so_benh_an)} | ${esc(p.tuoi)} tuoi, ${esc(p.gioi_tinh)}</div><div class="sub">Vao vien: ${esc(p.ngay_vao_vien)} | Ra vien: ${esc(p.ngay_ra_vien)}</div></div><div class="hdr-r">In ngay: ${new Date().toLocaleDateString("vi-VN")}<br>MedParcours AI v1.2<br><span style="color:#c00;font-weight:700">Can bac si xac nhan</span></div></div>
<h2>Chan doan & trang thai</h2><div class="diag">${esc(r.chan_doan_chinh)}</div><div><span class="pill">${esc(phaseLabel)}</span>${ef?`<span class="pill">EF ${esc(ef.val)}</span>`:""}</div>
<h2>Canh bao can theo doi</h2><ul>${alertRows}</ul>
<h2>Thuoc dang dung</h2><table><tr><th>Thuoc</th><th>Nhom</th><th>Lieu</th><th>Cach dung</th></tr>${medRows}</table>
<h2>Viec can lam o lan tai kham</h2><ul>${prioRows}</ul>
${bmBlk}${noteBlk}
<div class="footer"><span>Tao tu dong boi MedParcours AI v1.2. Can bac si xem xet truoc khi dung lam sang.</span><span>HackAIthon 2026</span></div>
</div><script>window.onload=function(){window.print()}<\/script></body></html>`)
  win.document.close()
}

function triggerPrint(r, mode, docNote, bookmarks, analysis) {
  const p = r.thong_tin_benh_nhan
  const PRINT_META = {
    clinical:{ title:"Báo cáo lâm sàng", label:"MedParcours AI: Báo cáo lâm sàng tự động" },
    hoi_chan:{ title:"Biên bản hội chẩn đa chuyên khoa", label:"MedParcours AI: Biên bản hội chẩn đa chuyên khoa (AI)" },
    teaching:{ title:"Tài liệu học tập ca lâm sàng", label:"MedParcours AI: Tài liệu học tập ca lâm sàng (giảng dạy)" },
    full:{ title:"Bản bàn giao đầy đủ", label:"MedParcours AI: Bản bàn giao đầy đủ (Lâm sàng, Hội chẩn, Giảng dạy)" },
  }
  const meta = PRINT_META[mode] || PRINT_META.clinical
  // Thang điểm nguy cơ (CHA2DS2-VASc/HAS-BLED): CHỈ in khi có từ backend
  // (analysis.risk_scores) — không tự tính lại ở client, đúng nguyên tắc
  // "rule engine tất định là nguồn sự thật duy nhất" áp dụng cho cả màn hình
  // xem VÀ bản in. Nếu không có (chưa phân tích qua backend), mục này ẩn
  // hẳn khỏi bản in, KHÔNG hiện số sai hoặc số cũ.
  const riskScoresPrintBlock = (() => {
    const rs = analysis && analysis.risk_scores
    if (!rs || (!rs.cha2ds2_vasc && !rs.has_bled)) return ""
    let h = `<h2>XI. Thang điểm nguy cơ (chống đông)</h2>`
    h += `<p style="font-size:9pt;color:#555">Hỗ trợ quyết định, không tự kê đơn/chỉnh liều. Cần bác sĩ xác nhận.</p>`
    if (rs.cha2ds2_vasc) {
      const cv = rs.cha2ds2_vasc
      h += `<div class="alert"><div class="al">${cv.ten_thang_diem}: ${cv.tong_diem}/${cv.thang_diem_toi_da} điểm</div><div class="as">${cv.canh_bao_boi_canh}</div></div>`
    }
    if (rs.has_bled) {
      const hb = rs.has_bled
      h += `<div class="alert"><div class="al">${hb.ten_thang_diem}: ${hb.tong_diem}/${hb.thang_diem_toi_da} điểm</div><div class="as">${hb.dien_giai_muc_nguy_co}</div></div>`
    }
    return h
  })()
  // TTR và care-gaps: CHỈ in khi có từ backend, cùng nguyên tắc với risk scores.
  const ttrPrintBlock = (() => {
    const ttr = analysis && analysis.ttr
    if (!ttr) return ""
    return `<h2>XII. TTR — Time in Therapeutic Range</h2>
<p style="font-size:9pt;color:#555">${ttr.phuong_phap}</p>
<div class="alert"><div class="al">TTR: ${ttr.ttr_percent}% (${ttr.so_lan_trong_dich}/${ttr.so_lan_do} lần trong đích ${ttr.dich_dieu_tri})</div><div class="as">${ttr.dien_giai}</div></div>`
  })()
  const careGapsPrintBlock = (() => {
    const gaps = analysis && analysis.care_gaps
    if (!gaps || !gaps.length) return ""
    const sevLabel = { cao:"ƯU TIÊN CAO", trung_binh:"Trung bình", thap:"Theo dõi" }
    return `<h2>XIII. Khoảng trống theo guideline</h2>` +
      gaps.map(g=>`<div class="alert"><div class="al">[${sevLabel[g.muc_do]||g.muc_do}] ${g.tieu_de}</div><div class="as">${g.ly_do}</div></div>`).join("")
  })()
  const clinicalBody = `<h2>I. Chẩn đoán</h2><div class="row"><span class="lbl">Chẩn đoán chính:</span><span>${r.chan_doan_chinh}</span></div><div class="row"><span class="lbl">Lý do nhập viện:</span><span>${r.ly_do_vao_vien}</span></div><div class="row"><span class="lbl">Tiền sử:</span><span>${r.tien_su_benh}</span></div>
<h2>II. Phẫu thuật</h2><table><tr><th>Ngày</th><th>Phương pháp</th><th>Kết quả</th></tr><tr><td>${r.phau_thuat.ngay}</td><td>${r.phau_thuat.phuong_phap}</td><td>${r.phau_thuat.ket_qua}</td></tr></table><div class="row"><span class="lbl">Phẫu thuật viên:</span><span>${r.phau_thuat.bac_si_phau_thuat}</span></div>
<h2>III. Xét nghiệm</h2><table><tr><th>Chỉ số</th><th>Kết quả</th><th>BT</th><th>Đánh giá</th></tr>${(r.xet_nghiem_key||r.xet_nghiem_meta||[]).map(m=>`<tr><td>${m.key} (${m.desc})</td><td>${m.val}</td><td>${m.normal}</td><td>${m.status==="high"?"Cao":m.status==="low"?"Thấp":"BT"}</td></tr>`).join("")}</table>
<h2>IV. Diễn biến</h2><table><tr><th style="width:80pt">Ngày</th><th style="width:70pt">Loại</th><th>Mô tả</th></tr>${r.dien_bien_lam_sang.map(ev=>`<tr><td>${ev.ngay}</td><td>${ev.loai==="canh_bao"?"Cảnh báo":ev.loai==="bat_thuong"?"Bất thường":"BT"}</td><td>${ev.mo_ta}</td></tr>`).join("")}</table>
<h2>V. Siêu âm tim (${(r.sieu_am_tim?.lan_kham||[]).length} lượt)</h2><table><tr><th>Ngày</th><th>EF</th><th>Chênh áp</th><th>Kết luận</th></tr>${(r.sieu_am_tim?.lan_kham||[]).map(s=>`<tr><td>${s.ngay}${s.latest?" (gần nhất)":""}</td><td>${s.ef!=null?s.ef+"%":"-"}</td><td>${s.grad_max!=null?s.grad_max+(s.grad_tb!=null?"/"+s.grad_tb:"")+" mmHg":"-"}</td><td>${s.ghi_chu||s.chan_doan||""}</td></tr>`).join("")}</table>
<h2>VI. Thuốc</h2><table><tr><th>Tên thuốc</th><th>Nhóm</th><th>Liều</th><th>Cách dùng</th></tr>${r.thuoc_cuoi_ky.map(t=>`<tr><td>${t.ten_thuoc}</td><td>${t.nhom}</td><td>${t.lieu}</td><td>${t.cach_dung}</td></tr>`).join("")}</table>
<h2>VII. Cảnh báo</h2>${r.canh_bao_nguy_co.map(c=>`<div class="alert"><div class="al">[${c.muc_do==="cao"?"ƯU TIÊN CAO":c.muc_do==="trung_binh"?"Trung bình":"Theo dõi"}] ${c.mo_ta}</div><div class="as">Căn cứ: ${c.can_cu}</div></div>`).join("")}
${(()=>{const{findings,egfr,ctx}=runPriorityScreens(r);const s=checkDrugSafety(r.thuoc_cuoi_ky,egfr,ctx);const act=findings.filter(f=>f.muc!=="stable").sort((a,b)=>TIER_ORDER[a.muc]-TIER_ORDER[b.muc]);let h="<h2>VIII. Phân tầng ưu tiên lâm sàng</h2>";h+=act.map(f=>`<div class="alert"><div class="al">[${TIER_META[f.muc].label}] ${f.ten}</div><div class="as">${f.ly_do} — Nguồn: ${f.nguon}</div></div>`).join("")||"<p>Không có cảnh báo cần xử trí ngay.</p>";h+=`<h2>IX. Kiểm tra an toàn đơn thuốc</h2><p>Chức năng thận: eGFR ${egfr} mL/phút/1.73m2 (CKD-EPI 2021).</p>`;if(s.interactions.length)h+="<table><tr><th>Cặp thuốc</th><th>Mức</th><th>Hậu quả</th><th>Đề xuất</th></tr>"+s.interactions.map(it=>`<tr><td>${it.thuoc_a} + ${it.thuoc_b}</td><td>${TIER_META[it.muc].label}</td><td>${it.hau_qua}</td><td>${it.de_xuat}</td></tr>`).join("")+"</table>";if(s.favorable.length)h+="<p>Phù hợp khuyến cáo: "+s.favorable.map(f=>`${f.thuoc} (${f.nguon})`).join("; ")+"</p>";return h})()}
${riskScoresPrintBlock}
${ttrPrintBlock}
${careGapsPrintBlock}
<h2>X. Tóm tắt</h2><p>${r.tom_tat_toan_canh}</p>`
  const mdtPrintBody = (rr) => {
    const m = deriveMDT(rr)
    let h = `<h2>I. Tổng quan nguy cơ (MDT Risk Dashboard)</h2><table><tr><th>Vấn đề</th><th>Mức độ</th></tr>` + m.risk.map(d=>`<tr><td>${d.ten}</td><td>${d.pct}%</td></tr>`).join("") + `</table>`
    h += `<h2>II. Ưu tiên lâm sàng</h2>` + m.priorities.map(pr=>`<div class="alert"><div class="al">Ưu tiên ${pr.rank}: ${pr.ten}</div><div class="as">${pr.ly_do}</div></div>`).join("")
    h += `<h2>III. Chuyên khoa được mời</h2><table><tr><th>Chuyên khoa</th><th>Liên quan</th><th>Vai trò</th></tr>` + m.specialties.map(y=>`<tr><td>${y.khoa}</td><td>${y.relevance}</td><td>${y.role}</td></tr>`).join("") + `</table>`
    h += `<h2>IV. Nhận định theo chuyên khoa</h2>` + m.specialties.map(y=>`<div class="alert"><div class="al">${y.khoa} - Độ tin cậy ${y.confidence}%</div><div class="as"><b>Kết luận chính:</b> ${(y.ket_luan_chinh||[]).join("; ")||"-"}<br><b>Đề xuất:</b> ${(y.de_xuat||[]).join("; ")||"-"}<br><b>Dữ liệu còn thiếu:</b> ${y.con_thieu||"-"}</div></div>`).join("")
    h += `<h2>V. Kết luận hội chẩn (đồng thuận)</h2><p>${m.consensus}</p>`
    return h
  }
  const teachingPrintBody = (rr) => {
    const t = deriveTeaching(rr)
    const li = (arr) => `<ul>` + (arr||[]).map(x=>`<li>${x}</li>`).join("") + `</ul>`
    const khamTxt = (t.kham && typeof t.kham==="object") ? Object.values(t.kham).join("; ") : (t.kham||"-")
    let h = `<h2>I. Hành chính</h2><p>${t.hanh_chinh}</p>`
    h += `<h2>II. Lý do vào viện</h2><p>${t.ly_do}</p>`
    h += `<h2>III. Bệnh sử</h2>` + li(t.benh_su)
    h += `<h2>IV. Tiền sử</h2><p>${t.tien_su}</p>`
    h += `<h2>V. Khám lâm sàng</h2><p>${khamTxt}</p>`
    h += `<h2>VI. Tóm tắt hội chứng</h2>` + li(t.tom_tat)
    h += `<h2>VII. Chẩn đoán sơ bộ</h2><p>${t.chan_doan_so_bo}</p>`
    h += `<h2>VIII. Chẩn đoán phân biệt</h2>` + li(t.ddx)
    h += `<h2>IX. Biện luận</h2>` + li(t.bien_luan)
    h += `<h2>X. Cận lâm sàng đề nghị</h2><ul>` + (t.can_lam_sang||[]).map(c=>`<li>${c.viec} - ${c.ly_do}</li>`).join("") + `</ul>`
    h += `<h2>XI. Điều trị</h2><p>${t.dieu_tri_ngoai||""}</p>` + li(t.dieu_tri_noi)
    h += `<h2>XII. Tiên lượng - Dự phòng</h2><p>${t.tien_luong||"-"}</p>`
    h += `<h2>XIII. Red flags cần nhớ</h2><ul>` + (t.red_flags||[]).map(f=>`<li><b>${f.dau_hieu}:</b> ${f.y_nghia}</li>`).join("") + `</ul>`
    h += `<h2>XIV. Câu hỏi vấn đáp (Socratic)</h2>` + (t.socratic||[]).map((s,k)=>`<div class="alert"><div class="al">Câu ${k+1}: ${s.q}</div><div class="as">Gợi ý đáp án: ${s.a}</div></div>`).join("")
    return h
  }
  const sectionSep = (t)=>`<div style="margin:26pt 0 12pt;padding-bottom:6pt;border-bottom:2pt solid #1B5FCB;font-size:14pt;font-weight:700;color:#1B5FCB">${t}</div>`
  let bodyHtml = clinicalBody
  if(mode==="hoi_chan") bodyHtml = mdtPrintBody(r)
  else if(mode==="teaching") bodyHtml = teachingPrintBody(r)
  else if(mode==="full") bodyHtml = sectionSep("PHẦN A - BÁO CÁO LÂM SÀNG") + clinicalBody + sectionSep("PHẦN B - BIÊN BẢN HỘI CHẨN ĐA CHUYÊN KHOA") + mdtPrintBody(r) + sectionSep("PHẦN C - TÀI LIỆU GIẢNG DẠY") + teachingPrintBody(r)
  const win = window.open("", "_blank", "width=900,height=700")
  win.document.write(`<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>${meta.title}: ${p.ho_ten}</title>
<style>body{font-family:'Times New Roman',serif;color:#000;font-size:11pt;line-height:1.55;background:#fff;margin:0}.page{padding:18mm 16mm;max-width:210mm;margin:0 auto}h1{font-size:13pt;text-transform:uppercase;margin:0 0 2pt}h2{font-size:10pt;font-weight:700;text-transform:uppercase;border-bottom:1.5px solid #000;padding-bottom:3pt;margin:14pt 0 7pt}.hdr{border-bottom:2.5px solid #000;padding-bottom:10pt;margin-bottom:8pt;display:flex;justify-content:space-between}.hdr-r{text-align:right;font-size:9pt;color:#444}.sub{font-size:9pt;color:#444;margin:2pt 0}.row{display:flex;gap:6pt;font-size:10pt;margin:3pt 0}.lbl{color:#555;min-width:110pt}table{width:100%;border-collapse:collapse;font-size:10pt;margin:6pt 0 12pt}th{background:#eee;font-weight:700;text-align:left;padding:4pt 7pt;border:1px solid #aaa;font-size:9pt;text-transform:uppercase}td{padding:4pt 7pt;border:1px solid #ccc;vertical-align:top}tr:nth-child(even) td{background:#f9f9f9}.alert{border:1.5px solid #000;border-left:4px solid #000;padding:6pt 10pt;margin:5pt 0}.al{font-size:9pt;font-weight:700;text-transform:uppercase;margin-bottom:2pt}.as{font-size:9pt;color:#555}.footer{border-top:1px solid #999;margin-top:20pt;padding-top:7pt;font-size:8pt;color:#666;display:flex;justify-content:space-between}.stamp{border:1.5px solid #999;width:100pt;height:60pt;display:inline-block;margin-top:8pt;text-align:center;font-size:8pt;padding:5pt;color:#999}@media print{@page{size:A4;margin:18mm 16mm}}</style>
</head><body><div class="page">
<div class="hdr"><div><div style="font-size:9pt;text-transform:uppercase;letter-spacing:.1em;color:#555;margin-bottom:4pt">${meta.label}</div><h1>${p.ho_ten}</h1><div class="sub">Số bệnh án: ${p.so_benh_an} | ${p.tuoi} tuổi, ${p.gioi_tinh} | ${p.dia_chi}</div><div class="sub">Ngày sinh: ${p.ngay_sinh} | Vào viện: ${p.ngay_vao_vien} | Ra viện: ${p.ngay_ra_vien}</div></div><div class="hdr-r">In ngày: ${new Date().toLocaleDateString("vi-VN")}<br>MedParcours AI v1.2<br><span style="color:#c00;font-weight:700">Cần bác sĩ xác nhận</span></div></div>
${bodyHtml}
<div style="display:flex;justify-content:space-between;margin-top:24pt"><div><div class="stamp">Xác nhận bác sĩ phụ trách</div></div><div><div class="stamp">Ký tên bác sĩ</div></div></div>
${bookmarks && bookmarks.length ? `<h2>Mục đánh dấu cần theo dõi</h2><ul>${bookmarks.map(b=>`<li>${(b.label||"").replace(/&/g,"&amp;").replace(/</g,"&lt;")}${b.sub?` - ${b.sub.replace(/&/g,"&amp;").replace(/</g,"&lt;")}`:""}</li>`).join("")}</ul>` : ""}
        ${docNote && docNote.trim() ? `<h2>Ghi chú của bác sĩ</h2><div class="alert"><div class="as" style="white-space:pre-wrap">${docNote.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</div></div>` : ""}
<div class="footer"><span>Báo cáo tạo tự động bởi MedParcours AI v1.2. Cần bác sĩ xem xét trước khi dùng cho mục đích lâm sàng.</span><span>HackAIthon 2026</span></div>
</div><script>window.onload=function(){window.print()}<\/script></body></html>`)
  win.document.close()
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────
function StatusBadge({ level }) {
  const map = { cao:["cao","Ưu tiên cao"], trung_binh:["medio","Trung bình"], thap:["low","Theo dõi"] }
  const [cls, label] = map[level] || map.thap
  return <span className={`badge ${cls}`}><span className="badge-dot" />{label}</span>
}

let CURRENT_PKEY = "x"
function Card({ id, title, icon, children, headRight, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useGlobalCollapse(defaultCollapsed)
  const bodyRef = useRef(null)
  return (
    <div id={id} className={`card${collapsed ? " collapsed" : ""}`}>
      <div className="card-head">
        <span style={{ color:"#1D6FE8" }}>{icon}</span>
        <span className="card-head-title">{title}</span>
        <div className="card-head-right">
          {headRight}
          {title ? <FlagBtn pkey={CURRENT_PKEY} label={typeof title === "string" ? title : "Mục báo cáo"} sub="Mục trong báo cáo" detail={()=>elText(bodyRef.current)}/> : null}
          {title ? <CopyBtn text={()=>elText(bodyRef.current)} label=""/> : null}
          <button className="collapse-btn" onClick={() => setCollapsed(c => !c)} title={collapsed ? "Mở rộng" : "Thu gọn"}>
            {collapsed ? <Icon.ChevDown d={12} /> : <Icon.ChevUp d={12} />}
          </button>
        </div>
      </div>
      <div className="card-body" ref={bodyRef}>{children}</div>
    </div>
  )
}

function SourceModal({ source, onClose }) {
  if (!source) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">
            <Icon.Search d={14} color="#1D6FE8" />
            Truy xuất nguồn gốc dữ liệu
          </div>
          <button className="modal-close" onClick={onClose}><Icon.Close d={14} /></button>
        </div>
        <div className="modal-body">
          <div className="modal-highlight">"{source}"</div>
          <div className="modal-footer">
            <Icon.FileText d={12} color="#7A96C8" />
            Trích xuất từ hồ sơ bệnh nhân PDF gốc. Nội dung được tô sáng tương ứng trong tài liệu.
          </div>
        </div>
      </div>
    </div>
  )
}

function ScrollToTop() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400)
    window.addEventListener("scroll", onScroll)
    return () => window.removeEventListener("scroll", onScroll)
  }, [])
  return (
    <button className={`scroll-top${visible ? "" : " hidden"}`}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
      <Icon.ChevUp d={16} color="white" />
    </button>
  )
}

// ─── VITAL SIGNS CHART (SVG, no lib) ─────────────────────────────────────────
function VitalSignsChart({ data, summary }) {
  if (!data || data.length < 2) return null
  const W = 760, H = 240, PAD = { t:28, r:46, b:40, l:42 }
  const innerW = W - PAD.l - PAD.r, innerH = H - PAD.t - PAD.b
  const n = data.length

  const crpMax = Math.ceil(Math.max(...data.map(d => d.crp)) / 50) * 50
  const WBC_MAX = 20

  const x    = (i) => PAD.l + (i / (n - 1)) * innerW
  const crpY = (v) => PAD.t + innerH - (v / crpMax) * innerH
  const wbcY = (v) => PAD.t + innerH - (v / WBC_MAX) * innerH

  const crpPts = data.map((d,i) => `${x(i)},${crpY(d.crp)}`).join(" ")
  const wbcPts = data.map((d,i) => `${x(i)},${wbcY(d.wbc)}`).join(" ")
  const peakIdx = data.reduce((mi,d,i,a) => d.crp > a[mi].crp ? i : mi, 0)

  return (
    <div className="echo-tl-wrap" style={{ marginTop:14 }}>
      <div className="echo-tl-head">
        <div className="echo-bar-title" style={{ margin:0 }}>Diễn tiến viêm nhiễm sau mổ</div>
        <div className="echo-tl-legend">
          <span><i style={{ background:"#EF4444" }} />CRP (mg/L)</span>
          <span><i style={{ background:"#F59E0B" }} />Bạch cầu WBC (G/L)</span>
          <span><i style={{ background:"rgba(220,38,38,0.12)", border:"1px dashed #DC2626" }} />CRP bình thường &lt;5</span>
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow:"visible" }}>
        {/* Lưới ngang + nhãn trục trái CRP */}
        {[0,0.25,0.5,0.75,1].map((f,i) => {
          const v = Math.round(crpMax * (1 - f))
          return (
            <g key={i}>
              <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f*innerH} y2={PAD.t + f*innerH} stroke="rgba(200,220,255,0.25)" strokeWidth="1" />
              <text x={PAD.l - 5} y={PAD.t + f*innerH} textAnchor="end" fontSize="8" fill="#EF4444" dominantBaseline="middle">{v}</text>
            </g>
          )
        })}
        {/* Nhãn trục phải WBC */}
        {[0,5,10,15,20].map(v => (
          <text key={v} x={W - PAD.r + 5} y={wbcY(v)} textAnchor="start" fontSize="8" fill="#D97706" dominantBaseline="middle">{v}</text>
        ))}
        <text x={PAD.l - 5} y={PAD.t - 14} textAnchor="end" fontSize="8" fill="#EF4444" fontWeight="700">CRP</text>
        <text x={W - PAD.r + 5} y={PAD.t - 14} textAnchor="start" fontSize="8" fill="#D97706" fontWeight="700">WBC</text>

        {/* Ngưỡng CRP=5 */}
        <line x1={PAD.l} x2={W - PAD.r} y1={crpY(5)} y2={crpY(5)} stroke="#DC2626" strokeWidth="1" strokeDasharray="4 3" opacity="0.4" />

        {/* Đường WBC (amber) */}
        <polyline points={wbcPts} fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Đường CRP (red) */}
        <polyline points={crpPts} fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Điểm + nhãn */}
        {data.map((d,i) => (
          <g key={i}>
            <circle cx={x(i)} cy={wbcY(d.wbc)} r="3" fill="#F59E0B" />
            <text x={x(i)} y={wbcY(d.wbc) + 13} textAnchor="middle" fontSize="7.5" fill="#D97706">{d.wbc}</text>
            <circle cx={x(i)} cy={crpY(d.crp)} r={i===peakIdx?5:3.5} fill="#EF4444" stroke="#fff" strokeWidth={i===peakIdx?1.5:0} />
            <text x={x(i)} y={crpY(d.crp) - 8} textAnchor="middle" fontSize="8.5" fill="#B91C1C" fontWeight={i===peakIdx?"700":"600"}>{d.crp}</text>
            <text x={x(i)} y={H - 22} textAnchor="middle" fontSize="8.5" fill="#94A3B8">{d.ngay}</text>
          </g>
        ))}
        {/* Badge đỉnh */}
        <g>
          <rect x={x(peakIdx) - 20} y={crpY(data[peakIdx].crp) - 30} width="40" height="14" rx="7" fill="#DC2626" />
          <text x={x(peakIdx)} y={crpY(data[peakIdx].crp) - 20} textAnchor="middle" fontSize="8" fill="#fff" fontWeight="700">Đỉnh</text>
        </g>
      </svg>
      <AiInsight>{summary || <>CRP tăng vọt lên đỉnh <strong>{data[peakIdx].crp} mg/L</strong> ngày {data[peakIdx].ngay} (đáp ứng viêm sau mổ), sau đó giảm dần còn <strong>{data[data.length-1].crp} mg/L</strong>. Bạch cầu giảm song song, cho thấy nhiễm trùng đang được kiểm soát.</>}</AiInsight>
    </div>
  )
}

// ─── MED GANTT ────────────────────────────────────────────────────────────────
function MedGantt({ meds }) {
  const [hover, setHover] = useState(null)
  if (!meds || !meds.length) return null
  const DAY = 86400000
  // Parse "DD/MM" -> timestamp. Tháng 9-12 thuộc 2025, tháng 1-8 thuộc 2026.
  const toTs = (s) => {
    if (!s || s === "nay") return null
    const [d, m] = s.split("/").map(Number)
    const y = m >= 9 ? 2025 : 2026
    return new Date(y, m - 1, d).getTime()
  }
  const fmt = (ts) => { const dt = new Date(ts); return `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}` }
  // Ngày kết thúc: keo_dai -> đang dùng (null); ket_thuc cụ thể; hoặc tính từ số lượng/liều
  const medEnd = (m) => {
    const s = toTs(m.bat_dau)
    if (m.keo_dai) return null
    if (m.ket_thuc && m.ket_thuc !== "nay") return toTs(m.ket_thuc)
    if (s && m.so_luong && m.vien_moi_ngay) return s + Math.ceil(m.so_luong / m.vien_moi_ngay) * DAY
    return s ? s + 3 * DAY : null
  }

  const startsTs = meds.map(m => toTs(m.bat_dau)).filter(Boolean)
  const concreteEnds = meds.map(medEnd).filter(Boolean)

  if (startsTs.length === 0) {
    return (
      <div className="gantt-wrap">
        <div className="gantt-title">Lịch sử sử dụng thuốc</div>
        <div className="gantt-empty">
          Hồ sơ không ghi mốc ngày bắt đầu cho từng thuốc nên chưa dựng được biểu đồ thời gian.
          Toàn bộ đơn thuốc kèm liều và cách dùng đã hiển thị ở phần trên.
        </div>
      </div>
    )
  }

  const minT = Math.min(...startsTs)
  const lastConcrete = Math.max(...concreteEnds, ...startsTs)
  const maxT = lastConcrete + 5 * DAY
  const span = maxT - minT || 1
  const pct = (ts) => ((ts - minT) / span) * 100
  const ticks = Array.from({ length: 5 }, (_, i) => minT + (span * i) / 4)

  return (
    <div className="gantt-wrap">
      <div className="gantt-title">Lịch sử sử dụng thuốc</div>
      {meds.map((m, i) => {
        const sTs = toTs(m.bat_dau)
        const ongoing = !!m.keo_dai
        const eTs = ongoing ? maxT : (medEnd(m) || sTs + 3 * DAY)
        const left = pct(sTs)
        const width = Math.max(pct(eTs) - left, 2)
        const endLabel = ongoing ? "đang dùng" : fmt(eTs)
        return (
          <div key={i} className="gantt-row">
            <div className="gantt-label">
              <div className="gantt-label-name">{m.nhom}</div>
              <div className="gantt-label-date">{m.bat_dau} → {ongoing ? "nay" : fmt(eTs)}</div>
            </div>
            <div className="gantt-track">
              {ticks.map((t, ti) => <div key={ti} className="gantt-grid-line" style={{ left:`${pct(t)}%` }} />)}
              <div className="gantt-bar" style={{ left:`${left}%`, width:`${width}%`, background: ongoing ? `linear-gradient(90deg, ${(m.color||"#1D6FE8")}E6, ${(m.color||"#1D6FE8")}66)` : (m.color||"#1D6FE8") + "E6" }}
                onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(null)}>
                <span className="gantt-bar-end">{endLabel}</span>
                {hover===i && (
                  <div className="gantt-tip" style={{ left:`${left>70?"auto":"0"}`, right:`${left>70?"0":"auto"}` }}>
                    <div className="gantt-tip-name">{m.ten_thuoc}</div>
                    <div className="gantt-tip-row"><span className="gantt-tip-dot" style={{background:m.color}}/>{m.nhom} · {m.lieu}</div>
                    <div className="gantt-tip-use">{m.cach_dung}</div>
                    <div className="gantt-tip-date">{m.bat_dau} → {ongoing ? "đang dùng" : fmt(eTs)}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
      <div className="gantt-axis">
        <div className="gantt-axis-spacer" />
        <div className="gantt-axis-track">
          {ticks.map((t, i) => <span key={i} style={{ left:`${pct(t)}%` }}>{fmt(t)}</span>)}
        </div>
      </div>
    </div>
  )
}

// ─── ECHO TIMELINE ────────────────────────────────────────────────────────────
// Box "Phân tích AI": nhận xét diễn tiến hiển thị dưới mỗi biểu đồ
function AiInsight({ children }) {
  return (
    <div className="ai-insight">
      <div className="ai-insight-tag">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z"/>
        </svg>
        Phân tích AI
      </div>
      <span className="ai-insight-text">{children}</span>
    </div>
  )
}

// Chuẩn hóa: nhận mảng lan_kham mới, hoặc tự dựng từ format 3 ô cũ (tương thích ngược)
function normalizeEcho(sieu_am) {
  if (!sieu_am) return []
  if (Array.isArray(sieu_am.lan_kham)) return sieu_am.lan_kham
  // Fallback format cũ {truoc_mo, sau_mo, sau_ra_vien}
  const out = []
  const pull = (obj, phase) => {
    if (!obj) return
    const efMatch = (obj.ket_luan || "").match(/EF\s*(\d+)/)
    out.push({
      ngay: obj.ngay || "",
      nguon: "", chan_doan: "", hoc: "",
      ef: efMatch ? +efMatch[1] : null,
      grad_max: obj.gradient ?? null,
      grad_tb: null,
      phase, ghi_chu: obj.ket_luan || "", canh_bao: false,
    })
  }
  pull(sieu_am.truoc_mo, "truoc_mo")
  pull(sieu_am.sau_mo, "sau_mo")
  pull(sieu_am.sau_ra_vien, "tai_kham")
  if (out.length) out[out.length - 1].latest = true
  return out
}

const PHASE_META = {
  truoc_mo: { label:"Trước mổ",   color:"#F59E0B", bg:"rgba(254,243,199,0.7)", border:"rgba(253,230,138,0.6)" },
  sau_mo:   { label:"Sau mổ",     color:"#EF4444", bg:"rgba(254,242,242,0.8)", border:"rgba(254,202,202,0.6)" },
  hoi_phuc: { label:"Hồi phục",   color:"#10B981", bg:"rgba(240,253,250,0.8)", border:"rgba(153,246,228,0.5)" },
  tai_kham: { label:"Tái khám",   color:"#1D6FE8", bg:"rgba(235,244,255,0.8)", border:"rgba(191,219,254,0.5)" },
}

function EchoTimeline({ sieu_am, info }) {
  const [mode, setMode] = useState("both")  // both | ef | grad
  const sessions = normalizeEcho(sieu_am)
  if (sessions.length < 2) return null
  // Chỉ vẽ khi có đủ điểm để thành đường (>=2 EF hoặc >=2 chênh áp); nếu không, để bảng siêu âm hiển thị thay thế
  if (sessions.filter(s => s.ef != null).length < 2 && sessions.filter(s => s.grad_max != null).length < 2) return null

  // Câu nhận xét động: dựa trên EF và chênh áp lượt đầu -> cuối, lượt cảnh báo
  const efVals = sessions.filter(s => s.ef != null)
  const grVals = sessions.filter(s => s.grad_max != null)
  const efFirst = efVals[0]?.ef, efLast = efVals[efVals.length-1]?.ef
  const efMin = efVals.length ? Math.min(...efVals.map(s => s.ef)) : null
  const grFirst = grVals[0]?.grad_max, grLast = grVals[grVals.length-1]?.grad_max
  const warnSess = efVals.length ? efVals.reduce((mn,s)=> s.ef < mn.ef ? s : mn, efVals[0]) : null
  const echoInsight = (() => {
    const parts = []
    if (grFirst != null && grLast != null && grFirst > grLast)
      parts.push(`Chênh áp qua van giảm từ ${grFirst} xuống ${grLast} mmHg (van hoạt động tốt sau thay).`)
    if (efMin != null && efLast != null && efMin < efLast && efMin < 55)
      parts.push(`EF tụt thấp nhất còn ${efMin}%${warnSess ? ` (${warnSess.ngay}, ${warnSess.ghi_chu?.toLowerCase().includes("dịch") ? "do dịch màng tim" : "bất thường"})` : ""}, sau đó hồi phục lên ${efLast}%.`)
    else if (efFirst != null && efLast != null && efLast > efFirst)
      parts.push(`EF cải thiện từ ${efFirst}% lên ${efLast}%.`)
    else if (efLast != null)
      parts.push(`EF gần nhất ${efLast}%.`)
    return parts.join(" ") || "Theo dõi diễn biến EF và chênh áp qua các lần siêu âm."
  })()

  const W = 760, H = 300, PAD = { t:30, r:46, b:58, l:38 }
  const innerW = W - PAD.l - PAD.r, innerH = H - PAD.t - PAD.b
  const n = sessions.length

  // EF trục trái + chênh áp trục phải: tính theo dữ liệu để không tràn biểu đồ
  const _efVals = sessions.filter(s => s.ef != null).map(s => s.ef)
  const _grVals = sessions.filter(s => s.grad_max != null).map(s => s.grad_max)
  const EF_MIN = Math.min(30, _efVals.length ? Math.floor((Math.min(..._efVals) - 5) / 10) * 10 : 30)
  const EF_MAX = Math.max(80, _efVals.length ? Math.ceil((Math.max(..._efVals) + 5) / 10) * 10 : 80)
  const GR_MAX = Math.max(80, _grVals.length ? Math.ceil((Math.max(..._grVals) * 1.12) / 20) * 20 : 80)
  const efTicks = []; for (let v = EF_MIN; v <= EF_MAX; v += 10) efTicks.push(v)
  const grTicks = []; const _grStep = GR_MAX > 120 ? 40 : 20; for (let v = 0; v <= GR_MAX; v += _grStep) grTicks.push(v)
  const x   = (i) => PAD.l + (i / (n - 1)) * innerW
  const efY = (v) => PAD.t + innerH - ((v - EF_MIN) / (EF_MAX - EF_MIN)) * innerH
  const grY = (v) => PAD.t + innerH - (v / GR_MAX) * innerH

  const efPts = sessions.filter(s => s.ef != null).map(s => `${x(sessions.indexOf(s))},${efY(s.ef)}`).join(" ")
  const grPts = sessions.filter(s => s.grad_max != null).map(s => `${x(sessions.indexOf(s))},${grY(s.grad_max)}`).join(" ")

  // Mốc phẫu thuật: giữa lượt trước mổ cuối và lượt sau mổ đầu
  let surgX = null
  const lastPre = sessions.map(s => s.phase).lastIndexOf("truoc_mo")
  if (lastPre >= 0 && lastPre < n - 1) surgX = (x(lastPre) + x(lastPre + 1)) / 2

  // Vạch chia giai đoạn theo ngày (Giai đoạn 2 tại mổ, Giai đoạn 3 tại ra viện)
  const dividerX = (targetDate) => {
    if (!targetDate) return null
    const ts = sessions.map(s => parseVNDate(s.ngay)?.getTime())
    for (let i = 0; i < n - 1; i++) {
      if (ts[i] != null && ts[i+1] != null && targetDate.getTime() >= ts[i] && targetDate.getTime() <= ts[i+1]) {
        const frac = (ts[i+1] === ts[i]) ? 0.5 : (targetDate.getTime() - ts[i]) / (ts[i+1] - ts[i])
        return x(i) + frac * (x(i+1) - x(i))
      }
    }
    return null
  }
  const gd2X = info ? dividerX(info.surg) : surgX
  const gd3X = info ? dividerX(info.discharge) : null
  let phaseDividers = [
    gd2X != null && { x:gd2X, label:"Giai đoạn 2", color:"#EF4444" },
    gd3X != null && { x:gd3X, label:"Giai đoạn 3", color:"#10B981" },
  ].filter(Boolean)
  // Tách nhãn khi 2 vạch quá gần nhau để không đè lên nhau
  phaseDividers = phaseDividers.map(d => ({ ...d, labelX:d.x }))
  if (phaseDividers.length === 2 && Math.abs(phaseDividers[1].x - phaseDividers[0].x) < 86) {
    const mid = (phaseDividers[0].x + phaseDividers[1].x) / 2
    phaseDividers[0].labelX = mid - 44
    phaseDividers[1].labelX = mid + 44
  }

  return (
    <div className="echo-tl-wrap">
      <div className="echo-tl-head">
        <div className="echo-bar-title" style={{ margin:0 }}>Diễn biến EF và chênh áp van ĐMC qua 3 giai đoạn</div>
        <div className="echo-tl-modes">
          {[["both","Cả hai"],["ef","Chỉ EF"],["grad","Chỉ chênh áp"]].map(([k,lbl]) => (
            <button key={k} className={mode===k?"on":""} onClick={()=>setMode(k)}>{lbl}</button>
          ))}
        </div>
      </div>
      <div className="echo-tl-legend">
        {mode!=="grad" && <span><i style={{ background:"#1D6FE8" }} />EF (%)</span>}
        {mode!=="ef" && <span><i style={{ background:"#F59E0B" }} />Chênh áp tối đa (mmHg)</span>}
        {mode!=="grad" && <span><i style={{ background:"rgba(16,185,129,0.18)", border:"1px solid rgba(16,185,129,0.5)" }} />EF bình thường 55-70%</span>}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow:"visible" }}>
        {/* Vùng EF bình thường 55-70 */}
        {mode!=="grad" && <>
          <rect x={PAD.l} y={efY(70)} width={innerW} height={efY(55) - efY(70)} fill="rgba(16,185,129,0.10)" />
          <text x={PAD.l + 4} y={efY(70) - 3} fontSize="8" fill="#10B981">EF bình thường</text>
        </>}

        {/* Lưới ngang theo EF */}
        {efTicks.map(v => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={efY(v)} y2={efY(v)} stroke="rgba(200,220,255,0.25)" strokeWidth="1" />
            {mode!=="grad" && <text x={PAD.l - 5} y={efY(v)} textAnchor="end" fontSize="8" fill="#1D6FE8" dominantBaseline="middle">{v}</text>}
          </g>
        ))}
        {/* Nhãn trục phải chênh áp */}
        {mode!=="ef" && grTicks.map(v => (
          <text key={v} x={W - PAD.r + 5} y={grY(v)} textAnchor="start" fontSize="8" fill="#D97706" dominantBaseline="middle">{v}</text>
        ))}
        {mode!=="grad" && <text x={PAD.l - 5} y={PAD.t - 14} textAnchor="end" fontSize="8" fill="#1D6FE8" fontWeight="700">EF%</text>}
        {mode!=="ef" && <text x={W - PAD.r + 5} y={PAD.t - 14} textAnchor="start" fontSize="8" fill="#D97706" fontWeight="700">mmHg</text>}

        {/* Vạch chia giai đoạn (Giai đoạn 2 tại mổ, Giai đoạn 3 tại ra viện) */}
        {phaseDividers.map((pd,i) => (
          <g key={i}>
            <line x1={pd.x} x2={pd.x} y1={PAD.t - 6} y2={PAD.t + innerH} stroke={pd.color} strokeWidth="1.5" strokeDasharray="5 4" />
            {pd.labelX !== pd.x && <line x1={pd.x} x2={pd.labelX} y1={PAD.t - 6} y2={PAD.t - 16.5} stroke={pd.color} strokeWidth="1" />}
            <rect x={pd.labelX - 38} y={PAD.t - 24} width="76" height="15" rx="7" fill={pd.color} />
            <text x={pd.labelX} y={PAD.t - 13.5} textAnchor="middle" fontSize="8.5" fill="#fff" fontWeight="700">{pd.label}</text>
          </g>
        ))}

        {/* Đường chênh áp (amber) */}
        {mode!=="ef" && <polyline points={grPts} fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {/* Đường EF (blue) */}
        {mode!=="grad" && <polyline points={efPts} fill="none" stroke="#1D6FE8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}

        {/* Điểm + nhãn */}
        {sessions.map((s, i) => (
          <g key={i}>
            {/* Chênh áp dot + nhãn dưới */}
            {mode!=="ef" && s.grad_max != null && <>
              <circle cx={x(i)} cy={grY(s.grad_max)} r="3" fill="#F59E0B" />
              <text x={x(i)} y={grY(s.grad_max) + 13} textAnchor="middle" fontSize="7.5" fill="#D97706">{s.grad_max}</text>
            </>}
            {/* EF dot */}
            {mode!=="grad" && s.ef != null && <>
              {s.canh_bao && <circle cx={x(i)} cy={efY(s.ef)} r="7" fill="none" stroke="#DC2626" strokeWidth="1.5" />}
              <circle cx={x(i)} cy={efY(s.ef)} r={s.latest ? 5 : 3.5} fill={s.canh_bao ? "#DC2626" : "#1D6FE8"} stroke="#fff" strokeWidth={s.latest ? 1.5 : 0} />
              <text x={x(i)} y={efY(s.ef) - 8} textAnchor="middle" fontSize="8.5" fill={s.canh_bao ? "#DC2626" : "#1D3A6E"} fontWeight={s.latest ? "700" : "600"}>{s.ef}%</text>
            </>}
            {/* Nhãn ngày trục X (xoay) */}
            <text x={x(i)} y={H - 38} textAnchor="end" fontSize="7.5" fill={s.latest ? "#1D6FE8" : "#94A3B8"} fontWeight={s.latest ? "700" : "400"}
              transform={`rotate(-40 ${x(i)} ${H - 38})`}>{s.ngay.slice(0,5)}</text>
          </g>
        ))}
        {/* Badge "Gần nhất" cho lượt latest */}
        {mode!=="grad" && sessions.map((s, i) => s.latest && (
          <g key={`latest-${i}`}>
            <rect x={x(i) - 26} y={efY(s.ef) - 30} width="52" height="14" rx="7" fill="#1D6FE8" />
            <text x={x(i)} y={efY(s.ef) - 20} textAnchor="middle" fontSize="8" fill="#fff" fontWeight="700">Gần nhất</text>
          </g>
        ))}
      </svg>
      <AiInsight>{echoInsight}</AiInsight>
    </div>
  )
}

// Bảng tất cả lượt siêu âm, có sắp xếp và lọc theo giai đoạn
function EchoCompare({ sieu_am }){
  const all = normalizeEcho(sieu_am)
  const [ia,setIa]=useState(0)
  const [ib,setIb]=useState(Math.max(0, all.length-1))
  if(all.length<2) return null
  const A=all[Math.min(ia,all.length-1)], B=all[Math.min(ib,all.length-1)]
  const diff=(a,b)=> (a==null||b==null) ? null : +(b-a).toFixed(0)
  const Row=({label,unit,a,b,better})=>{
    const d=diff(a,b)
    const word = d==null?"":(d>0?"tăng":d<0?"giảm":"không đổi")
    let tone="flat"
    if(d!=null && d!==0 && better) tone = ((d>0&&better==="up")||(d<0&&better==="down")) ? "good":"bad"
    return (
      <div className="ecmp-row">
        <span className="ecmp-lbl">{label}</span>
        <span className="ecmp-a">{a==null?"-":a+unit}</span>
        <span className="ecmp-arrow">to</span>
        <span className="ecmp-b">{b==null?"-":b+unit}</span>
        <span className={`ecmp-d ${tone}`}>{d==null?"-":(d>0?"+":"")+d+unit+" "+word}</span>
      </div>
    )
  }
  return (
    <div className="ecmp">
      <div className="ecmp-head"><Icon.Pulse d={14} color="#1D6FE8"/>So sánh hai lần siêu âm</div>
      <div className="ecmp-pick">
        <select value={ia} onChange={e=>setIa(+e.target.value)}>{all.map((s,i)=><option key={i} value={i}>{s.ngay}{s.ef!=null?` (EF ${s.ef}%)`:""}</option>)}</select>
        <span className="ecmp-vs">so với</span>
        <select value={ib} onChange={e=>setIb(+e.target.value)}>{all.map((s,i)=><option key={i} value={i}>{s.ngay}{s.ef!=null?` (EF ${s.ef}%)`:""}</option>)}</select>
      </div>
      <Row label="EF (phân suất tống máu)" unit="%" a={A.ef} b={B.ef} better="up"/>
      <Row label="Chênh áp tối đa" unit=" mmHg" a={A.grad_max} b={B.grad_max} better="down"/>
      <Row label="Chênh áp trung bình" unit=" mmHg" a={A.grad_tb} b={B.grad_tb} better="down"/>
      <div className="ecmp-notes"><div><b>{A.ngay}:</b> {A.ghi_chu||A.chan_doan||"-"}</div><div><b>{B.ngay}:</b> {B.ghi_chu||B.chan_doan||"-"}</div></div>
    </div>
  )
}
function EchoSessionTable({ sieu_am }) {
  const all = normalizeEcho(sieu_am)
  const [sortMode, setSortMode] = useState("latest")  // latest | oldest
  const [phaseFilter, setPhaseFilter] = useState("all")
  if (!all.length) return null

  const parseD = (s) => { const [d,m,y] = (s||"").split("/").map(Number); return new Date(y||0, (m||1)-1, d||1).getTime() }

  // Các giai đoạn thực sự có trong dữ liệu (giữ thứ tự lâm sàng)
  const phaseOrder = ["truoc_mo","sau_mo","hoi_phuc","tai_kham"]
  const presentPhases = phaseOrder.filter(p => all.some(s => s.phase === p))

  let rows = phaseFilter === "all" ? [...all] : all.filter(s => s.phase === phaseFilter)
  rows.sort((a,b) => sortMode === "latest" ? parseD(b.ngay) - parseD(a.ngay) : parseD(a.ngay) - parseD(b.ngay))

  return (
    <div className="echo-tbl-wrap">
      <div className="echo-tbl-bar">
        <div className="echo-bar-title" style={{ margin:0 }}>Chi tiết {all.length} lượt siêu âm</div>
        <div className="echo-tbl-controls">
          <div className="echo-seg">
            <button className={sortMode==="latest"?"on":""} onClick={()=>setSortMode("latest")}>Gần nhất</button>
            <button className={sortMode==="oldest"?"on":""} onClick={()=>setSortMode("oldest")}>Lâu nhất</button>
          </div>
          <div className="echo-seg">
            <button className={phaseFilter==="all"?"on":""} onClick={()=>setPhaseFilter("all")}>Tất cả</button>
            {presentPhases.map(p => (
              <button key={p} className={phaseFilter===p?"on":""} onClick={()=>setPhaseFilter(p)}>{PHASE_META[p].label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="echo-tbl-scroll">
        <table className="echo-tbl">
          <thead>
            <tr>
              <th>Ngày</th><th>Giai đoạn</th><th>EF</th><th>Chênh áp (max/TB)</th><th>HoC</th><th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const pm = PHASE_META[s.phase] || PHASE_META.tai_kham
              const rowCls = s.canh_bao ? "warn" : s.latest ? "latest" : ""
              return (
                <tr key={i} className={rowCls}>
                  <td style={{ whiteSpace:"nowrap", fontWeight:s.latest?700:500 }}>
                    {s.ngay}
                    {s.latest && <span className="echo-tbl-badge">Gần nhất</span>}
                  </td>
                  <td><span className="echo-phase-pill" style={{ background:pm.bg, borderColor:pm.border, color:pm.color }}>{pm.label}</span></td>
                  <td style={{ fontWeight:700, color:s.canh_bao?"#DC2626":s.ef!=null&&s.ef<55?"#D97706":"#1D3A6E" }}>{s.ef!=null?`${s.ef}%`:"-"}</td>
                  <td style={{ whiteSpace:"nowrap" }}>{s.grad_max!=null?`${s.grad_max}${s.grad_tb!=null?"/"+s.grad_tb:""} mmHg`:"-"}</td>
                  <td style={{ minWidth:130, maxWidth:210 }}>{s.hoc||"-"}</td>
                  <td style={{ fontSize:11, color:s.canh_bao?"#B91C1C":"#5A7BB8", minWidth:230 }}>
                    {(() => {
                      const txt = expandAbbr(s.ghi_chu)
                      if (!txt) return "-"
                      const bs = txt.split(/(?<=\.)\s+/).map(x=>x.trim().replace(/\.$/,"")).filter(Boolean)
                      return bs.length > 1
                        ? <ul className="echo-note-bullets">{bs.map((b,k)=><li key={k}>{b}</li>)}</ul>
                        : txt
                    })()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── UPLOAD PAGE ──────────────────────────────────────────────────────────────
// Phát hiện định dạng + màu badge theo đuôi file
const FILE_KINDS = {
  pdf:  { tag:"PDF", color:"#DC2626", bg:"#FEF2F2" },
  doc:  { tag:"DOC", color:"#1D6FE8", bg:"#EFF6FF" }, docx: { tag:"DOC", color:"#1D6FE8", bg:"#EFF6FF" },
  xls:  { tag:"XLS", color:"#059669", bg:"#F0FDF4" }, xlsx: { tag:"XLS", color:"#059669", bg:"#F0FDF4" },
  ppt:  { tag:"PPT", color:"#EA580C", bg:"#FFF7ED" }, pptx: { tag:"PPT", color:"#EA580C", bg:"#FFF7ED" },
  png:  { tag:"PNG", color:"#7C3AED", bg:"#F5F3FF" },
  jpg:  { tag:"JPG", color:"#D97706", bg:"#FFFBEB" }, jpeg: { tag:"JPG", color:"#D97706", bg:"#FFFBEB" },
}
const kindOf = (name) => FILE_KINDS[(name.split(".").pop() || "").toLowerCase()] || { tag:"FILE", color:"#64748B", bg:"#F1F5F9" }
const fmtSize = (b) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(0)} KB` : `${(b/1048576).toFixed(1)} MB`

// Đếm số trang PDF phía client (heuristic, không cần thư viện)
async function countPdfPages(file) {
  if (!file.name.toLowerCase().endsWith(".pdf")) return null
  try {
    const buf = await file.arrayBuffer()
    const txt = new TextDecoder("latin1").decode(buf)
    const m = txt.match(/\/Type\s*\/Page[^s]/g)
    return m ? m.length : null
  } catch { return null }
}

// ─── LOGO ĐỐI TÁC / ĐƠN VỊ ─────────────────────────────────────────────────────
// Đặt file ảnh vào thư mục public/logos/ với đúng tên bên dưới (khớp tên file thật).
const PARTNER_GROUPS = [
  { label:"Cuộc thi",            logos:[{ file:"hackaithon.png", alt:"HackAIthon 2026" }] },
  { label:"Đơn vị tổ chức",      logos:[{ file:"hoi-sinh-vien.png", alt:"Hội Sinh viên Việt Nam" }, { file:"vietcombank.png", alt:"Vietcombank" }] },
  { label:"Bảo trợ chuyên môn",  logos:[{ file:"vnpt_ai.png", alt:"VNPT AI" }] },
  { label:"Đơn vị thực hiện",    logos:[{ file:"vsds.png", alt:"VSDS" }] },
]
function LogoBar({ compact }) {
  return (
    <div className={`logo-bar${compact?" compact":""}`}>
      {PARTNER_GROUPS.map((g,i)=>(
        <div key={i} className="logo-group">
          <div className="logo-group-lbl">{g.label}</div>
          <div className="logo-group-imgs">
            {g.logos.map((l,j)=>(
              <div key={j} className="logo-slot" title={l.alt}>
                <img src={asset("logos/"+l.file)} alt={l.alt} className="partner-logo" onError={e=>{e.currentTarget.classList.add("hide")}}/>
                <span className="logo-ph">{l.alt}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function UploadPage({ onUpload, isLoading, loadingMsg, error, onDismissError, onRetry, onOpenHistory, onOpenEcg, onLogout }) {
  const [dragging, setDragging] = useState(false)
  const [staged, setStaged] = useState([])
  const [note, setNote] = useState("")
  const [preview, setPreview] = useState(null)
  const inputRef = useRef()

  const addFiles = async (fileList) => {
    const arr = Array.from(fileList || [])
    const entries = await Promise.all(arr.map(async f => ({
      file: f, name: f.name, size: f.size, pages: await countPdfPages(f),
      url: URL.createObjectURL(f),
      isImage: /\.(png|jpe?g|gif|webp)$/i.test(f.name),
      isPdf: /\.pdf$/i.test(f.name),
    })))
    setStaged(prev => [...prev, ...entries])
  }
  const removeAt = (i) => setStaged(prev => {
    const t = prev[i]; if (t?.url) try { URL.revokeObjectURL(t.url) } catch {}
    return prev.filter((_, idx) => idx !== i)
  })

  const analyze = () => {
    // MVP: backend xử lý 1 PDF. Gửi file PDF đầu tiên trong danh sách.
    const pdf = staged.find(s => s.name.toLowerCase().endsWith(".pdf"))
    onUpload(pdf ? pdf.file : staged[0]?.file || null)
  }

  return (
    <div className="upload-page">
      <div className="upload-bg-circle1" /><div className="upload-bg-circle2" />
      {preview && (
        <div className="fp-overlay" onClick={()=>setPreview(null)}>
          <div className="fp-modal" onClick={e=>e.stopPropagation()}>
            <div className="fp-head">
              <span className="fp-name" title={preview.name}>{preview.name}</span>
              <span className="fp-meta">{preview.pages!=null?`${preview.pages} trang · `:""}{fmtSize(preview.size)}</span>
              <button className="fp-close" onClick={()=>setPreview(null)} title="Đóng"><Icon.Close d={15} color="#475569"/></button>
            </div>
            <div className="fp-body">
              {preview.isImage
                ? <img src={preview.url} alt={preview.name} className="fp-img"/>
                : <iframe src={preview.url} title={preview.name} className="fp-frame"/>}
            </div>
          </div>
        </div>
      )}
      <nav className="top-nav">
        <div className="logo">
          <BrandMark size={36} radius={10}/>
          <div><span className="logo-text">Med<em>Parcours</em></span> <span className="logo-sub">AI</span></div>
        </div>
        <div className="top-nav-actions">
          <ThemeToggle/>
          <button className="up-logout" onClick={async()=>{ if(await mpConfirm({title:"Đăng xuất?",message:"Bạn sẽ quay lại màn hình đăng nhập.",okText:"Đăng xuất",danger:true})) onLogout() }} title="Đăng xuất tài khoản"><Icon.Close d={12} color="#64748B"/>Đăng xuất</button>
        </div>
      </nav>
      <div className="hero-wrap">
        <div>
          <div className="hero-tag"><Icon.Heart d={12} color="#1D6FE8" /><div className="hero-tag-lines"><span><b>Team UN1SVENGERS</b></span><span>Vietnamese Student HackAIthon 2026 · Bảng B Challenger</span><span>Đề tài 5: Y tế</span></div></div>
          <h1 className="hero-h1">Hồ sơ bệnh nhân<br /><em>phân tích trong 30 giây.</em></h1>
          <p className="hero-desc">Bác sĩ upload PDF xuất từ HIS. AI đọc toàn bộ hồ sơ, tổng hợp báo cáo có cấu trúc, phát hiện cảnh báo nguy cơ và sẵn sàng trả lời mọi câu hỏi lâm sàng.</p>
          <div className="feat-list">
            {[[<Icon.FileText d={14}/>,"Tự động phân tích và tóm tắt diễn biến lâm sàng theo 3 giai đoạn."],[<Icon.Alert d={14}/>,"Phát hiện và cảnh báo sớm nguy cơ dựa trên hồ sơ bệnh án."],[<Icon.Stethoscope d={14}/>,"Hỗ trợ hội chẩn đa chuyên khoa (Virtual MDT) và giảng dạy từ Đại học Y Hà Nội (HMU)."],[<Icon.Chat d={14}/>,"Trợ lý ảo MedAmi hỏi đáp chuyên sâu cho từng hồ sơ cụ thể."]].map(([ic,text],i)=>(
              <div key={i} className="feat-item"><span className="feat-icon" style={{color:"#1D6FE8"}}>{ic}</span>{text}</div>
            ))}
          </div>
          <div className="stats-row">
            {[["~90%","thời gian được tiết kiệm",<Icon.Clock d={14} color="#1D6FE8"/>],["~30 giây","cho mỗi báo cáo phân tích",<Icon.Pulse d={14} color="#1D6FE8"/>],["3 chế độ","Bác sĩ - Hội chẩn - Giảng dạy",<Icon.Layers d={14} color="#1D6FE8"/>],["100%","cảnh báo rủi ro lâm sàng",<Icon.Shield d={14} color="#1D6FE8"/>]].map(([n,sub,ic])=>(
              <div key={n} className="stat-block">
                <div style={{display:"flex",alignItems:"center",gap:6}}>{ic}<div className="stat-n">{n}</div></div>
                <div className="stat-sub">{sub}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg" style={{display:"none"}} onChange={e=>{addFiles(e.target.files);e.target.value=""}}/>
          {error && (
            <div className="upload-err">
              <div className="upload-err-row">
                <Icon.Alert d={16} color="#DC2626"/>
                <span className="upload-err-title">Không phân tích được hồ sơ</span>
                <button className="upload-err-x" onClick={onDismissError}><Icon.Close d={13} color="#B91C1C"/></button>
              </div>
              <div className="upload-err-msg">{error}</div>
              {/* Gợi ý "máy chủ khởi động lại" chỉ đúng cho lỗi hạ tầng (mã lỗi,
                  timeout...) — nếu backend đã trả lý do rõ ràng (sai định dạng,
                  ảnh cần OCR, file rỗng...) thì hint này gây hiểu nhầm, nên ẩn. */}
              {!/định dạng|OCR|PDF|Word|Excel|PowerPoint|\.docx|\.xlsx|\.pptx|nội dung/i.test(error) && (
                <div className="upload-err-hint">Máy chủ AI có thể đang khởi động lại sau thời gian không hoạt động. Bạn có thể thử lại sau vài giây, hoặc xem hồ sơ mẫu để trải nghiệm tính năng.</div>
              )}
              <div className="upload-err-actions">
                {onRetry && <button className="upload-err-retry" onClick={onRetry}><Icon.Pulse d={13} color="#fff"/>Thử lại</button>}
                <button className="upload-err-demo" onClick={()=>onUpload(null)}>Xem hồ sơ mẫu</button>
              </div>
            </div>
          )}
          {isLoading ? (
            <div className="upload-zone">
              <div style={{padding:"24px 0"}}>
                <div className="loading-spin"/>
                <p style={{fontSize:15,fontWeight:600,color:"#0A1628",marginBottom:4}}>Đang phân tích hồ sơ...</p>
                <p style={{fontSize:12,color:"#7A96C8"}}>{loadingMsg || "AI đang đọc và tổng hợp dữ liệu"}</p>
                <div className="load-steps">
                  {["Trích xuất","Rule Engine","Diễn đạt"].map((s,i)=>(
                    <span key={i} style={{display:"flex",alignItems:"center",gap:6}}>
                      <span className="load-step">{s}</span>{i<2&&<span className="load-arr">▶</span>}
                    </span>
                  ))}
                </div>
                <div className="skel-wrap" aria-hidden="true">
                  <div className="skel-card"><div className="skel-line w40"/><div className="skel-line w90"/><div className="skel-line w75"/></div>
                  <div className="skel-row"><div className="skel-box"/><div className="skel-box"/><div className="skel-box"/></div>
                  <div className="skel-card"><div className="skel-line w55"/><div className="skel-line w95"/><div className="skel-line w70"/></div>
                </div>
              </div>
            </div>
          ) : staged.length === 0 ? (
            <div className={`upload-zone${dragging?" drag":""}`}
              onDragOver={e=>{e.preventDefault();setDragging(true)}}
              onDragLeave={()=>setDragging(false)}
              onDrop={e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files)}}
              onClick={()=>inputRef.current.click()}>
              <div style={{padding:"16px 0"}}>
                <div className="upload-icon"><Icon.Upload d={26} color="#1D6FE8"/></div>
                <p className="upload-title">Kéo thả hoặc nhấn để chọn</p>
                <p className="upload-sub">PDF, Word, Excel, PowerPoint — ảnh cần OCR đang phát triển</p>
                <button className="btn-primary" onClick={e=>{e.stopPropagation();inputRef.current.click()}}><Icon.Upload d={15} color="white"/>Chọn tài liệu</button>
                <div className="fmt-row">
                  <span className="fmt-lbl">Định dạng hỗ trợ</span>
                  <div className="fmt-chips">
                    {["PDF","DOCX","XLSX","PPTX"].map(t=>{
                      const k = FILE_KINDS[t.toLowerCase()] || kindOf("x."+t.toLowerCase())
                      return <span key={t} className="fmt-chip" style={{color:k.color,background:k.bg}}>{t}</span>
                    })}
                    {["PNG","JPG"].map(t=>(
                      <span key={t} className="fmt-chip fmt-chip-soon" title="Cần OCR, đang phát triển (giai đoạn 2)">{t} (sắp có)</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="stage-wrap">
              <div className="stage-head">
                <span className="stage-title">{staged.length} tài liệu đã chọn</span>
                <button className="stage-clear" onClick={()=>setStaged([])}>Xóa tất cả</button>
              </div>
              <div className="stage-grid"
                onDragOver={e=>{e.preventDefault();setDragging(true)}}
                onDragLeave={()=>setDragging(false)}
                onDrop={e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files)}}>
                {staged.map((s,i)=>{
                  if(s.isAudio){
                    const words=(s.text||"").trim().split(/\s+/).filter(Boolean).length
                    return (
                      <div key={i} className="stage-card">
                        <button className="stage-x" onClick={()=>removeAt(i)} title="Xóa"><Icon.Close d={11} color="#64748B"/></button>
                        <div className="stage-thumb" style={{background:"rgba(14,148,136,.1)"}} title={s.text}>
                          <span className="stage-tag" style={{color:"#0E9488"}}>{s.tag||"GHI ÂM"}</span>
                        </div>
                        <div className="stage-name" title={s.text}>{s.name}</div>
                        <div className="stage-meta">{words} từ · lời dặn kèm hồ sơ</div>
                      </div>
                    )
                  }
                  const k = kindOf(s.name)
                  const canView = s.isImage || s.isPdf
                  return (
                    <div key={i} className="stage-card">
                      <button className="stage-x" onClick={()=>removeAt(i)} title="Xóa"><Icon.Close d={11} color="#64748B"/></button>
                      <div className="stage-thumb" style={{background:s.isImage?"#0A1628":k.bg, cursor:canView?"pointer":"default"}}
                        onClick={()=>canView&&setPreview(s)} title={canView?"Nhấn để xem nội dung":""}>
                        {s.isImage
                          ? <img src={s.url} alt={s.name} className="stage-img"/>
                          : <span className="stage-tag" style={{color:k.color}}>{k.tag}</span>}
                        {canView && <span className="stage-view"><Icon.Search d={12} color="#fff"/>Xem</span>}
                      </div>
                      <div className="stage-name" title={s.name}>{s.name}</div>
                      <div className="stage-meta">{s.pages!=null?`${s.pages} trang · `:""}{fmtSize(s.size)}</div>
                    </div>
                  )
                })}
                <button className={`stage-add${dragging?" drag":""}`} onClick={()=>inputRef.current.click()}>
                  <Icon.Upload d={18} color="#1D6FE8"/><span>Thêm file</span>
                </button>
              </div>
              <button className="btn-primary stage-go" onClick={analyze}>
                <Icon.Pulse d={15} color="white"/>Phân tích {staged.length} tài liệu
              </button>
              <p className="upload-privacy">Bác sĩ kiểm tra định dạng và số trang trước khi quét. Dữ liệu xử lý bảo mật.</p>
            </div>
          )}
          {!isLoading&&staged.length===0&&<div style={{textAlign:"center"}}><span className="demo-link" onClick={()=>onUpload(null)}>Xem demo: hồ sơ Nguyễn Văn A <span style={{fontSize:10}}>▶</span></span> <button className="hist-link" onClick={onOpenHistory}><Icon.FileText d={13} color="#1D6FE8"/>Lịch sử bệnh án</button> <button className="hist-link" onClick={onOpenEcg}><Icon.Pulse d={13} color="#1D6FE8"/>Quét điện tâm đồ</button></div>}
          {!isLoading && (
            <div className="rec-inline-wrap">
              <div className="rec-inline-h"><Icon.Pulse d={13} color="#1D6FE8"/>Lời dặn của bác sĩ - gõ trực tiếp hoặc bấm micro để đọc</div>
              <AudioRecorder value={note} onChange={setNote} onAttach={(t)=>{ setStaged(prev=>[...prev,{name:"Lời dặn bác sĩ", isAudio:true, tag:"LỜI DẶN", text:t, size:t.length}]); setNote(""); mpToast("Đã đính kèm lời dặn vào hồ sơ") }}/>
            </div>
          )}
        </div>
      </div>
      <LogoBar/>
    </div>
  )
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
const NAV_GROUPS = [
  { group:"Tổng quan", items:[
    {id:"sec-overview", label:"Tổng quan nhanh",     icon:<Icon.Pulse d={11}/>},
    {id:"sec-status",   label:"Bệnh nhân",          icon:<Icon.Stethoscope d={11}/>},
    {id:"sec-timeline", label:"Dòng thời gian",     icon:<Icon.Clock d={11}/>},
    {id:"sec-takeaway", label:"Kết luận nhanh",     icon:<Icon.ShieldCheck d={11}/>},
    {id:"sec-problems", label:"Trạng thái vấn đề",  icon:<Icon.Octagon d={11}/>},
    {id:"sec-actions",  label:"Hành động ưu tiên",  icon:<Icon.Layers d={11}/>},
    {id:"sec-checklist", label:"Việc cần làm",       icon:<Icon.ShieldCheck d={11}/>},
  ]},
  { group:"3 giai đoạn", items:[
    {id:"sec-phase1", label:"Giai đoạn 1: Tiền phẫu", icon:<Icon.Dot color="#8B5CF6"/>},
    {id:"sec-phase2", label:"Giai đoạn 2: Hậu phẫu",  icon:<Icon.Dot color="#EF4444"/>},
    {id:"sec-phase3", label:"Giai đoạn 3: Ngoại trú", icon:<Icon.Dot color="#10B981"/>},
  ]},
  { group:"Phân tích", items:[
    {id:"sec-echo",      label:"Chẩn đoán hình ảnh", icon:<Icon.Ultrasound d={11}/>},
    {id:"sec-reasoning", label:"Biện luận lâm sàng",     icon:<Icon.Brain d={11}/>},
    {id:"sec-labs",      label:"Xét nghiệm",     icon:<Icon.Flask d={11}/>},
    {id:"sec-compare",  label:"So sánh xét nghiệm",   icon:<Icon.Flask d={11}/>},
    {id:"sec-trend",    label:"Xu hướng tổng hợp",   icon:<Icon.Pulse d={11}/>},
    {id:"sec-meds",      label:"Thuốc",          icon:<Icon.Pill d={11}/>},
    {id:"sec-drug",      label:"eGFR & An toàn thuốc", icon:<Icon.ShieldCheck d={11}/>},
    {id:"sec-risk",      label:"Thang điểm nguy cơ",   icon:<Icon.Shield d={11}/>},
    {id:"sec-caregap",   label:"Khoảng trống guideline", icon:<Icon.Octagon d={11}/>},
    {id:"sec-summary",   label:"Tóm tắt",        icon:<Icon.FileText d={11}/>},
  ]},
]
const SECTIONS = NAV_GROUPS.flatMap(g => g.items)
function SidebarMinimap({ activeId, onNavigate }) {
  return (
    <nav className="sidebar">
      {NAV_GROUPS.map(g => (
        <div key={g.group} className="sidebar-group">
          <div className="sidebar-label">{g.group}</div>
          {g.items.map(s=>(
            <button key={s.id} className={`sidebar-item${activeId===s.id?" active":""}`} onClick={()=>onNavigate(s.id)}>
              <span style={{color:"currentColor",display:"flex",flexShrink:0}}>{s.icon}</span>{s.label}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}

// ─── REPORT PAGE ──────────────────────────────────────────────────────────────
function ReportPage({ report, hoSoText, analysis, onReset, chatMessages, setChatMessages, onOpenHistory, onLogout }) {
  const [tab, setTab] = useState("report")
  const [viewMode, setViewMode] = useState("clinical")
  const [menuOpen, setMenuOpen] = useState(false)
  const noteKey = "mp_note_" + ((report && report.thong_tin_benh_nhan && report.thong_tin_benh_nhan.so_benh_an) || "x")
  const [docNote, setDocNote] = useState("")
  useEffect(() => { try { setDocNote(sessionStorage.getItem(noteKey) || "") } catch {} }, [noteKey])
  const saveNote = (v) => { setDocNote(v); try { sessionStorage.setItem(noteKey, v) } catch {} }
  const [zoom, setZoom] = useState(1)
  const pkey = (report && report.thong_tin_benh_nhan && report.thong_tin_benh_nhan.so_benh_an) || "x"
  CURRENT_PKEY = pkey
  const [bmOpen, setBmOpen] = useState(false)
  const [bmList, setBmList] = useState([])
  useEffect(() => { const h=()=>setBmList(bmGet(pkey)); h(); window.addEventListener("mp-bm",h); return ()=>window.removeEventListener("mp-bm",h) }, [pkey])
  const goToBookmark = (it) => {
    const sub = (it && it.sub) || ""
    const mode = /h.?i ch.?n/i.test(sub) ? "hoi_chan" : /gi.?ng d.?y/i.test(sub) ? "teaching" : "clinical"
    setViewMode(mode); setBmOpen(false)
    const tryScroll = (tries) => {
      let el = it.anchor ? document.getElementById(it.anchor) : null
      if(!el && it.label){
        const cands = Array.from(document.querySelectorAll(".card-head-title,.takeaway-hd span,.mdt-step-t,.teach-sec-t,.phase-sec-tag,.tls-head span,.banner-hd span,h2,h3"))
        const m = cands.find(n => (n.textContent||"").trim() === it.label.trim()) || cands.find(n => (n.textContent||"").includes(it.label))
        if(m) el = m.closest(".card,.takeaway-card,.phase-sec,.tls-card,.mode-card,.mdt-step,.teach-sec") || m
      }
      if(el){ el.scrollIntoView({behavior:"smooth", block:"start"}); el.classList.add("bm-flash"); setTimeout(()=>el.classList.remove("bm-flash"),1600) }
      else if(tries>0) setTimeout(()=>tryScroll(tries-1), 260)
    }
    setTimeout(()=>tryScroll(7), 140)
  }
  const [query, setQuery] = useState("")
  const doSearch = useCallback(() => {
    const term = query.trim().toLowerCase()
    if(!term) return
    const root = document.querySelector(".report-main") || document.querySelector(".mode-card")
    if(!root){ mpToast("Không có nội dung để tìm", "err"); return }
    const els = root.querySelectorAll("p,li,span,td,th,b,h1,h2,h3,h4,div")
    for(const el of els){
      if(el.children.length===0 && (el.textContent||"").toLowerCase().includes(term)){
        el.scrollIntoView({ behavior:"smooth", block:"center" })
        el.classList.add("search-hit")
        setTimeout(()=>el.classList.remove("search-hit"), 2200)
        return
      }
    }
    mpToast('Không tìm thấy "' + query.trim() + '" trong báo cáo', "err")
  }, [query])
  useEffect(() => {
    setChatMessages(prev => (prev.length <= 1
      ? [{ role:"assistant", content: modeGreeting(viewMode, report.thong_tin_benh_nhan && report.thong_tin_benh_nhan.ho_ten) }]
      : prev))
  }, [viewMode])
  const [activeSection, setActiveSection] = useState("sec-status")
  const navLock = useRef(0)
  const r = report

  // Điều hướng khi bấm: set active ngay + cuộn + khóa scroll-spy 700ms để không bị nhảy
  const navigateTo = useCallback((id) => {
    navLock.current = Date.now()
    setActiveSection(id)
    document.getElementById(id)?.scrollIntoView({ behavior:"smooth", block:"start" })
  }, [])

  // Scroll-spy xác định: chọn section có đỉnh vừa vượt qua ngưỡng gần đầu khung
  useEffect(() => {
    if (tab !== "report") return
    const onScroll = () => {
      if (Date.now() - navLock.current < 700) return  // đang cuộn do bấm, bỏ qua
      const THRESHOLD = 160
      let current = SECTIONS[0]?.id
      for (const { id } of SECTIONS) {
        const el = document.getElementById(id)
        if (!el) continue
        if (el.getBoundingClientRect().top <= THRESHOLD) current = id
      }
      // Đã cuộn sát đáy trang: ép chọn mục cuối (Tóm tắt) dù đỉnh chưa vượt ngưỡng
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8) {
        current = SECTIONS[SECTIONS.length - 1]?.id || current
      }
      setActiveSection(prev => prev === current ? prev : current)
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive:true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [tab])

  // Keyboard shortcut Ctrl+K to focus chat
  useEffect(() => {
    const handler = e => {
      const tag = (e.target && e.target.tagName) || ""
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault()
        setTab("chat")
        setTimeout(() => document.getElementById("chat-input-field")?.focus(), 100)
        return
      }
      if (e.key === "Escape") { setMenuOpen(false); return }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === "?") { e.preventDefault(); mpHelp(); return }
      if (e.key === "/") { e.preventDefault(); document.getElementById("rpt-search-input")?.focus(); return }
      if (e.key === "1") { setViewMode("clinical"); mpToast("Chế độ: Bác sĩ (Lâm sàng)") }
      else if (e.key === "2") { setViewMode("hoi_chan"); mpToast("Chế độ: Hội chẩn AI") }
      else if (e.key === "3") { setViewMode("teaching"); mpToast("Chế độ: Học vụ (Giảng dạy)") }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  // Chip nhắc nhanh: sinh động từ hồ sơ, không hardcode theo bệnh nhân
  const chips = buildChips(report)

  return (
    <div>
      <header className="report-nav">
        <div className="report-nav-inner">
          <div className="nav-left">
            <div className="logo">
              <BrandMark size={30} radius={9}/>
              <span className="logo-text" style={{fontSize:14}}>Med<em>Parcours</em></span>
              <span className="logo-sub" style={{fontSize:12}}>AI</span>
            </div>
            <span className="nav-sep">▶</span>
            <div className="nav-patient">
              <div className="patient-avatar">{r.thong_tin_benh_nhan.ho_ten.charAt(0)}</div>
              <span className="patient-name">{r.thong_tin_benh_nhan.ho_ten}</span>
              <span className="patient-meta">{r.thong_tin_benh_nhan.tuoi} tuổi, {r.thong_tin_benh_nhan.gioi_tinh}</span>
            </div>
          </div>
          <div className="nav-right">
            <ModeDropdown mode={viewMode} onChange={setViewMode}/>
            <div className="tab-group">
              {[["report",<Icon.FileText d={13}/>,"Báo cáo"],["chat",<Icon.Chat d={13}/>,"Chatbot"]].map(([key,ic,label])=>(
                <button key={key} className={`tab-btn${tab===key?" active":""}`} onClick={()=>setTab(key)}>{ic} {label}</button>
              ))}
            </div>
            <FocusToggle/>
            <ThemeToggle/>
            <button className="nav-export" onClick={()=>triggerPrint(report, viewMode, docNote, bmList, analysis)} title="Xuất báo cáo"><Icon.Print d={14} color="#fff"/>Xuất báo cáo</button>
            <div className="nav-menu-wrap">
              <button className="nav-burger" onClick={()=>setMenuOpen(o=>!o)} title="Menu" aria-label="Menu">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              </button>
              {menuOpen && <>
                <div className="nav-menu-ov" onClick={()=>setMenuOpen(false)}/>
                <div className="nav-menu">
                  <div className="nav-menu-sec">Xuất & chia sẻ</div>
                  <button onClick={()=>{setMenuOpen(false);triggerPrint(report,"full",docNote,bmList,analysis)}}><Icon.FileText d={14} color="#475569"/>Xuất bản đầy đủ (3 chế độ)</button>
                  <button onClick={()=>{setMenuOpen(false);triggerHandoff(report,docNote,bmList)}}><Icon.FileText d={14} color="#475569"/>Tóm tắt 1 trang (bàn giao)</button>
                  <button onClick={()=>{setMenuOpen(false);exportLabsCSV(report)}}><Icon.Flask d={14} color="#475569"/>Xuất xét nghiệm (CSV)</button>
                  <button onClick={()=>{setMenuOpen(false); (async()=>{ try{ await navigator.clipboard.writeText(reportToText(report)); mpToast("Đã sao chép toàn bộ báo cáo") }catch{ mpToast("Không sao chép được","err") } })()}}><Icon.FileText d={14} color="#475569"/>Sao chép toàn bộ báo cáo</button>
                  <div className="nav-menu-sec">Công cụ</div>
                  <button onClick={()=>{setMenuOpen(false);setBmOpen(true)}}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>Mục đã đánh dấu ({bmList.length})</button>
                  <button onClick={()=>{setMenuOpen(false);mpCards(true)}}><Icon.ChevUp d={14} color="#475569"/>Thu gọn tất cả thẻ</button>
                  <button onClick={()=>{setMenuOpen(false);mpCards(false)}}><Icon.ChevDown d={14} color="#475569"/>Mở rộng tất cả thẻ</button>
                  <button onClick={()=>{setMenuOpen(false);mpHelp()}}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 20h8M7 8h.01M11 8h.01M15 8h.01M7 12h.01M17 12h.01M11 12h2"/></svg>Phím tắt</button>
                  <div className="nav-menu-font" onClick={e=>e.stopPropagation()}>
                    <span>Cỡ chữ</span>
                    <button onClick={()=>setZoom(z=>Math.max(0.85,+(z-0.1).toFixed(2)))} title="Nhỏ hơn">A-</button>
                    <button onClick={()=>setZoom(1)} title="Mặc định">A</button>
                    <button onClick={()=>setZoom(z=>Math.min(1.4,+(z+0.1).toFixed(2)))} title="Lớn hơn">A+</button>
                  </div>
                  <div className="nav-menu-sec">Hồ sơ</div>
                  <button onClick={()=>{setMenuOpen(false);onOpenHistory()}}><Icon.Clock d={14} color="#475569"/>Lịch sử bệnh án</button>
                  <button onClick={async()=>{setMenuOpen(false); if(await mpConfirm({title:"Phân tích hồ sơ mới?",message:"Báo cáo đang xem sẽ được đóng lại. Bạn có thể mở lại trong Lịch sử bệnh án.",okText:"Tiếp tục"})) onReset()}}><Icon.Back d={13} color="#475569"/>Hồ sơ mới</button>
                  <button className="danger" onClick={async()=>{setMenuOpen(false); if(await mpConfirm({title:"Đăng xuất khỏi MedParcours AI?",message:"Bạn sẽ quay lại màn hình đăng nhập.",okText:"Đăng xuất",danger:true})) onLogout()}}><Icon.Close d={13} color="#DC2626"/>Đăng xuất</button>
                </div>
              </>}
            </div>
          </div>
        </div>
      </header>

      {/* Patient chip bar */}
      <div className="chip-bar">
        <div className="chip-bar-inner">
          <span className="chip-lbl">Nhắc nhở nhanh:</span>
          {chips.map(c=><span key={c.label} className={`chip-tag ${c.cls}`}>{c.label}</span>)}
          <div className="rpt-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7A96C8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input id="rpt-search-input" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")doSearch();if(e.key==="Escape")e.target.blur()}} placeholder="Tìm trong báo cáo... (phím /)"/>
            {query && <button className="rpt-search-x" onClick={()=>setQuery("")} title="Xóa"><Icon.Close d={11} color="#7A96C8"/></button>}
          </div>
        </div>
      </div>

      {tab === "report" ? (
        viewMode === "clinical" ? (
          <div className="report-outer">
            <SidebarMinimap activeId={activeSection} onNavigate={navigateTo}/>
            <div className="report-main" style={{zoom}}><ReportTab report={report} analysis={analysis}/></div>
          </div>
        ) : (
          <div className="report-outer">
            <div className="report-main" style={{maxWidth:"none", zoom}}>
              {viewMode === "hoi_chan" ? <MDTView report={report}/> : <TeachingView report={report}/>}
            </div>
          </div>
        )
      ) : (
        <div className="chat-page">
          <ChatTab report={report} hoSoText={hoSoText} messages={chatMessages} setMessages={setChatMessages} mode={viewMode}/>
        </div>
      )}
      {tab === "report" && (
        <FloatingChat report={report} hoSoText={hoSoText} messages={chatMessages} setMessages={setChatMessages} mode={viewMode}
          onExpand={()=>setTab("chat")}/>
      )}
      <PatientSnapshot report={report}/>
      <DoctorNote value={docNote} onChange={saveNote}/>
      {bmOpen && <BookmarkPanel pkey={pkey} items={bmList} onClose={()=>setBmOpen(false)} onGo={goToBookmark}/>}
      <ReadProgress/>
      <ScrollToTop/>
    </div>
  )
}

// ─── REPORT TAB ───────────────────────────────────────────────────────────────
// ─── TRAJECTORY (đánh giá tiến triển tổng thể) ─────────────────────────────────
function TrajectoryCard({ assessment }) {
  const [collapsed, setCollapsed] = useGlobalCollapse(false)
  const { verdict, evidence } = assessment
  const tm = TRAJECTORY_META[verdict]
  const TrendIcon = () => tm.icon === "up"
    ? <Svg d={20} color="#fff"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></Svg>
    : tm.icon === "down"
    ? <Svg d={20} color="#fff"><polyline points="3 7 9 13 13 9 21 17"/><polyline points="15 17 21 17 21 11"/></Svg>
    : <Svg d={20} color="#fff"><polyline points="3 15 9 12 13 13 21 8"/><polyline points="16 8 21 8 21 13"/></Svg>
  return (
    <div id="sec-trajectory" className="traj-card" style={{ background:tm.bg, borderColor:tm.border }}>
      <div className="traj-head">
        <div className="traj-badge" style={{ background:tm.color }}><TrendIcon/></div>
        <div>
          <div className="traj-lbl">Đánh giá tiến triển</div>
          <div className="traj-verdict" style={{ color:tm.color }}>{tm.label}</div>
        </div>
        <span style={{marginLeft:"auto"}}><CopyBtn text={safe} label=""/></span><button className="banner-collapse dark" onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Mở":"Thu gọn"} style={{ marginLeft:"8px" }}>
          {collapsed ? <Icon.ChevDown d={14} color={tm.color}/> : <Icon.ChevUp d={14} color={tm.color}/>}
        </button>
      </div>
      {!collapsed && (
      <ul className="traj-list">
        {evidence.map((e,i) => (
          <li key={i} className={e.good ? "good" : "bad"}>
            <span className="traj-mark" style={{ color: e.good ? "#059669" : "#DC2626" }}>{e.good ? "▲" : "▼"}</span>
            {e.txt}
          </li>
        ))}
      </ul>
      )}
    </div>
  )
}

// ─── DẢI MỐC THỜI GIAN BỆNH NHÂN (3 giai đoạn) ────────────────────────────────
function PatientTimeline({ info }) {
  const [collapsed, setCollapsed] = useGlobalCollapse(false)
  const fmt = (d) => d ? `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}` : "—"
  const stops = [
    { lbl:"Vào viện", date:info.admit },
    { lbl:"Phẫu thuật", date:info.surg },
    info.discharge ? { lbl:"Ra viện", date:info.discharge } : null,
    { lbl:"Hiện tại", date:info.current,
      sub: info.isOutpatient
        ? (info.relPostDischarge ? `${info.relPostDischarge} sau ra viện` : "")
        : (info.relPostOp ? `${info.relPostOp} sau mổ` : "") },
  ].filter(Boolean)
  return (
    <div id="sec-phase" className="pt-timeline">
      <div className="pt-status">
        <span className={`pt-status-badge ${info.isOutpatient ? "out" : "in"}`}>
          {info.isOutpatient ? "Ngoại trú / Theo dõi tái khám" : "Nội trú (chưa ra viện)"}
        </span>
        {info.isOutpatient && info.relPostDischarge && (
          <span className="pt-status-rel">Hiện tại là {info.relPostDischarge} sau ra viện{info.relPostOp?`, ${info.relPostOp} sau mổ`:""}</span>
        )}
        {!info.isOutpatient && info.relPostOp && (
          <span className="pt-status-rel">Hiện tại là {info.relPostOp} sau mổ</span>
        )}
        <button className="banner-collapse dark" onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Mở":"Thu gọn"} style={{ marginLeft:"auto" }}>
          {collapsed ? <Icon.ChevDown d={14} color="#1D6FE8"/> : <Icon.ChevUp d={14} color="#1D6FE8"/>}
        </button>
      </div>
      {!collapsed && (
      <div className="pt-track">
        {stops.map((s,i) => (
          <div key={i} className="pt-stop">
            <div className={`pt-dot ${s.lbl==="Hiện tại"?"now":""}`}/>
            <div className="pt-lbl">{s.lbl}</div>
            <div className="pt-date">{fmt(s.date)}</div>
            {s.sub && <div className="pt-sub">{s.sub}</div>}
          </div>
        ))}
      </div>
      )}
    </div>
  )
}

// ─── TÓM TẮT TOÀN CẢNH (chia 3 giai đoạn + đóng/mở) ───────────────────────────
const SUMMARY_PHASE_META = {
  1: { color:"#F59E0B", bg:"rgba(254,243,199,0.45)", border:"rgba(253,230,138,0.7)" },
  2: { color:"#EF4444", bg:"rgba(254,242,242,0.5)",  border:"rgba(254,202,202,0.7)" },
  3: { color:"#1D6FE8", bg:"rgba(235,244,255,0.5)",  border:"rgba(191,219,254,0.7)" },
}
function SummaryCard({ text }) {
  const [collapsed, setCollapsed] = useGlobalCollapse(false)
  const safe = typeof text === "string" ? text : (text == null ? "" : String(text))
  const toBullets = (body) => String(body || "").split(/(?<=\.)\s+/).map(s=>s.replace(/\.$/,"").trim()).filter(Boolean)
  if (!safe.trim()) return null
  // Tách theo marker "GIAI ĐOẠN ...:"
  const re = /GIAI ĐO[AẠ]N[^:]*:/gi
  const markers = [...safe.matchAll(re)]
  let blocks = []
  if (markers.length) {
    markers.forEach((m, i) => {
      const start = m.index + m[0].length
      const end = i+1 < markers.length ? markers[i+1].index : safe.length
      const rawTitle = m[0].replace(/:$/,"").replace(/GIAI ĐO[AẠ]N/i,"").trim()
      blocks.push({ phase: i+1, title: rawTitle, items: toBullets(safe.slice(start, end)) })
    })
  }
  return (
    <div id="sec-summary" className="summary-card">
      <div className="summary-hd">
        <Icon.FileText d={15} color="#1D6FE8"/>
        <span className="summary-hd-title">Tóm tắt toàn cảnh</span>
        <button className="banner-collapse dark" onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Mở":"Thu gọn"} style={{ marginLeft:"auto" }}>
          {collapsed ? <Icon.ChevDown d={14} color="#1D6FE8"/> : <Icon.ChevUp d={14} color="#1D6FE8"/>}
        </button>
      </div>
      {!collapsed && (
        blocks.length ? (
          <div className="summary-phases">
            {blocks.map(b => {
              const pm = SUMMARY_PHASE_META[b.phase] || SUMMARY_PHASE_META[3]
              return (
                <div key={b.phase} className="summary-phase" style={{ background:pm.bg, borderColor:pm.border }}>
                  <div className="summary-phase-hd">
                    <span className="summary-phase-num" style={{ background:pm.color }}>{b.phase}</span>
                    <span className="summary-phase-title" style={{ color:pm.color }}>{b.title}</span>
                  </div>
                  <ul className="bullet-list">
                    {b.items.map((s,i)=><li key={i}>{expandAbbr(s)}</li>)}
                  </ul>
                </div>
              )
            })}
          </div>
        ) : (
          <ul className="bullet-list">
            {toBullets(safe).map((s,i)=><li key={i}>{expandAbbr(s)}</li>)}
          </ul>
        )
      )}
    </div>
  )
}

// ─── GOM SỰ KIỆN THEO 3 GIAI ĐOẠN ─────────────────────────────────────────────
function echoLine(s) {
  const parts = []
  if (s.ef != null) parts.push(`EF ${s.ef}%`)
  if (s.grad_max != null) parts.push(`chênh áp ${s.grad_max}${s.grad_tb!=null?"/"+s.grad_tb:""} mmHg`)
  let head = parts.join(", ")
  const note = expandAbbr(s.ghi_chu || s.chan_doan || "")
  return head ? `${head}. ${note}` : note
}
function buildPhaseEvents(report, info) {
  const out = { 1:[], 2:[], 3:[] }
  ;(report.dien_bien_lam_sang || []).forEach(e => {
    const ph = phaseOf(e.ngay, info)
    if (ph) out[ph].push({ ngay:e.ngay, kind:"event", title:"Diễn biến lâm sàng", desc:e.mo_ta, loai:e.loai })
  })
  ;(report.sieu_am_tim?.lan_kham || []).forEach(s => {
    const ph = phaseOf(s.ngay, info)
    if (ph) out[ph].push({ ngay:s.ngay, kind:"echo", title:"Siêu âm tim", desc:echoLine(s), loai:s.canh_bao?"canh_bao":"binh_thuong", latest:s.latest })
  })
  ;[1,2,3].forEach(p => out[p].sort((a,b) => (parseVNDate(a.ngay)||0) - (parseVNDate(b.ngay)||0)))
  return out
}

const PHASE_SECTION_META = {
  1: { name:"Giai đoạn 1: Tiền phẫu / Trước can thiệp", short:"Giai đoạn 1 - Diễn biến tiền phẫu", color:"#8B5CF6", bg:"rgba(243,240,255,0.5)", border:"#DDD6FE" },
  2: { name:"Giai đoạn 2: Hậu phẫu nội trú",            short:"Giai đoạn 2 - Diễn biến hậu phẫu nội trú", color:"#EF4444", bg:"rgba(254,242,242,0.5)", border:"#FECACA" },
  3: { name:"Giai đoạn 3: Ngoại trú / Tái khám",        short:"Giai đoạn 3 - Theo dõi ngoại trú / Tái khám", color:"#10B981", bg:"rgba(240,253,250,0.5)", border:"#A7F3D0" },
}

// Dải mốc thời gian tương đối cho mỗi sự kiện trong giai đoạn
function relMarker(dateStr, phase, info) {
  const d = parseVNDate(dateStr)
  if (!d) return ""
  if (phase === 2 && info.surg) {
    if (info.discharge && d.getTime() === info.discharge.getTime()) return "Ra viện"
    const n = Math.round((d - info.surg)/86400000); return n>0?`Hậu phẫu ngày ${n}`:"Ngày mổ"
  }
  if (phase === 3 && info.discharge) { const n = Math.round((d - info.discharge)/86400000); return n>=0?`D+${n}`:"" }
  return ""
}

// Tính trạng thái thuốc (Đang dùng / Hoàn thành) từ ngày bắt đầu + số lượng + liều
function parseMedDate(s, info) {
  if (!s || s === "nay") return null
  const yr = info?.surg ? info.surg.getFullYear() : new Date().getFullYear()
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/)
  if (!m) return null
  return new Date(m[3] ? +m[3] : yr, +m[2]-1, +m[1])
}
function drugStatus(med, info) {
  if (med.keo_dai) return { txt:"Đang sử dụng", kind:"active" }
  const start = parseMedDate(med.bat_dau, info)
  let end = null
  if (med.ket_thuc && med.ket_thuc !== "nay") end = parseMedDate(med.ket_thuc, info)
  else if (start && med.so_luong && med.vien_moi_ngay) end = new Date(start.getTime() + Math.ceil(med.so_luong/med.vien_moi_ngay)*86400000)
  if (end && info?.current && end < info.current) return { txt:"Hoàn thành", kind:"done", end }
  if (end) return { txt:"Đang sử dụng", kind:"active" }
  return { txt:"Chưa rõ thời gian", kind:"unknown" }
}
const fmtShort = (d) => d ? `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}` : ""

function PhaseSection({ phase, events, info, ketLuan }) {
  const [collapsed, setCollapsed] = useGlobalCollapse(false)
  const bodyRef = useRef(null)
  const m = PHASE_SECTION_META[phase]
  const fmt = (d) => d ? `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}` : ""
  let rangeTxt = ""
  if (phase === 1 && info.surg) rangeTxt = `Trước ${fmt(info.surg)}`
  else if (phase === 2 && info.surg) rangeTxt = `${fmt(info.surg)} - ${fmt(info.discharge)} (${info.discharge&&info.surg?Math.round((info.discharge-info.surg)/86400000):"-"} ngày)`
  else if (phase === 3 && info.discharge) rangeTxt = `Từ ${fmt(info.discharge)} đến nay (${info.daysPostDischarge} ngày)`

  // Tách mô tả dài thành bullet
  const toBullets = (txt) => String(txt).split(/(?<=\.)\s+/).map(s=>s.trim().replace(/\.$/,"")).filter(Boolean)

  return (
    <div id={`sec-phase${phase}`} className="phase-sec" style={{ borderColor:m.border }} ref={bodyRef}>
      <div className="phase-sec-head">
        <span className="phase-sec-tag" style={{ background:m.color }}><i/>{m.name}</span>
        {rangeTxt && <span className="phase-sec-range">{rangeTxt}</span>}
        <span className="sec-tools" onClick={e=>e.stopPropagation()}>
          <FlagBtn pkey={CURRENT_PKEY} label={m.name} sub="Giai đoạn lâm sàng" detail={()=>elText(bodyRef.current)}/>
          <CopyBtn text={()=>elText(bodyRef.current)}/>
        </span>
        <button className="banner-collapse dark" onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Mở":"Thu gọn"} style={{ marginLeft:"6px" }}>
          {collapsed ? <Icon.ChevDown d={14} color={m.color}/> : <Icon.ChevUp d={14} color={m.color}/>}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="phase-tl">
            {events.map((e,i) => {
              const rel = relMarker(e.ngay, phase, info)
              const warn = e.loai === "canh_bao"
              const abn = e.loai === "bat_thuong"
              const dotColor = warn ? "#DC2626" : abn ? "#D97706" : m.color
              const bullets = toBullets(e.desc)
              return (
                <div key={i} className="phase-tl-row">
                  <div className="phase-tl-date">
                    <span className="phase-tl-day">{e.ngay}</span>
                    {rel && <span className="phase-tl-rel">{rel}</span>}
                  </div>
                  <div className="phase-tl-rail"><span className="phase-tl-dot" style={{ background:dotColor }}/></div>
                  <div className="phase-tl-card">
                    <div className="phase-tl-title">
                      {e.kind === "echo" ? <Icon.Ultrasound d={13} color={m.color}/> : <Icon.Calendar d={13} color={m.color}/>}
                      <span>{e.title}</span>
                      {warn && <span className="phase-ev-tag warn">Biến cố</span>}
                    </div>
                    {bullets.length > 1
                      ? <div className="phase-tl-chips">{bullets.map((b,j)=>(
                          <span key={j} className={`phase-chip${j===0?" lead":""}`} style={j===0?{borderColor:m.color+"55",color:m.color}:undefined}>{b}</span>
                        ))}</div>
                      : <div className="phase-tl-desc">{e.desc}</div>}
                  </div>
                </div>
              )
            })}
          </div>
          {ketLuan && (
            <div className="phase-ketluan" style={{ borderColor:m.color }}>
              <span className="phase-ketluan-lbl" style={{ color:m.color }}>Kết luận {`Giai đoạn ${phase}`}:</span> {ketLuan}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── BANNER TRẠNG THÁI LÂM SÀNG (4 thẻ tổng quan) ──────────────────────────────
function ClinicalStatusBanner({ info, report }) {
  const latestEcho = (report.sieu_am_tim?.lan_kham || []).filter(s=>s.latest)[0]
    || (report.sieu_am_tim?.lan_kham || []).slice(-1)[0]
  const fmt = (d) => d ? `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}` : "—"
  const weeks = (n) => n!=null ? `${Math.round(n/7)} tuần${n>=60?` / ${Math.floor(n/30)} tháng`:""}` : ""
  const cards = [
    { lbl:"Sau phẫu thuật", color:"#8B5CF6", big:info.daysPostOp!=null?`${info.daysPostOp}`:"—", unit:"ngày", num:true,
      sub:weeks(info.daysPostOp), foot:`${fmt(info.surg)} - ${(report.phau_thuat?.bac_si_phau_thuat||"").split("/")[0].trim()}` },
    { lbl:"Sau ra viện", color:"#10B981", big:info.daysPostDischarge!=null?`${info.daysPostDischarge}`:"—", unit:"ngày", num:true,
      sub:weeks(info.daysPostDischarge), foot:`Ra viện: ${fmt(info.discharge)}` },
    { lbl:"Trạng thái", color:"#D97706", big:info.isOutpatient?"Ngoại trú":"Nội trú", unit:"", num:false,
      sub:`Giai đoạn ${info.currentPhase}: ${info.isOutpatient?"Tái khám định kỳ":"Đang điều trị"}`, foot:"Tính theo ngày có xét nghiệm hoặc siêu âm gần nhất" },
    { lbl:"Tái khám gần nhất", color:"#1D6FE8", big:fmt(info.current), unit:"", num:false,
      sub:latestEcho?`Siêu âm tim ${latestEcho.nguon||""}`.trim():"",
      foot:latestEcho?`EF ${latestEcho.ef}%, chênh áp ${latestEcho.grad_max} mmHg - Van tốt`:"" },
  ]
  return (
    <div className="status-cards">
      {cards.map((c,i) => (
        <div key={i} className="status-card" style={{ borderColor:c.color+"33" }}>
          <div className="status-card-lbl" style={{ color:c.color }}>{c.lbl}</div>
          <div className={`status-card-big${c.num?" num":" text"}`}>{c.big}{c.unit && <span className="status-card-unit"> {c.unit}</span>}</div>
          {c.sub && <div className="status-card-sub">{c.sub}</div>}
          {c.foot && <div className="status-card-foot">{c.foot}</div>}
        </div>
      ))}
    </div>
  )
}

// ─── TRẠNG THÁI VẤN ĐỀ (Active / Monitoring / Resolved) ───────────────────────
const PROB_META = {
  active:     { label:"Đang hoạt động", color:"#059669" },
  monitoring: { label:"Cần theo dõi",   color:"#D97706" },
  urgent:     { label:"Cần xử lý ngay", color:"#DC2626" },
}
function ProblemStatus({ data, pkey }) {
  const [collapsed, setCollapsed] = useGlobalCollapse(false)
  if (!data) return null
  return (
    <div id="sec-problems" className="ov-card">
      <div className="ov-head">
        <Icon.Octagon d={16} color="#1D6FE8"/><span>Trạng thái vấn đề lâm sàng</span>
        <span style={{marginLeft:"auto",display:"inline-flex",gap:"6px",alignItems:"center"}}><FlagBtn pkey={CURRENT_PKEY} label="Trạng thái vấn đề lâm sàng" sub="Mục báo cáo" detail={()=>((data.hien_tai)||[]).map(p=>`${p.ten}: ${p.mo_ta||""}`).join("\n")}/><CopyBtn text={()=>((data.hien_tai)||[]).map(p=>`${p.ten}: ${p.mo_ta||""}`).join("\n")} label=""/></span>
        <button className="banner-collapse dark" onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Mở":"Thu gọn"} style={{ marginLeft:"6px" }}>
          {collapsed ? <Icon.ChevDown d={14} color="#1D6FE8"/> : <Icon.ChevUp d={14} color="#1D6FE8"/>}
        </button>
      </div>
      {!collapsed && (
        <div className="prob-wrap">
          <div className="prob-col">
            <div className="prob-col-hd">Vấn đề đang theo dõi</div>
            <div className="prob-list">
              {(data.hien_tai||[]).map((p,i)=>{
                const m = PROB_META[p.trang_thai] || PROB_META.monitoring
                return (
                  <div key={i} className="prob-item">
                    <span className="prob-dot" style={{ background:m.color }}/>
                    <div className="prob-body">
                      <div className="prob-top"><span className="prob-name">{p.ten}</span><span className="prob-tag" style={{ color:m.color, borderColor:m.color+"55" }}>{m.label}</span></div>
                      {p.mo_ta && <div className="prob-desc">{p.mo_ta}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="prob-col">
            <div className="prob-col-hd">Biến cố quan trọng đã qua</div>
            <div className="prob-list">
              {(data.da_qua||[]).map((p,i)=>(
                <div key={i} className="prob-item">
                  <span className="prob-dot" style={{ background:"#10B981" }}/>
                  <div className="prob-body">
                    <div className="prob-top"><span className="prob-name">{p.ten}</span><span className="prob-tag resolved">Đã hồi phục</span></div>
                    {p.mo_ta && <div className="prob-desc">{p.mo_ta}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function elText(el){ try { return el ? (el.innerText || el.textContent || "") : "" } catch { return "" } }
function bmKey(pkey){ return "mp_bm_" + (pkey||"x") }
function bmGet(pkey){ try{ return JSON.parse(sessionStorage.getItem(bmKey(pkey))||"[]") }catch{ return [] } }
function bmSet(pkey, arr){ try{ sessionStorage.setItem(bmKey(pkey), JSON.stringify(arr)) }catch{} ; if(typeof window!=="undefined") window.dispatchEvent(new CustomEvent("mp-bm",{detail:{pkey}})) }
function bmToggle(pkey, item){ const arr=bmGet(pkey); const i=arr.findIndex(x=>x.label===item.label); let added; if(i>=0){ arr.splice(i,1); added=false } else { arr.push({label:item.label, sub:item.sub||"", detail:item.detail||"", anchor:item.anchor||"", ts:Date.now()}); added=true } bmSet(pkey,arr); return added }
function bmHas(pkey,label){ return bmGet(pkey).some(x=>x.label===label) }
function FlagBtn({ pkey, label, sub, detail }){
  const [on,setOn]=useState(()=>bmHas(pkey,label))
  useEffect(()=>{ const h=()=>setOn(bmHas(pkey,label)); window.addEventListener("mp-bm",h); return ()=>window.removeEventListener("mp-bm",h) },[pkey,label])
  const toggle=(e)=>{ e.stopPropagation(); const d = typeof detail==="function" ? detail() : (detail||""); let anchor=""; try { const a2=e.currentTarget.closest("[id]"); anchor=a2?a2.id:"" } catch {} const a=bmToggle(pkey,{label,sub,detail:d,anchor}); mpToast(a?"Đã đánh dấu để theo dõi":"Đã bỏ đánh dấu") }
  return (
    <button className={`flag-btn${on?" on":""}`} onClick={toggle} title={on?"Bỏ đánh dấu":"Đánh dấu để theo dõi"} aria-label="Đánh dấu theo dõi">
      <svg width="13" height="13" viewBox="0 0 24 24" fill={on?"currentColor":"none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
    </button>
  )
}
function BookmarkPanel({ pkey, items, onClose, onGo }){
  const [openI, setOpenI] = useState(-1)
  return (
    <div className="bm-ov" onClick={onClose}>
      <div className="bm-panel" onClick={e=>e.stopPropagation()}>
        <div className="bm-head"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/></svg><span>Trang đã đánh dấu theo dõi</span>{items && items.length>0 && <CopyBtn text={()=>items.map(it=>"## "+it.label+"\n"+(it.detail||it.sub||"")).join("\n\n")} label=""/>}<button className="dn-x" onClick={onClose} aria-label="Đóng"><Icon.Close d={14} color="#64748B"/></button></div>
        <div className="bm-body">
          {(!items || items.length===0) && <div className="bm-empty">Chưa có mục nào được đánh dấu. Bấm biểu tượng cờ ở mỗi phần trong báo cáo (mọi chế độ) để thêm vào đây theo dõi.</div>}
          {items.map((it,i)=>(
            <div key={i} className={`bm-item${openI===i?" open":""}`}>
              <div className="bm-item-top" onClick={()=>setOpenI(openI===i?-1:i)}>
                <span className="bm-flag"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/></svg></span>
                <div className="bm-main"><div className="bm-label">{it.label}</div><div className="bm-sub">{it.sub||"Mục báo cáo"}</div></div>
                <button className="bm-go" onClick={(e)=>{e.stopPropagation(); onGo && onGo(it)}} title="Đi tới phần này trong báo cáo"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>
                <span className="bm-chev">{openI===i ? <Icon.ChevUp d={14} color="#94A3B8"/> : <Icon.ChevDown d={14} color="#94A3B8"/>}</span>
                <button className="bm-x" onClick={(e)=>{e.stopPropagation(); bmToggle(pkey,{label:it.label})}} title="Bỏ đánh dấu"><Icon.Close d={13} color="#94A3B8"/></button>
              </div>
              {openI===i && <div className="bm-detail">{it.detail ? it.detail : "Chưa lưu nội dung chi tiết cho mục này (đánh dấu từ bản cũ). Hãy bỏ đánh dấu rồi đánh dấu lại để lưu kèm nội dung."}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
function ClinicalTakeaway({ items, pkey }) {
  const [collapsed, setCollapsed] = useGlobalCollapse(false)
  if (!items || !items.length) return null
  return (
    <div id="sec-takeaway" className="takeaway-card">
      <div className="takeaway-hd"><Icon.Stethoscope d={15} color="#1D6FE8"/><span>Kết luận lâm sàng nhanh</span>
        <span style={{marginLeft:"auto",display:"inline-flex",gap:"6px",alignItems:"center"}}><FlagBtn pkey={CURRENT_PKEY} label="Kết luận lâm sàng nhanh" sub="Mục báo cáo" detail={()=>items.map(i=>i.txt).join("\n")}/><CopyBtn text={()=>items.map(i=>i.txt).join("\n")} label=""/></span>
        <button className="banner-collapse dark" onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Mở":"Thu gọn"} style={{ marginLeft:"6px" }}>
          {collapsed ? <Icon.ChevDown d={14} color="#1D6FE8"/> : <Icon.ChevUp d={14} color="#1D6FE8"/>}
        </button>
      </div>
      {!collapsed && (
        <ul className="takeaway-list">
          {items.map((t,i)=>(
            <li key={i} className={t.loai}>
              <span className="takeaway-mark" style={{ color:t.loai==="good"?"#059669":"#D97706" }}>{t.loai==="good"?"✓":"!"}</span>
              {t.txt}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── HÀNH ĐỘNG ƯU TIÊN (Next Actions) ─────────────────────────────────────────
function NextActions({ items }) {
  const [collapsed, setCollapsed] = useGlobalCollapse(false)
  if (!items || !items.length) return null
  return (
    <div id="sec-actions" className="next-actions">
      <div className="next-hd"><Icon.ShieldCheck d={16} color="#B45309"/><span>Hành động ưu tiên ở lần tái khám tới</span>
        <span style={{marginLeft:"auto",display:"inline-flex",gap:"6px",alignItems:"center"}}><FlagBtn pkey={CURRENT_PKEY} label="Hành động ưu tiên ở lần tái khám tới" sub="Mục báo cáo" detail={()=>items.map((a,i)=>`${i+1}. ${a.viec||""}${a.ly_do?" - "+a.ly_do:""}`).join("\n")}/><CopyBtn text={()=>items.map((a,i)=>`${i+1}. ${a.viec||""}${a.ly_do?" - "+a.ly_do:""}`).join("\n")} label=""/></span>
        <button className="banner-collapse dark" onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Mở":"Thu gọn"} style={{ marginLeft:"6px" }}>
          {collapsed ? <Icon.ChevDown d={14} color="#B45309"/> : <Icon.ChevUp d={14} color="#B45309"/>}
        </button>
      </div>
      {!collapsed && (
        <div className="next-list">
          {items.map((a,i) => (
            <div key={i} className="next-item">
              <span className="next-num">{a.uu_tien}</span>
              <div className="next-body">
                <div className="next-viec">{a.viec}</div>
                {a.ly_do && <div className="next-lydo">{a.ly_do}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── LÝ LUẬN LÂM SÀNG (multi-variable reasoning theo giai đoạn) ────────────────
const REASON_SEV = {
  critical: { label:"Quan trọng", color:"#DC2626", bg:"rgba(254,242,242,0.75)", border:"#FECACA" },
  warning:  { label:"Chú ý",      color:"#D97706", bg:"rgba(255,251,235,0.8)",  border:"#FDE68A" },
  info:     { label:"Thông tin",  color:"#1D6FE8", bg:"rgba(239,246,255,0.8)",  border:"#BFDBFE" },
}
const PHASE_TAG = {
  1: { label:"Giai đoạn 1", color:"#8B5CF6" },
  2: { label:"Giai đoạn 2", color:"#EF4444" },
  3: { label:"Giai đoạn 3", color:"#10B981" },
}
function ReasoningItem({ item }) {
  const [open, setOpen] = useState(true)
  const sv = REASON_SEV[item.muc] || REASON_SEV.info
  const pt = PHASE_TAG[item.phase]
  const bullets = String(item.noi_dung)
    .split(/(?<=\.)\s+|\s*•\s*|\n+/)
    .map(s => s.trim().replace(/^\s*([•·●○*]\s*|-\s+)/, "").replace(/\.$/, "").trim())
    .filter(Boolean)
  return (
    <div className="reason-item" style={{ background:sv.bg, borderColor:sv.border }}>
      <div className="reason-head" onClick={()=>setOpen(o=>!o)}>
        <span className="reason-sev" style={{ color:sv.color, borderColor:sv.border }}>
          <i style={{ background:sv.color }}/>{sv.label}
        </span>
        {pt && <span className="reason-phase" style={{ color:pt.color, borderColor:pt.color+"55" }}>
          <i style={{ background:pt.color }}/>{pt.label}
        </span>}
        <span className="reason-title">{item.tieu_de}</span>
        <span className="reason-chev">{open ? <Icon.ChevUp d={14} color="#7A96C8"/> : <Icon.ChevDown d={14} color="#7A96C8"/>}</span>
      </div>
      {open && (
        bullets.length > 1
          ? <ul className="reason-bullets">{bullets.map((b,j)=><li key={j}>{b}</li>)}</ul>
          : <div className="reason-body">{item.noi_dung}</div>
      )}
    </div>
  )
}
function ClinicalReasoning({ items }) {
  const [sev, setSev] = useState("all")
  const [ph, setPh] = useState("all")
  if (!items || !items.length) return null
  const shown = items.filter(it =>
    (sev === "all" || it.muc === sev) && (ph === "all" || String(it.phase) === ph))
  const sevSeg = [["all","Tất cả"],["critical","Quan trọng"],["warning","Chú ý"],["info","Thông tin"]]
  const phSeg = [["all","Mọi giai đoạn"],["1","Giai đoạn 1"],["2","Giai đoạn 2"],["3","Giai đoạn 3"]]
  return (
    <Card id="sec-reasoning" title="Biện luận lâm sàng theo giai đoạn" icon={<Icon.Brain d={16}/>}>
      <div className="reason-filters">
        <div className="echo-seg lab-seg">
          {sevSeg.map(([k,lbl]) => <button key={k} className={sev===k?"on":""} onClick={()=>setSev(k)}>{lbl}</button>)}
        </div>
        <div className="echo-seg lab-seg">
          {phSeg.map(([k,lbl]) => <button key={k} className={ph===k?"on":""} onClick={()=>setPh(k)}>{lbl}</button>)}
        </div>
      </div>
      <div className="reason-list">
        {shown.length === 0
          ? <div style={{fontSize:13,color:"#7A96C8",padding:"6px 2px"}}>Không có mục nào thuộc bộ lọc này.</div>
          : shown.map((it,i) => <ReasoningItem key={i} item={it}/>)}
      </div>
    </Card>
  )
}

// ─── LAB PANEL (lọc Cao / Bình thường / Thấp + nhận xét xu hướng) ───────────────
const GLOSSARY = {
  EF:"Phân suất tống máu thất trái (Ejection Fraction). Bình thường 55-70%. Phản ánh khả năng bơm máu của tim.",
  INR:"Chỉ số đông máu chuẩn hóa quốc tế. Theo dõi khi dùng kháng vitamin K. Van cơ học thường mục tiêu 2.0-3.0.",
  NTPROBNP:"Chỉ điểm sinh học của suy tim. Tăng cao khi tim quá tải hoặc suy tim nặng hơn.",
  BNP:"Peptide lợi niệu type B, chỉ điểm suy tim. Tăng khi tim chịu áp lực hoặc thể tích quá mức.",
  CRP:"Protein phản ứng C, dấu ấn viêm. Bình thường dưới 5 mg/L. Tăng trong nhiễm khuẩn hoặc viêm.",
  WBC:"Số lượng bạch cầu. Tăng gợi ý nhiễm khuẩn hoặc viêm cấp.",
  HB:"Huyết sắc tố (Hemoglobin). Giảm là thiếu máu, ảnh hưởng vận chuyển oxy.",
  PLT:"Số lượng tiểu cầu, liên quan đông cầm máu.",
  CREA:"Creatinin huyết thanh, phản ánh chức năng lọc của thận. Tăng gợi ý suy giảm chức năng thận.",
  EGFR:"Mức lọc cầu thận ước tính, đánh giá chức năng thận và liều thuốc thải qua thận.",
  NA:"Natri máu, rối loạn điện giải hay gặp ở bệnh nhân tim mạch, suy tim.",
  K:"Kali máu, ảnh hưởng nhịp tim. Cả tăng và giảm đều nguy hiểm.",
  TROPONIN:"Dấu ấn tổn thương cơ tim. Tăng trong nhồi máu cơ tim hoặc tổn thương tim.",
  LACTATE:"Lactat máu, tăng khi giảm tưới máu mô hoặc sốc.",
  DDIMER:"Sản phẩm thoái giáng fibrin, tăng khi có huyết khối hoặc đông máu hoạt hóa.",
  AST:"Men gan (aspartate transaminase), tăng khi tổn thương gan hoặc cơ.",
  ALT:"Men gan (alanine transaminase), đặc hiệu hơn cho tế bào gan.",
  GLUCOSE:"Đường huyết, theo dõi đái tháo đường và stress chuyển hóa.",
  HBA1C:"Đường huyết trung bình 2-3 tháng, đánh giá kiểm soát đái tháo đường.",
  PT:"Thời gian prothrombin, đánh giá con đường đông máu ngoại sinh.",
  APTT:"Thời gian thromboplastin hoạt hóa, đánh giá con đường đông máu nội sinh.",
}
function glossKey(t){ return String(t||"").toUpperCase().replace(/[^A-Z0-9]/g,"") }
function TermTip({ term, children }){
  const tip = GLOSSARY[glossKey(term)]
  if(!tip) return <>{children}</>
  return (
    <span className="term-tip" tabIndex={0}>
      {children}<span className="term-q">?</span>
      <span className="term-pop">{tip}</span>
    </span>
  )
}
const LAB_SYSTEM = { "EF":"tim", "NT-proBNP":"tim", "INR":"tim", "Creatinin":"than", "Na+":"than", "K+":"than", "CRP":"nhiem", "WBC":"nhiem", "HGB":"huyet", "PLT":"huyet", "Albumin":"huyet" }
const SYS_LABEL = { tim:"Tim mạch", than:"Thận - điện giải", nhiem:"Nhiễm khuẩn", huyet:"Huyết học" }
function LabPanel({ labs, note }) {
  const [filter, setFilter] = useState("all")
  const [sysFilter, setSysFilter] = useState("all")
  const counts = { high:0, normal:0, low:0 }
  labs.forEach(m => counts[m.status]++)
  const sysPresent = {}
  labs.forEach(m => { const s = LAB_SYSTEM[m.key]; if(s) sysPresent[s] = (sysPresent[s]||0)+1 })
  const sysSeg = [["all","Tất cả",labs.length], ...Object.keys(SYS_LABEL).filter(s=>sysPresent[s]).map(s=>[s,SYS_LABEL[s],sysPresent[s]])]
  const shown = labs.filter(m => (filter==="all"||m.status===filter) && (sysFilter==="all"||LAB_SYSTEM[m.key]===sysFilter))
  const seg = [
    ["all","Tất cả",labs.length],
    ["high","Cao",counts.high],
    ["normal","Bình thường",counts.normal],
    ["low","Thấp",counts.low],
  ]
  const filterBar = (
    <div className="echo-seg lab-seg">
      {seg.map(([k,lbl,n]) => (
        <button key={k} className={filter===k?"on":""} onClick={()=>setFilter(k)}>{lbl} <span className="lab-filter-n">{n}</span></button>
      ))}
    </div>
  )
  return (
    <Card id="sec-labs" title="Xét nghiệm - giá trị gần nhất" icon={<Icon.Flask d={16}/>} headRight={filterBar}>
      <div className="lab-clarify">Mỗi chỉ số hiển thị theo ngày lấy mẫu gần nhất của nó. Nhiều giá trị (CRP, NT-proBNP, Na+) là kết quả tại thời điểm ra viện (03/10/2025 - Giai đoạn 2), chưa có xét nghiệm ngoại trú mới, cần đối chiếu giai đoạn khi diễn giải.</div>
      <div className="lab-legend">
        <span><b>Mũi tên</b> = xu hướng so với lần trước (↑ tăng, ↓ giảm)</span>
        <span><b className="lab-status high" style={{padding:"1px 6px"}}>Màu</b> = mức giá trị (đỏ Cao, cam Thấp, xanh Bình thường)</span>
      </div>
      <div className="lab-sysbar">
        <span className="lab-sysbar-lbl">Hệ cơ quan</span>
        <div className="lab-sysbar-chips">
          {sysSeg.map(([k,lbl,n]) => (
            <button key={k} className={"lab-sys-chip"+(sysFilter===k?" on":"")} onClick={()=>setSysFilter(k)}>{lbl} <span className="lab-filter-n">{n}</span></button>
          ))}
        </div>
      </div>
      {shown.length===0 && <div className="lab-empty">Không có chỉ số nào khớp bộ lọc hiện tại.</div>}
      <div className="lab-grid">
        {shown.map(m => {
          const arrowChar = m.arrow==="up"?"↑":m.arrow==="down"?"↓":"→"
          const sparkColor = m.status==="high"?"#DC2626":m.status==="low"?"#EA580C":"#16A34A"
          const verdict = labVerdict(m)
          const isINR = m.key === "INR"
          const statusTxt = isINR
            ? (m.status==="high"?"Trên mục tiêu":m.status==="low"?"Dưới mục tiêu":"Trong mục tiêu")
            : (m.status==="high"?"Cao":m.status==="low"?"Thấp":"Bình thường")
          const rangeLabel = isINR ? "Mục tiêu" : "Bình thường"
          return (
            <div key={m.key} className="lab-cell">
              <div className="lab-top">
                <TermTip term={m.key}><span className="lab-key">{m.key}</span></TermTip>
                <span className={`lab-status ${m.status}`}>{statusTxt}</span>
              </div>
              <div className="lab-val-row">
                <span className="lab-val"><CountUp value={parseFloat(m.val)} decimals={(String(m.rawVal).split(".")[1]||"").length} suffix={(m.val.split(" ")[0].match(/[^0-9.,\-]+$/)||[""])[0]}/></span>
                <span className={`lab-arrow ${m.arrow}`}>{arrowChar}</span>
                {m.unit&&<span className="lab-unit">{m.unit}</span>}
              </div>
              <div className="lab-spark"><Sparkline values={m.trend} color={sparkColor} fluid height={28} dates={m.trendDates}/></div>
              {m.trendDates && m.trendDates.length >= 2 && m.trend && m.trend.length === m.trendDates.length && (
                <div className="lab-spark-dates">
                  {m.trendDates.map((d,di)=>{
                    const n = m.trendDates.length
                    const left = (di/(n-1))*100
                    const style = di===0 ? {left:"0%",transform:"none"} : di===n-1 ? {left:"100%",transform:"translateX(-100%)"} : {left:`${left}%`,transform:"translateX(-50%)"}
                    return <span key={di} className="lab-spark-date" style={style}>{d}</span>
                  })}
                </div>
              )}
              {verdict && <div className={`lab-verdict ${verdict.neutral?"neutral":verdict.good?"good":"bad"}`}>{verdict.txt}</div>}
              <div className="lab-foot">
                <span className="lab-desc">{(m.trendDates && m.trendDates.length) ? `Lấy mẫu: ${m.trendDates[m.trendDates.length-1]}` : (m.ngay ? `Ngày ${m.ngay}` : m.desc)}</span>
                <span className="lab-normal">{rangeLabel} {m.normal}</span>
              </div>
            </div>
          )
        })}
        {shown.length === 0 && <div className="lab-empty">Không có chỉ số nào ở mức này.</div>}
      </div>
      {note && <div style={{fontSize:11,color:"#7A96C8",marginTop:10,paddingTop:10,borderTop:"1px solid rgba(200,220,255,0.3)"}}>Ghi chú: {note}</div>}
    </Card>
  )
}

// ─── PRIORITY ALERTS BANNER ────────────────────────────────────────────────────
function PriorityBanner({ findings, onSource, pkey }) {
  const [collapsed, setCollapsed] = useGlobalCollapse(false)
  const [tierFilter, setTierFilter] = useState(null)
  const byTier = { critical:[], warning:[], stable:[] }
  findings.forEach(f => byTier[f.muc].push(f))

  return (
    <div id="sec-priority" className="prio-wrap">
      <div className="prio-head">
        <div className="prio-head-l"><Icon.Layers d={17} color="#fff"/><span>Phân tầng ưu tiên lâm sàng</span></div>
        <div className="prio-head-r">
          <div className="prio-counts">
            {["critical","warning","stable"].map(t => (
              <button key={t} className={`prio-count${tierFilter===t?" on":""}`} style={{ color:TIER_META[t].color }} onClick={()=>setTierFilter(f=>f===t?null:t)} title={tierFilter===t?"Bỏ lọc":`Chỉ xem mức ${TIER_META[t].label}`}>
                <i style={{ background:TIER_META[t].color }}/>{byTier[t].length} {TIER_META[t].label}
              </button>
            ))}
            {tierFilter && <button className="prio-count clear" onClick={()=>setTierFilter(null)} title="Xem tất cả">Tất cả</button>}
          </div>
          <button className="banner-collapse" onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Mở":"Thu gọn"}>
            {collapsed ? <Icon.ChevDown d={14} color="#fff"/> : <Icon.ChevUp d={14} color="#fff"/>}
          </button>
        </div>
      </div>
      {!collapsed && (
      <div className={`prio-board${tierFilter?" one":""}`}>
        {["critical","warning","stable"].filter(t=>!tierFilter||t===tierFilter).map(tier => {
          const tm = TIER_META[tier]
          const items = byTier[tier]
          return (
            <div key={tier} className="prio-col" style={{ borderColor:tm.border }}>
              <div className="prio-col-head" style={{ background:tm.bg, color:tm.color }}>
                <span className="prio-col-dot">{tm.dot}</span>{tm.label}
                <span className="prio-col-n">{items.length}</span>
              </div>
              <div className="prio-col-body">
                {items.length === 0 && <div className="prio-col-empty">Không có mục nào</div>}
                {items.map((f,i) => (
                  <div key={i} className="prio-box">
                    <div className="prio-box-name">{f.ten}</div>
                    <div className="prio-box-reason"><span className="prio-box-lbl">Lý do:</span> {f.ly_do}</div>
                    {f.nguon && <button className="prio-src" onClick={()=>onSource(`${f.ly_do} — Nguồn: ${f.nguon}`)}>{f.nguon}</button>}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}

// ─── CÔNG THỨC eGFR DẠNG TOÁN HỌC ─────────────────────────────────────────────
function EgfrMathFormula({ female }) {
  const Frac = ({ n, d }) => (
    <span className="mf-frac"><span className="mf-num">{n}</span><span className="mf-den">{d}</span></span>
  )
  return (
    <div className="mf">
      <span className="mf-var"><i>eGFR</i></span>
      <span className="mf-op">=</span>
      <span>142</span>
      <span className="mf-op">×</span>
      <span>min<span style={{fontSize:"0.9em"}}>(</span><Frac n={<i>Scr</i>} d={<i>κ</i>}/>, 1<span style={{fontSize:"0.9em"}}>)</span><span className="mf-sup"><i>α</i></span></span>
      <span className="mf-op">×</span>
      <span>max<span style={{fontSize:"0.9em"}}>(</span><Frac n={<i>Scr</i>} d={<i>κ</i>}/>, 1<span style={{fontSize:"0.9em"}}>)</span><span className="mf-sup">−1.200</span></span>
      <span className="mf-op">×</span>
      <span>0.9938<span className="mf-sup"><i>Tuổi</i></span></span>
      {female && (<><span className="mf-op">×</span><span>1.012</span></>)}
    </div>
  )
}

// ─── DRUG SAFETY CARD ──────────────────────────────────────────────────────────
function DrugSafetyCard({ safety, egfr, egfrDetail, onSource }) {
  const { interactions, renalFlags, favorable, duplicateGroups } = safety
  const total = interactions.length + renalFlags.length + (duplicateGroups||[]).length
  const d = egfrDetail || {}
  return (
    <Card id="sec-drug" title="Kiểm tra an toàn đơn thuốc" icon={<Icon.Shield d={16}/>}>
      <div className="drug-egfr">
        <div className="drug-egfr-box">
          <div className="drug-egfr-lbl">Chức năng thận (eGFR ước tính, CKD-EPI 2021)</div>
          {egfr == null ? (
            <div className="drug-egfr-val">
              <span className="drug-egfr-tag warn">Chưa tính được</span>
              <span className="drug-egfr-unit" style={{ marginLeft:8 }}>thiếu Creatinin hoặc tuổi/giới</span>
            </div>
          ) : (
            <div className="drug-egfr-val">
              <span className="drug-egfr-num"><CountUp value={egfr}/></span>
              <span className="drug-egfr-unit">mL/phút/1.73m²</span>
              <span className={`drug-egfr-tag ${egfr>=60?"ok":egfr>=30?"warn":"crit"}`}>
                {egfr>=90?"Bình thường":egfr>=60?"Giảm nhẹ":egfr>=30?"Giảm vừa":"Giảm nặng"}
              </span>
            </div>
          )}
          {egfr != null && (
            <div className="egfr-detail">
              <EgfrMathFormula female={d.sex === "Nữ"}/>
              <div className="egfr-inputs">
                <span><b>Scr (Creatinin):</b> {d.creatinine_umol} µmol/L{d.creatinine_mgdl!=null?` = ${d.creatinine_mgdl} mg/dL`:""}</span>
                <span><b>Tuổi:</b> {d.age}</span>
                <span><b>Giới:</b> {d.sex}</span>
                {d.k!=null && <span><b>κ:</b> {d.k}</span>}
                {d.alpha!=null && <span><b>α:</b> {d.alpha}</span>}
              </div>
            </div>
          )}
          <div className="drug-egfr-note">Công thức CKD-EPI 2021 race-free. Dùng để đánh giá nhu cầu chỉnh liều thuốc thải qua thận.</div>
        </div>
      </div>

      {total === 0 && favorable.length === 0 && (
        <div className="drug-empty">Không phát hiện tương tác hoặc cảnh báo chỉnh liều trong đơn thuốc hiện tại.</div>
      )}

      {interactions.length > 0 && (
        <div className="drug-section">
          <div className="drug-section-hd">Tương tác thuốc ({interactions.length})</div>
          {interactions.map((it,i) => {
            const tm = TIER_META[it.muc]
            return (
              <div key={i} className="drug-alert" style={{ background:tm.bg, borderColor:tm.border }}>
                <div className="drug-alert-top">
                  <span className="drug-pair">{it.thuoc_a} <span className="drug-x">+</span> {it.thuoc_b}</span>
                  <span className="drug-level" style={{ color:tm.color }}>{tm.dot} {tm.label}</span>
                </div>
                <div className="drug-conseq">{it.hau_qua}</div>
                <div className="drug-suggest"><strong>Đề xuất:</strong> {it.de_xuat}</div>
                {it.nguon && <button className="prio-src" onClick={()=>onSource(`${it.thuoc_a} + ${it.thuoc_b}: ${it.hau_qua} — Nguồn: ${it.nguon}`)}>{it.nguon}</button>}
              </div>
            )
          })}
        </div>
      )}

      {renalFlags.length > 0 && (
        <div className="drug-section">
          <div className="drug-section-hd">Chỉnh liều theo chức năng thận ({renalFlags.length})</div>
          {renalFlags.map((rf,i) => {
            const tm = TIER_META[rf.muc]
            return (
              <div key={i} className="drug-alert" style={{ background:tm.bg, borderColor:tm.border }}>
                <div className="drug-alert-top">
                  <span className="drug-pair">{rf.thuoc}</span>
                  <span className="drug-level" style={{ color:tm.color }}>{tm.dot} {tm.label}</span>
                </div>
                <div className="drug-conseq">{rf.note} (eGFR hiện tại: {rf.egfr})</div>
                {rf.nguon && <button className="prio-src" onClick={()=>onSource(`${rf.thuoc}: ${rf.note} — Nguồn: ${rf.nguon}`)}>{rf.nguon}</button>}
              </div>
            )
          })}
        </div>
      )}

      {(duplicateGroups||[]).length > 0 && (
        <div className="drug-section">
          <div className="drug-section-hd">Trùng nhóm thuốc ({duplicateGroups.length})</div>
          {duplicateGroups.map((dg,i) => (
            <div key={i} className="drug-alert" style={{ background:TIER_META.warning.bg, borderColor:TIER_META.warning.border }}>
              <div className="drug-alert-top">
                <span className="drug-pair">{dg.thuoc_a} <span className="drug-x">+</span> {dg.thuoc_b}</span>
                <span className="drug-level" style={{ color:TIER_META.warning.color }}>{TIER_META.warning.dot} Cùng nhóm: {dg.nhom}</span>
              </div>
              <div className="drug-conseq">{dg.ghi_chu}</div>
            </div>
          ))}
        </div>
      )}

      {favorable.length > 0 && (
        <div className="drug-section">
          <div className="drug-section-hd">Phù hợp khuyến cáo ({favorable.length})</div>
          {favorable.map((fv,i) => (
            <div key={i} className="drug-alert" style={{ background:TIER_META.stable.bg, borderColor:fv.than_trong?"#FDE68A":TIER_META.stable.border }}>
              <div className="drug-alert-top">
                <span className="drug-pair">{fv.thuoc}</span>
                <span className="drug-level" style={{ color:TIER_META.stable.color }}>🟢 Phù hợp guideline</span>
              </div>
              <div className="drug-conseq"><b>Lợi ích:</b> {fv.note}</div>
              {fv.than_trong && (
                <div className="drug-caution"><b>⚠ Thận trọng:</b> {fv.than_trong}</div>
              )}
              {fv.nguon && <button className="prio-src" onClick={()=>onSource(`${fv.thuoc}: ${fv.note}${fv.than_trong?" | Thận trọng: "+fv.than_trong:""} — Nguồn: ${fv.nguon}`)}>{fv.nguon}</button>}
            </div>
          ))}
        </div>
      )}

      <div className="drug-disclaimer">Kết quả mang tính hỗ trợ, bác sĩ điều trị quyết định cuối cùng. Mọi đề xuất cần được xem xét trước khi áp dụng.</div>
    </Card>
  )
}

// Hàng riêng cho 1 mục trong bảng điểm: hiện rõ "có/không/không xác định"
function RiskScoreRow({ item }) {
  return (
    <div className={`risk-row${item.co ? " on" : ""}`}>
      <span className="risk-row-chip" style={item.co ? { background: "#FEF2F2", color: "#DC2626", borderColor: "#FECACA" } : { background: "#F1F5F9", color: "#64748B", borderColor: "#E2E8F0" }}>
        {item.co ? `+${item.diem_neu_co}` : "+0"}
      </span>
      <div className="risk-row-body">
        <div className="risk-row-name">{item.ten}</div>
        <div className="risk-row-note">{item.ghi_chu}</div>
      </div>
    </div>
  )
}

function RiskScoreGauge({ value, max, label, color }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div className="risk-gauge">
      <div className="risk-gauge-top">
        <span className="risk-gauge-lbl">{label}</span>
        <span className="risk-gauge-val" style={{ color }}><CountUp value={value}/>/{max}</span>
      </div>
      <div className="risk-gauge-track">
        <div className="risk-gauge-fill" style={{ width: `${pct}%`, background: color }}/>
      </div>
    </div>
  )
}

// Thang điểm CHA2DS2-VASc + HAS-BLED. Chỉ hiển thị khi backend (rule engine
// tất định) đã trả risk_scores qua analysis — không tự tính lại ở client để
// tránh có 2 nguồn kết quả khác nhau cho cùng một bệnh nhân.
function RiskScoresCard({ riskScores, ttr, onSource }) {
  if (!riskScores && !ttr) return null
  const cv = riskScores && riskScores.cha2ds2_vasc
  const hb = riskScores && riskScores.has_bled
  if (!cv && !hb && !ttr) return null

  return (
    <Card id="sec-risk" title="Thang điểm nguy cơ (chống đông)" icon={<Icon.Shield d={16}/>}>
      <div className="risk-disclaimer-top">
        Hỗ trợ quyết định, không tự kê đơn hoặc chỉnh liều chống đông. Mọi điểm số cần bác sĩ xác nhận trước khi áp dụng.
      </div>

      {cv && (
        <div className="risk-block">
          <div className="risk-block-hd">
            <span>{cv.ten_thang_diem}</span>
            <span className="risk-block-sub">Nguy cơ đột quỵ / huyết khối ở rung nhĩ</span>
          </div>
          <RiskScoreGauge value={cv.tong_diem} max={cv.thang_diem_toi_da} label="Tổng điểm" color={cv.tong_diem>=2?"#DC2626":cv.tong_diem===1?"#D97706":"#059669"}/>
          {cv.mechanical_valve && (
            <div className="risk-context-alert">
              <Icon.Alert d={14} color="#DC2626"/>
              <span>{cv.canh_bao_boi_canh}</span>
            </div>
          )}
          {!cv.mechanical_valve && (
            <div className="risk-context-note">{cv.canh_bao_boi_canh}</div>
          )}
          <div className="risk-rows">
            {cv.chi_tiet.map((it,i) => <RiskScoreRow key={i} item={it}/>)}
          </div>
          <button className="prio-src" onClick={()=>onSource(`${cv.ten_thang_diem}: tổng ${cv.tong_diem}/${cv.thang_diem_toi_da} điểm — Nguồn: ${cv.nguon_guideline}`)}>{cv.nguon_guideline}</button>
        </div>
      )}

      {hb && (
        <div className="risk-block">
          <div className="risk-block-hd">
            <span>{hb.ten_thang_diem}</span>
            <span className="risk-block-sub">Nguy cơ chảy máu khi dùng chống đông</span>
          </div>
          <RiskScoreGauge value={hb.tong_diem} max={hb.thang_diem_toi_da} label="Tổng điểm" color={hb.muc_nguy_co==="cao"?"#DC2626":"#059669"}/>
          <div className="risk-context-note">{hb.dien_giai_muc_nguy_co}</div>
          <div className="risk-rows">
            {hb.chi_tiet.map((it,i) => <RiskScoreRow key={i} item={it}/>)}
          </div>
          <button className="prio-src" onClick={()=>onSource(`${hb.ten_thang_diem}: tổng ${hb.tong_diem}/${hb.thang_diem_toi_da} điểm — Nguồn: ${hb.nguon_guideline}`)}>{hb.nguon_guideline}</button>
        </div>
      )}

      {ttr && (
        <div className="risk-block">
          <div className="risk-block-hd">
            <span>TTR — Time in Therapeutic Range</span>
            <span className="risk-block-sub">% thời gian INR trong đích điều trị</span>
          </div>
          <RiskScoreGauge value={ttr.ttr_percent} max={100} label="TTR" color={ttr.canh_bao_thap?"#DC2626":"#059669"}/>
          <div className="risk-context-note">{ttr.dien_giai}</div>
          <div className="risk-rows">
            <div className="risk-row">
              <span className="risk-row-chip" style={{background:"#F1F5F9",color:"#64748B",borderColor:"#E2E8F0"}}>{ttr.so_lan_do}</span>
              <div className="risk-row-body">
                <div className="risk-row-name">Tổng số lần đo INR</div>
                <div className="risk-row-note">Đích điều trị: {ttr.dich_dieu_tri} — {ttr.so_lan_trong_dich} lần trong đích</div>
              </div>
            </div>
            {ttr.cac_lan_ngoai_dich.length > 0 && (
              <div className="risk-row on">
                <span className="risk-row-chip" style={{background:"#FEF2F2",color:"#DC2626",borderColor:"#FECACA"}}>{ttr.cac_lan_ngoai_dich.length}</span>
                <div className="risk-row-body">
                  <div className="risk-row-name">Lần ngoài đích</div>
                  <div className="risk-row-note">{ttr.cac_lan_ngoai_dich.map(o=>`${o.gia_tri} (${o.huong==="duoi_dich"?"dưới đích":"trên đích"})`).join(", ")}</div>
                </div>
              </div>
            )}
          </div>
          <div className="drug-disclaimer">{ttr.phuong_phap}</div>
        </div>
      )}

      <div className="drug-disclaimer">Biến đầu vào dò từ chẩn đoán/tiền sử trong hồ sơ; mục ghi "không xác định" nghĩa là hồ sơ không nêu rõ, KHÔNG phải bệnh nhân chắc chắn không có.</div>
    </Card>
  )
}

// Care-gap detector: khoảng trống theo guideline (mục 9-B3). Tất định 100%,
// chỉ hiển thị khi backend trả care_gaps qua analysis — không tự tính ở
// client (logic phụ thuộc parse ngày dd/mm/yyyy + so sánh ngày hiện tại,
// không phù hợp port sang JS chỉ để demo offline).
function CareGapCard({ careGaps, onSource }) {
  if (!careGaps || careGaps.length === 0) return null
  const sevOrder = { cao: 0, trung_binh: 1, thap: 2 }
  const sorted = [...careGaps].sort((a,b) => (sevOrder[a.muc_do]??9) - (sevOrder[b.muc_do]??9))
  const sevMeta = {
    cao: { label: "Ưu tiên cao", color: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
    trung_binh: { label: "Trung bình", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
    thap: { label: "Theo dõi", color: "#64748B", bg: "#F8FAFC", border: "#E2E8F0" },
  }
  return (
    <Card id="sec-caregap" title="Khoảng trống theo guideline" icon={<Icon.Octagon d={16}/>}>
      <div className="risk-disclaimer-top">
        Danh sách dữ liệu/xét nghiệm hệ thống chưa thấy trong hồ sơ — không có nghĩa là chắc chắn thiếu, chỉ là chưa thấy. Bác sĩ tự xác nhận có cần bổ sung.
      </div>
      <div className="risk-rows">
        {sorted.map((g,i) => {
          const sm = sevMeta[g.muc_do] || sevMeta.thap
          return (
            <div key={i} className="drug-alert" style={{ background:sm.bg, borderColor:sm.border }}>
              <div className="drug-alert-top">
                <span className="drug-pair">{g.tieu_de}</span>
                <span className="drug-level" style={{ color:sm.color }}>{sm.label}</span>
              </div>
              <div className="drug-conseq">{g.ly_do}</div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ─── HERO STATUS (dải trạng thái tổng quan để bác sĩ hiểu trong 15 giây) ───────────────
function HeroStatus({ info, findings, trajectory }) {
  const tm = TRAJECTORY_META[trajectory.verdict] || TRAJECTORY_META.on_dinh
  const byTier = { critical:0, warning:0, stable:0 }
  ;(findings || []).forEach(f => { if (byTier[f.muc] != null) byTier[f.muc]++ })
  const phaseColor = { 1:"#8B5CF6", 2:"#EF4444", 3:"#10B981" }[info.currentPhase] || "#1B5FCB"
  const phaseName = { 1:"Giai đoạn 1 · Tiền phẫu", 2:"Giai đoạn 2 · Hậu phẫu nội trú", 3:"Giai đoạn 3 · Ngoại trú tái khám" }[info.currentPhase] || "Diễn biến lâm sàng"
  const rel = info.isOutpatient
    ? (info.relPostDischarge ? `${info.relPostDischarge} sau ra viện` : "")
    : (info.relPostOp ? `${info.relPostOp} sau mổ` : "")
  const TrendIcon = () => tm.icon === "up"
    ? <Svg d={18} color="#fff"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></Svg>
    : tm.icon === "down"
    ? <Svg d={18} color="#fff"><polyline points="3 7 9 13 13 9 21 17"/><polyline points="15 17 21 17 21 11"/></Svg>
    : <Svg d={18} color="#fff"><polyline points="3 15 9 12 13 13 21 8"/><polyline points="16 8 21 8 21 13"/></Svg>
  return (
    <div className="hero-status" style={{ ["--hero-accent"]: phaseColor }}>
      <div className="hero-status-phase">
        <span className="hs-phase-tag"><span className="hs-phase-dot" style={{ background:phaseColor }}/>{phaseName}</span>
        {rel && <span className="hs-phase-sub">Hiện tại: {rel}</span>}
      </div>
      <div className="hero-status-verdict">
        <span className="hs-verdict-icon" style={{ background:tm.color }}><TrendIcon/></span>
        <div>
          <div className="hs-verdict-lbl">Đánh giá tiến triển</div>
          <div className="hs-verdict-txt" style={{ color:tm.color }}>{tm.label}</div>
        </div>
      </div>
      <div className="hero-status-counts">
        {["critical","warning","stable"].map(tier => {
          const t = TIER_META[tier]
          return (
            <div key={tier} className="hs-count" style={{ background:t.bg, borderColor:t.border }} title={t.full}>
              <span className="hs-count-n" style={{ color:t.color }}>{byTier[tier]}</span>
              <span className="hs-count-lbl" style={{ color:t.color }}>{t.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PatientSnapshot({ report }){
  const [show, setShow] = useState(false)
  useEffect(() => {
    const on = () => setShow(window.scrollY > 200)
    window.addEventListener("scroll", on, { passive:true }); on()
    return () => window.removeEventListener("scroll", on)
  }, [])
  const p = (report && report.thong_tin_benh_nhan) || {}
  let ef = null
  const lk = report && report.sieu_am_tim && report.sieu_am_tim.lan_kham
  if(lk && lk.length){ for(let i=lk.length-1;i>=0;i--){ if(lk[i] && lk[i].ef!=null){ ef=lk[i].ef; break } } }
  const highAlerts = ((report && report.canh_bao_nguy_co) || []).filter(c=>c.muc_do==="cao").length
  return (
    <div className={`psnap${show?" show":""}`} onClick={()=>window.scrollTo({top:0,behavior:"smooth"})} title="Lên đầu trang" style={{cursor:"pointer"}}>
      <div className="psnap-inner">
        <span className="psnap-name">{p.ho_ten || "Bệnh nhân"}</span>
        {(p.tuoi || p.gioi_tinh) && <span className="psnap-meta">{p.tuoi?`${p.tuoi} tuổi`:""}{p.tuoi&&p.gioi_tinh?" · ":""}{p.gioi_tinh||""}</span>}
        {report && report.chan_doan_chinh && <span className="psnap-dx" title={report.chan_doan_chinh}>{report.chan_doan_chinh}</span>}
        <span className="psnap-chips">
          {ef!=null && <span className="psnap-chip ef">EF {ef}%</span>}
          {highAlerts>0 && <span className="psnap-chip alert">{highAlerts} cảnh báo cao</span>}
        </span>
      </div>
    </div>
  )
}
function ReadProgress(){
  const [pct, setPct] = useState(0)
  useEffect(() => {
    const on = () => {
      const h = document.documentElement
      const max = h.scrollHeight - h.clientHeight
      setPct(max > 0 ? Math.min(100, (h.scrollTop / max) * 100) : 0)
    }
    window.addEventListener("scroll", on, { passive:true }); on()
    return () => window.removeEventListener("scroll", on)
  }, [])
  return <div className="read-progress"><div className="read-progress-bar" style={{ width: pct + "%" }}/></div>
}
function TimelineStrip({ events }){
  const scrollRef = useRef(null)
  const [focus, setFocus] = useState(-1)
  if(!events || events.length < 2) return null
  const tone = (l) => l==="canh_bao" ? {c:"#DC2626",bg:"#FEE2E2",t:"Cảnh báo"} : l==="bat_thuong" ? {c:"#D97706",bg:"#FEF3C7",t:"Theo dõi"} : {c:"#0E9488",bg:"#D1FAE5",t:"Ổn định"}
  const flags = events.map((e,i)=>({i,f:(e.loai==="canh_bao"||e.loai==="bat_thuong")})).filter(x=>x.f).map(x=>x.i)
  const jump = (dir) => {
    if(!flags.length) return
    let next
    if(dir>0){ next = flags.find(i=>i>focus); if(next==null) next=flags[0] }
    else { const prev=flags.filter(i=>i<focus); next = prev.length?prev[prev.length-1]:flags[flags.length-1] }
    setFocus(next)
    const sc=scrollRef.current; if(!sc) return
    const item=sc.querySelectorAll(".tls-item")[next]
    if(item){ item.scrollIntoView({inline:"center",block:"nearest",behavior:"smooth"}); item.classList.add("tls-flash"); setTimeout(()=>item.classList.remove("tls-flash"),1200) }
  }
  return (
    <div className="tls-card" id="sec-timeline">
      <div className="tls-head"><Icon.Clock d={15} color="#1D6FE8"/><span>Dòng thời gian diễn biến</span><span className="tls-hint">cuộn ngang để xem</span>{flags.length>0 && <span className="tls-nav" onClick={e=>e.stopPropagation()}><button className="tls-nav-btn" onClick={()=>jump(-1)} title="Biến cố trước"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button><span className="tls-nav-lbl">{flags.length} biến cố</span><button className="tls-nav-btn" onClick={()=>jump(1)} title="Biến cố tiếp"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg></button></span>}<span className="sec-tools" onClick={e=>e.stopPropagation()}><FlagBtn pkey={CURRENT_PKEY} label="Dòng thời gian diễn biến" sub="Tổng quan diễn biến" detail={()=>(events||[]).map(e=>(e.ngay||"")+": "+(e.mo_ta||"")).join("\n")}/><CopyBtn text={()=>(events||[]).map(e=>(e.ngay||"")+": "+(e.mo_ta||"")).join("\n")}/></span></div>
      <div className="tls-scroll" ref={scrollRef}>
        <div className="tls-track">
          {events.map((e,i)=>{ const tn=tone(e.loai); return (
            <div className="tls-item" key={i}>
              <div className="tls-date">{e.ngay}</div>
              <div className="tls-dotwrap"><span className="tls-dot" style={{background:tn.c}}/></div>
              <div className="tls-box">
                <span className="tls-tag" style={{color:tn.c,background:tn.bg}}>{tn.t}</span>
                <span className="tls-txt">{e.mo_ta}</span>
              </div>
            </div>
          )})}
        </div>
      </div>
    </div>
  )
}
// ─── TỔNG QUAN NHANH (one-glance: marker trends + giai đoạn + ưu tiên) ─────────
const CO_KEYS = ["EF","CRP","INR","NT-proBNP","Creatinin","Na+"]
function CoStat({ m }) {
  const tr = (m.trend || []).filter(v => typeof v === "number")
  const col = m.status === "normal" ? "#22C55E" : m.status === "high" ? "#EF4444" : "#F59E0B"
  const W = 72, H = 24, P = 3
  let path = "", last = null
  if (tr.length > 1) {
    const mn = Math.min(...tr), mx = Math.max(...tr), rng = (mx - mn) || 1
    const pts = tr.map((v, i) => [P + i * (W - 2*P) / (tr.length - 1), H - P - ((v - mn) / rng) * (H - 2*P)])
    path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ")
    last = pts[pts.length - 1]
  }
  return (
    <div className="co-stat">
      <div className="co-stat-top"><span className="co-stat-key">{m.key}</span><span className="co-stat-dot" style={{ background: col }}/></div>
      <div className="co-stat-val">{m.val}</div>
      <svg className="co-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} preserveAspectRatio="none">
        {tr.length > 1 && <path d={path} fill="none" stroke={col} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>}
        {last && <circle cx={last[0]} cy={last[1]} r="2.6" fill={col}/>}
      </svg>
      <div className="co-stat-norm">BT {m.normal}</div>
    </div>
  )
}
function CaseOverview({ report: r, findings, phaseInfo, pkey }) {
  const labs = r.xet_nghiem_meta || r.xet_nghiem_key || []
  const markers = CO_KEYS.map(k => labs.find(l => l && l.key === k)).filter(Boolean)
  const crit = (findings || []).filter(f => f.muc === "critical").length
  const warn = (findings || []).filter(f => f.muc === "warning").length
  const prios = (r.hanh_dong_uu_tien || []).slice().sort((a,b) => (a.uu_tien||9) - (b.uu_tien||9)).slice(0, 3)
  const phaseLabel = ["", "Tiền phẫu", "Hậu phẫu nội trú", "Ngoại trú tái khám"][phaseInfo.currentPhase] || ""
  const detail = "Giai đoạn " + phaseInfo.currentPhase + ": " + phaseLabel + ". "
    + markers.map(m => m.key + " " + m.val).join(", ") + ". "
    + (prios.length ? "Ưu tiên: " + prios.map(p => p.viec).join("; ") : "")
  return (
    <section id="sec-overview" className="co-wrap">
      <div className="co-head">
        <span className="co-h-title"><Icon.Pulse d={15} color="#1D6FE8"/> TỔNG QUAN NHANH</span>
        <span className="co-phase">Giai đoạn {phaseInfo.currentPhase}: {phaseLabel}</span>
        {(crit > 0 || warn > 0) && (
          <span className="co-alerts">
            {crit > 0 && <span className="co-alert co-alert-crit">{crit} cần xử lý</span>}
            {warn > 0 && <span className="co-alert co-alert-warn">{warn} theo dõi</span>}
          </span>
        )}
        <div className="co-head-r">
          <FlagBtn pkey={pkey} label="Tổng quan nhanh" sub="" detail={detail}/>
          <CopyBtn text={detail}/>
        </div>
      </div>
      {markers.length > 0 && <div className="co-grid">{markers.map((m, i) => <CoStat key={i} m={m}/>)}</div>}
      {prios.length > 0 && (
        <div className="co-prios">
          <span className="co-prios-lbl">Ưu tiên xử lý</span>
          <ol className="co-prio-list">{prios.map((p, i) => <li key={i}>{p.viec}</li>)}</ol>
        </div>
      )}
    </section>
  )
}

// ─── SO SÁNH HAI MỐC XÉT NGHIỆM (visit diff) ──────────────────────────────────
function TriArrow({ dir }) {
  if (!dir) return null
  return <svg width="8" height="8" viewBox="0 0 8 8" style={{ flexShrink: 0 }}>
    {dir > 0 ? <path d="M4 1 L7 6 L1 6 Z" fill="currentColor"/> : <path d="M4 7 L1 2 L7 2 Z" fill="currentColor"/>}
  </svg>
}
function VisitCompare({ report: r }) {
  const labs = (r.xet_nghiem_meta || r.xet_nghiem_key || []).filter(l =>
    l && Array.isArray(l.trend) && Array.isArray(l.trendDates) && l.trend.length === l.trendDates.length && l.trend.length > 1)
  const order = []
  labs.forEach(l => l.trendDates.forEach(d => { if (!order.includes(d)) order.push(d) }))
  const [a, setA] = useState(order[0] || "")
  const [b, setB] = useState(order[order.length - 1] || "")
  if (order.length < 2) return <div className="vc-empty">Chưa đủ dữ liệu nhiều mốc để so sánh.</div>
  const rnd = v => Math.round(v * 100) / 100
  const valAt = (l, d) => { const i = l.trendDates.indexOf(d); return i >= 0 ? l.trend[i] : null }
  const rows = labs.map(l => ({ l, va: valAt(l, a), vb: valAt(l, b) })).filter(x => x.va != null || x.vb != null)
  return (
    <div className="vc">
      <div className="vc-pickers">
        <label className="vc-pick"><span>Mốc A</span><select value={a} onChange={e => setA(e.target.value)}>{order.map(d => <option key={d} value={d}>{d}</option>)}</select></label>
        <svg width="20" height="12" viewBox="0 0 20 12" className="vc-sep"><path d="M1 6 H17 M13 2 L18 6 L13 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <label className="vc-pick"><span>Mốc B</span><select value={b} onChange={e => setB(e.target.value)}>{order.map(d => <option key={d} value={d}>{d}</option>)}</select></label>
      </div>
      <div className="vc-table">
        <div className="vc-row vc-thead"><span>Chỉ số</span><span>{a}</span><span>Thay đổi</span><span>{b}</span></div>
        {rows.map((x, i) => {
          const { l, va, vb } = x
          let delta = null, pct = null, dir = 0
          if (va != null && vb != null) { delta = rnd(vb - va); if (va !== 0) pct = (vb - va) / Math.abs(va) * 100; dir = delta > 0 ? 1 : delta < 0 ? -1 : 0 }
          return (
            <div key={i} className="vc-row">
              <span className="vc-key">{l.key}{l.unit ? <em>{l.unit}</em> : null}</span>
              <span className="vc-val">{va != null ? va : "—"}</span>
              <span className={"vc-delta" + (dir > 0 ? " up" : dir < 0 ? " down" : "")}>
                {delta != null
                  ? <><TriArrow dir={dir}/>{(delta > 0 ? "+" : "") + delta}{pct != null ? " (" + (pct > 0 ? "+" : "") + pct.toFixed(0) + "%)" : ""}</>
                  : "—"}
              </span>
              <span className="vc-val">{vb != null ? vb : "—"}</span>
            </div>
          )
        })}
      </div>
      <div className="vc-note">Giá trị lấy đúng mốc đo; "—" nghĩa là chỉ số không đo ở mốc đó. Tăng/giảm chỉ thể hiện chiều thay đổi, không hàm ý tốt/xấu.</div>
    </div>
  )
}

// ─── CHECKLIST VIỆC CẦN LÀM (tương tác, lưu trạng thái theo bệnh nhân) ─────────
function FollowupChecklist({ items, pkey }) {
  const skey = "mp_chk_" + (pkey || "x")
  const [done, setDone] = useState(() => { try { return JSON.parse(sessionStorage.getItem(skey) || "[]") } catch { return [] } })
  if (!items || !items.length) return null
  const toggle = (i) => setDone(prev => {
    const next = prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]
    try { sessionStorage.setItem(skey, JSON.stringify(next)) } catch {}
    return next
  })
  const total = items.length
  const completed = done.filter(i => i < total).length
  const pct = total ? Math.round(completed / total * 100) : 0
  const detail = items.map((a, i) => `[${done.includes(i) ? "x" : " "}] ${a.viec || ""}${a.ly_do ? " - " + a.ly_do : ""}`).join("\n")
  return (
    <section id="sec-checklist" className="ckl-wrap">
      <div className="ckl-head">
        <span className="ckl-title"><Icon.Layers d={15} color="#1D6FE8"/> VIỆC CẦN LÀM</span>
        <span className="ckl-prog-txt">{completed}/{total} xong</span>
        <div className="ckl-bar"><div className="ckl-bar-fill" style={{ width: pct + "%" }}/></div>
        <span className="sec-tools" onClick={e => e.stopPropagation()}>
          <FlagBtn pkey={pkey} label="Việc cần làm" sub="Theo dõi tiến độ" detail={detail}/>
          <CopyBtn text={detail}/>
        </span>
      </div>
      <ul className="ckl-list">
        {items.map((a, i) => {
          const checked = done.includes(i)
          return (
            <li key={i} className={"ckl-item" + (checked ? " done" : "")} onClick={() => toggle(i)} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(i) } }}>
              <span className="ckl-box" aria-hidden="true">
                {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>}
              </span>
              <div className="ckl-body">
                <div className="ckl-viec">{a.viec}</div>
                {a.ly_do && <div className="ckl-ly">{a.ly_do}</div>}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ─── BIỂU ĐỒ XU HƯỚNG TỔNG HỢP (% so với lần đo đầu, đa chỉ số) ────────────────
const MT_COLORS = ["#1D6FE8","#EF4444","#F59E0B","#0E9488","#8B5CF6","#EC4899","#0EA5E9","#65A30D"]
function MultiTrend({ report: r }) {
  const labs = (r.xet_nghiem_meta || r.xet_nghiem_key || []).filter(l =>
    l && Array.isArray(l.trend) && l.trend.length > 1 && l.trend.every(v => typeof v === "number") && l.trend[0] !== 0)
  const colorOf = k => MT_COLORS[labs.findIndex(x => x.key === k) % MT_COLORS.length]
  const defaults = labs.filter(l => ["CRP","NT-proBNP","WBC"].includes(l.key)).map(l => l.key)
  const [sel, setSel] = useState(defaults.length ? defaults : labs.slice(0, 3).map(l => l.key))
  if (labs.length < 1) return <div className="vc-empty">Chưa đủ dữ liệu xu hướng để vẽ.</div>
  const toggle = k => setSel(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k])
  const series = labs.filter(l => sel.includes(l.key)).map(l => {
    const first = l.trend[0]
    const pts = l.trend.map((v, i) => ({ x: l.trend.length > 1 ? i / (l.trend.length - 1) : 0, y: v / first * 100 }))
    return { key: l.key, unit: l.unit, color: colorOf(l.key), pts, last: l.trend[l.trend.length - 1], lastPct: Math.round(l.trend[l.trend.length-1]/first*100) }
  })
  const allY = series.flatMap(s => s.pts.map(p => p.y))
  const maxY = Math.max(140, ...(allY.length ? allY : [140])) * 1.04
  const W = 620, H = 250, PADL = 46, PADR = 16, PADT = 14, PADB = 30
  const ix = x => PADL + x * (W - PADL - PADR)
  const iy = y => PADT + (1 - y / maxY) * (H - PADT - PADB)
  const yTicks = [0, 50, 100].concat(maxY > 250 ? [200, 400].filter(v => v < maxY) : maxY > 150 ? [150] : [])
  return (
    <div className="mt">
      <div className="mt-chips">
        {labs.map(l => (
          <button key={l.key} className={"mt-chip" + (sel.includes(l.key) ? " on" : "")} onClick={() => toggle(l.key)}
            style={sel.includes(l.key) ? { borderColor: colorOf(l.key), color: colorOf(l.key) } : undefined}>
            <span className="mt-chip-dot" style={{ background: colorOf(l.key) }}/>{l.key}
          </button>
        ))}
      </div>
      <svg className="mt-svg" viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet">
        {yTicks.map(v => (
          <g key={v}>
            <line x1={PADL} y1={iy(v)} x2={W - PADR} y2={iy(v)} style={{stroke:"var(--border)"}} strokeWidth="1" strokeDasharray={v === 100 ? "0" : "3 3"}/>
            <text x={PADL - 6} y={iy(v) + 3} textAnchor="end" fontSize="9" style={{fill:"var(--muted2)"}}>{v}%</text>
          </g>
        ))}
        <text x={PADL} y={H - 8} fontSize="9" style={{fill:"var(--muted2)"}}>Lần đo đầu</text>
        <text x={W - PADR} y={H - 8} fontSize="9" style={{fill:"var(--muted2)"}} textAnchor="end">Gần nhất</text>
        {series.map(s => {
          const d = s.pts.map((p, i) => (i ? "L" : "M") + ix(p.x).toFixed(1) + " " + iy(p.y).toFixed(1)).join(" ")
          const lp = s.pts[s.pts.length - 1]
          return (
            <g key={s.key}>
              <path d={d} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              {s.pts.map((p, i) => <circle key={i} cx={ix(p.x)} cy={iy(p.y)} r="2.6" fill={s.color}/>)}
              <text x={ix(lp.x) - 3} y={iy(lp.y) - 6} fontSize="9.5" fontWeight="700" fill={s.color} textAnchor="end">{s.lastPct}%</text>
            </g>
          )
        })}
      </svg>
      <div className="mt-note">Mỗi đường = giá trị theo % so với lần đo đầu của chính chỉ số đó (lần đầu = 100%). Dùng để so sánh tốc độ cải thiện/xấu đi giữa các chỉ số có đơn vị khác nhau. Trục ngang theo thứ tự lần đo, không theo khoảng cách ngày thực.</div>
    </div>
  )
}

function ReportTab({ report: r, analysis }) {
  const [tlFilter, setTlFilter] = useState("all")
  const [modalSource, setModalSource] = useState(null)
  const [alertsCollapsed, setAlertsCollapsed] = useGlobalCollapse(false)
  const alertsHigh = (r.canh_bao_nguy_co || []).filter(c => c.muc_do === "cao")
  const filtered = (r.dien_bien_lam_sang || []).filter(ev => tlFilter === "all" || ev.loai === tlFilter)
  CURRENT_PKEY = (r.thong_tin_benh_nhan && r.thong_tin_benh_nhan.so_benh_an) || "x"
  useEffect(() => {
    let reduce = false
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches } catch {}
    if(reduce || typeof IntersectionObserver === "undefined") return
    const sel = ".report-main .card,.report-main .takeaway-card,.report-main .ov-card,.report-main .prio-wrap,.report-main .tls-card,.report-main .summary-card"
    const nodes = Array.from(document.querySelectorAll(sel))
    if(!nodes.length) return
    const vh = window.innerHeight || 800
    nodes.forEach(n => {
      const top = n.getBoundingClientRect().top
      if(top < vh * 0.92) n.classList.add("reveal", "in")
      else n.classList.add("reveal")
    })
    const io = new IntersectionObserver((ents) => {
      ents.forEach(e => { if(e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target) } })
    }, { rootMargin: "0px 0px -7% 0px" })
    nodes.forEach(n => { if(!n.classList.contains("in")) io.observe(n) })
    const t = setTimeout(() => nodes.forEach(n => n.classList.add("in")), 1900)
    return () => { io.disconnect(); clearTimeout(t) }
  }, [])

  // Nguồn chân lý: rule engine backend (Bước 2) nếu có; nếu không (demo) thì tính client-side.
  let findings, egfr, safety, egfrDetail
  let riskScores = null
  let ttr = null
  let careGaps = []
  if (analysis) {
    findings = analysis.priority_findings || []
    egfr = analysis.egfr
    egfrDetail = analysis.egfr_detail || null
    const ds = analysis.drug_safety || {}
    safety = { interactions: ds.interactions || [], renalFlags: ds.renal_flags || [], favorable: ds.favorable || [], duplicateGroups: ds.duplicate_groups || [] }
    riskScores = analysis.risk_scores || null
    ttr = analysis.ttr || null
    careGaps = analysis.care_gaps || []
  } else {
    const s = runPriorityScreens(r)
    findings = s.findings; egfr = s.egfr
    safety = checkDrugSafety(r.thuoc_cuoi_ky || [], egfr, s.ctx)
    const creatLab = (r.xet_nghiem_key||r.xet_nghiem_meta||[]).find(l => /creatinin/i.test(l.key))
    egfrDetail = buildEgfrDetail(creatLab?.rawVal, r.thong_tin_benh_nhan?.tuoi, /nam/i.test(r.thong_tin_benh_nhan?.gioi_tinh||""))
    // Demo offline (không backend): tính risk_scores bằng bản JS port để
    // RiskScoresCard vẫn hiện được — xem ghi chú đầy đủ tại computeRiskScoresClient().
    // ttr/careGaps KHÔNG port sang JS (cần parse ngày dd/mm/yyyy + so sánh với
    // "hôm nay", ít giá trị demo offline so với rủi ro lệch logic) — ở demo
    // offline, 2 Card này tự ẩn (đúng theo thiết kế null-safe của chúng).
    riskScores = computeRiskScoresClient(r)
  }
  const trajectory = assessTrajectory(r)
  const phaseInfo = computePhaseInfo(r)
  const phaseEvents = buildPhaseEvents(r, phaseInfo)
  // Lý luận lâm sàng: ưu tiên dữ liệu soạn sẵn; nếu không có (hồ sơ thật) thì dựng từ rule engine
  const reasoningItems = (r.ly_luan_lam_sang && r.ly_luan_lam_sang.length)
    ? r.ly_luan_lam_sang
    : findings.filter(f => f.muc !== "stable").map(f => ({
        muc: f.muc === "critical" ? "critical" : f.muc === "warning" ? "warning" : "info",
        phase: phaseInfo.currentPhase, tieu_de: f.ten, noi_dung: `${f.ly_do} (Nguồn: ${f.nguon})`,
      }))
  const trendSummary = analysis?.trend_summary || null

  // Donut: phản ánh TRẠNG THÁI VẤN ĐỀ (tách biến cố đã hồi phục khỏi vấn đề hiện tại).
  // Ưu tiên problem_status; nếu hồ sơ thật thiếu thì rơi về mức nguy cơ HIỆN TẠI từ findings.
  const ps = r.problem_status
  let segActive, segMonitor, segResolved, donutLegend
  if (ps) {
    segActive   = (ps.hien_tai||[]).filter(p=>p.trang_thai==="active").length
    segMonitor  = (ps.hien_tai||[]).filter(p=>p.trang_thai!=="active").length
    segResolved = (ps.da_qua||[]).length
    donutLegend = [["#1D6FE8","Đang hoạt động",segActive],["#F59E0B","Cần theo dõi",segMonitor],["#22C55E","Đã hồi phục",segResolved]]
  } else {
    segActive   = findings.filter(f=>f.muc==="critical").length
    segMonitor  = findings.filter(f=>f.muc==="warning").length
    segResolved = findings.filter(f=>f.muc==="stable").length
    donutLegend = [["#EF4444","Cần xử lý",segActive],["#F59E0B","Theo dõi",segMonitor],["#22C55E","Ổn định",segResolved]]
  }
  const donutData = donutLegend.map(([color,,value]) => ({ value, color }))
  const donutCurrent = segActive + segMonitor   // số vấn đề CÒN tồn tại (không tính đã hồi phục)

  return (
    <div className="report-stack">
      {modalSource && <SourceModal source={modalSource} onClose={()=>setModalSource(null)}/>}

      {/* Banner */}
      <div className="banner">
        <div className="banner-top">
          <div className="banner-row">
            <div>
              <div className="banner-ba">Số bệnh án: {r.thong_tin_benh_nhan.so_benh_an}</div>
              <div className="banner-name">{r.thong_tin_benh_nhan.ho_ten}</div>
              <div className="banner-info">{r.thong_tin_benh_nhan.tuoi} tuổi • {r.thong_tin_benh_nhan.gioi_tinh} • {r.thong_tin_benh_nhan.dia_chi}</div>
              <div className="banner-dob">Ngày sinh: {r.thong_tin_benh_nhan.ngay_sinh}</div>
            </div>
            <div className="banner-dates">
              {[["Vào viện",r.thong_tin_benh_nhan.ngay_vao_vien],["Ra viện",r.thong_tin_benh_nhan.ngay_ra_vien]].map(([lbl,val])=>(
                <div key={lbl} className="date-row"><span className="date-lbl">{lbl}</span><span className="date-val">{val}</span></div>
              ))}
            </div>
          </div>
        </div>
        {/* Donut + legend: vấn đề còn tồn tại vs đã hồi phục (không trộn lẫn) */}
        <div className="banner-donut">
          <DonutChart data={donutData} size={64} centerValue={donutCurrent} centerLabel="vấn đề"/>
          <div className="donut-legend">
            {donutLegend.map(([c,l,v])=>(
              <div key={l} className="donut-item"><span className="donut-dot" style={{background:c}}/>{l}: {v}</div>
            ))}
          </div>
          <div style={{marginLeft:"auto",textAlign:"right"}}>
            <div className="diag-lbl">Chẩn đoán chính</div>
            <div className="diag-val" style={{maxWidth:360}}>{expandAbbr(r.chan_doan_chinh)}</div>
          </div>
        </div>
      </div>

      {/* Dải trạng thái 15 giây: giai đoạn + đánh giá tiến triển + đếm cảnh báo (sau thông tin bệnh nhân) */}
      <HeroStatus info={phaseInfo} findings={findings} trajectory={trajectory}/>

      <CaseOverview report={r} findings={findings} phaseInfo={phaseInfo} pkey={r.thong_tin_benh_nhan && r.thong_tin_benh_nhan.so_benh_an}/>

      {/* Banner trạng thái + Kết luận nhanh + Trạng thái vấn đề + Hành động */}
      <div id="sec-status"><ClinicalStatusBanner info={phaseInfo} report={r}/></div>
      <TimelineStrip events={r.dien_bien_lam_sang}/>
      {r.clinical_takeaway && <ClinicalTakeaway items={r.clinical_takeaway} pkey={r.thong_tin_benh_nhan && r.thong_tin_benh_nhan.so_benh_an}/>}

      {r.problem_status && <ProblemStatus data={r.problem_status} pkey={r.thong_tin_benh_nhan && r.thong_tin_benh_nhan.so_benh_an}/>}
      {r.hanh_dong_uu_tien && r.hanh_dong_uu_tien.length > 0 && <NextActions items={r.hanh_dong_uu_tien}/>}
      {r.hanh_dong_uu_tien && r.hanh_dong_uu_tien.length > 0 && <FollowupChecklist items={r.hanh_dong_uu_tien} pkey={r.thong_tin_benh_nhan && r.thong_tin_benh_nhan.so_benh_an}/>}

      {/* BA GIAI ĐOẠN (chỉ khi xác định được mốc phẫu thuật) */}
      {phaseInfo.surg ? (
        [1,2,3].map(p => phaseEvents[p] && phaseEvents[p].length > 0
          ? <PhaseSection key={p} phase={p} events={phaseEvents[p]} info={phaseInfo} ketLuan={r.ket_luan_giai_doan?.[p]}/>
          : null)
      ) : (
        // Hồ sơ không phải ca phẫu thuật: gộp diễn biến vào một dòng thời gian
        (() => {
          const all = [...(phaseEvents[1]||[]), ...(phaseEvents[2]||[]), ...(phaseEvents[3]||[])]
          const allEvents = (r.dien_bien_lam_sang||[]).map(e=>({ngay:e.ngay,kind:"event",title:"Diễn biến lâm sàng",desc:e.mo_ta,loai:e.loai}))
            .concat((r.sieu_am_tim?.lan_kham||[]).map(s=>({ngay:s.ngay,kind:"echo",title:"Siêu âm tim",desc:echoLine(s),loai:s.canh_bao?"canh_bao":"binh_thuong"})))
            .sort((a,b)=>(parseVNDate(a.ngay)||0)-(parseVNDate(b.ngay)||0))
          return allEvents.length > 0
            ? <Card id="sec-phase1" title="Diễn biến lâm sàng theo thời gian" icon={<Icon.Calendar d={16}/>}>
                <div className="phase-tl">
                  {allEvents.map((e,i)=>(
                    <div key={i} className="phase-tl-row">
                      <div className="phase-tl-date"><span className="phase-tl-day">{e.ngay}</span></div>
                      <div className="phase-tl-rail"><span className="phase-tl-dot" style={{background:e.loai==="canh_bao"?"#DC2626":e.loai==="bat_thuong"?"#D97706":"#1D6FE8"}}/></div>
                      <div className="phase-tl-card">
                        <div className="phase-tl-title">{e.kind==="echo"?<Icon.Ultrasound d={13} color="#1D6FE8"/>:<Icon.Calendar d={13} color="#1D6FE8"/>}<span>{e.title}</span></div>
                        <div className="phase-tl-desc">{e.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            : null
        })()
      )}

      {/* PHÂN TÍCH: Chẩn đoán hình ảnh */}
      <Card id="sec-echo" title="Chẩn đoán hình ảnh qua 3 giai đoạn" icon={<Icon.Ultrasound d={16}/>}>
        <EchoTimeline sieu_am={r.sieu_am_tim} info={phaseInfo}/>
        <EchoCompare sieu_am={r.sieu_am_tim}/>
        <EchoSessionTable sieu_am={r.sieu_am_tim}/>
      </Card>

      {/* PHÂN TÍCH: Lý luận lâm sàng */}
      <ClinicalReasoning items={reasoningItems}/>
      <Card id="sec-compare" title="So sánh hai mốc xét nghiệm" icon={<Icon.Flask d={16}/>}><VisitCompare report={r}/></Card>
      <Card id="sec-trend" title="Xu hướng tổng hợp (% so với lần đầu)" icon={<Icon.Pulse d={16}/>}><MultiTrend report={r}/></Card>

      {/* PHÂN TÍCH: Xét nghiệm */}
      <LabPanel labs={r.xet_nghiem_key||r.xet_nghiem_meta||[]} note={r.xet_nghiem_truoc_mo?.ghi_chu}/>

      {/* PHÂN TÍCH: Thuốc */}
      <Card id="sec-meds" title="Đơn thuốc và lịch dùng" icon={<Icon.Pill d={16}/>}>
        <div className="grid2">
          {r.thuoc_cuoi_ky.map((t,i)=>{
            const st = drugStatus(t, phaseInfo)
            return (
            <div key={i} className="med-item">
              <div className="med-icon"><Icon.Pill d={16} color="#1D6FE8"/></div>
              <div style={{flex:1,minWidth:0}}>
                <div className="med-name">{t.ten_thuoc}</div>
                <div className="med-nhom">{t.nhom}</div>
                <div className="med-dose">{t.lieu} • {t.cach_dung}</div>
                {(st.kind !== "unknown" || t.bat_dau) && (
                  <div className="med-status-row">
                    {st.kind !== "unknown" && <span className={`med-status ${st.kind}`}>{st.txt}</span>}
                    {t.bat_dau && <span className="med-period">Từ {t.bat_dau}{st.end?` đến ${fmtShort(st.end)}`:t.ket_thuc&&t.ket_thuc!=="nay"?` đến ${t.ket_thuc}`:""}</span>}
                  </div>
                )}
              </div>
            </div>
          )})}
        </div>
        <MedGantt meds={r.thuoc_cuoi_ky}/>
      </Card>

      <PriorityBanner findings={findings || []} onSource={setModalSource} pkey={r.thong_tin_benh_nhan && r.thong_tin_benh_nhan.so_benh_an}/>

      {/* PHÂN TÍCH: eGFR + an toàn đơn thuốc */}
      <DrugSafetyCard safety={safety} egfr={egfr} egfrDetail={egfrDetail} onSource={setModalSource}/>

      {/* PHÂN TÍCH: Thang điểm nguy cơ chống đông (chỉ hiện khi backend trả risk_scores) */}
      <RiskScoresCard riskScores={riskScores} ttr={ttr} onSource={setModalSource}/>

      {/* PHÂN TÍCH: Khoảng trống theo guideline (chỉ hiện khi backend trả care_gaps) */}
      <CareGapCard careGaps={careGaps} onSource={setModalSource}/>

      {/* Tóm tắt toàn cảnh */}
      <SummaryCard text={r.tom_tat_toan_canh}/>
      <LogoBar compact/>
    </div>
  )
}

// ─── CHAT TAB ─────────────────────────────────────────────────────────────────
const DEMO_CHAT = {
  "biến chứng": "Sau mổ, bệnh nhân có **phản ứng viêm nặng sau phẫu thuật**:\n- CRP tăng rất cao: 241.42 mg/L ngay ngày 26/09 sau mổ\n- Giảm dần nhưng vẫn còn 42.3 mg/L khi ra viện (bình thường dưới 5)\n- EF tạm giảm từ 61% xuống 50% sau mổ, phục hồi về 58% khi ra viện\n- NT-proBNP 2280 pg/mL: chỉ điểm suy tim cần theo dõi tiếp",
  "kháng sinh":  "Phác đồ kháng sinh điều trị sau mổ:\n- **Buflan 2g (Cefoperazone + Sulbactam)**: dùng từ ngày 26/09, tiêm truyền tĩnh mạch\n- Ra viện bổ sung **Medoxasol 500mg (Levofloxacin)** uống ngoại trú\n- Lý do: CRP tăng cao sau mổ, bạch cầu WBC 10.21 đến 14.47 G/L",
  "chống đông":  "Bệnh nhân đang dùng **Vincerol 1mg (Acenocoumarol)** uống lúc 20h.\n\nLý do dùng suốt đời:\n- Van tim cơ học On-X cần chống đông để ngăn huyết khối\n- Mục tiêu INR: 2.0 đến 3.0 với van ĐMC cơ học\n- INR ra viện ngày 03/10: 2.25, trong ngưỡng điều trị\n- Cần xét nghiệm INR định kỳ mỗi tuần ban đầu",
  "siêu âm":     "Bệnh nhân có 9 lượt siêu âm tim, diễn biến chính:\n\n- **Trước mổ (12/09):** hẹp van ĐMC khít, chênh áp 71/51 mmHg, EF 74%\n- **Sau mổ (30/09):** van On-X hoạt động, chênh áp giảm còn 16 mmHg. EF tụt còn 50%, có dịch màng phổi 2 bên\n- **10/10:** EF giảm nặng 44%, dịch màng ngoài tim nhiều, dấu hiệu ép nhẹ thất phải (cảnh báo)\n- **Phục hồi (28/10 đến 25/11):** EF lên lại 58 rồi 71%, hết dịch\n- **Gần nhất (26/05/2026):** chênh áp 8 mmHg, EF 71%, van hoạt động bình thường\n\nTóm lại: van thay tốt (chênh áp giảm mạnh), EF tụt tạm thời do dịch màng ngoài tim rồi phục hồi hoàn toàn.",
  "crp":         "Diễn biến CRP theo thời gian:\n- 26/09 (sau mổ): **241.42 mg/L** (rất cao)\n- 27/09: 130.17 mg/L\n- 30/09: 106.61 mg/L\n- 03/10 (ra viện): **42.3 mg/L** (vẫn còn cao, bình thường dưới 5)\n\nXu hướng giảm tốt nhưng chưa về bình thường. Cần kiểm tra lại ở lần tái khám 10/10.",
}

function renderMd(text) {
  if (!text) return null
  const lines = text.split("\n"), out = []
  let ul = []
  const flush = () => { if (ul.length) { out.push(<ul key={"u"+out.length}>{ul}</ul>); ul = [] } }
  const inline = s => {
    // **bold** + `code`, bỏ ký tự markdown thừa
    return s.split("**").map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : p)
  }
  lines.forEach((line, i) => {
    const t = line.trim()
    if (!t) { flush(); return }
    if (t.startsWith("### ")) { flush(); out.push(<p key={i} className="md-h3">{inline(t.slice(4))}</p>) }
    else if (t.startsWith("## ")) { flush(); out.push(<p key={i} className="md-h2">{inline(t.slice(3))}</p>) }
    else if (t.startsWith("# ")) { flush(); out.push(<p key={i} className="md-h2">{inline(t.slice(2))}</p>) }
    else if (/^[-*]\s/.test(t)) { ul.push(<li key={i}>{inline(t.replace(/^[-*]\s/, ""))}</li>) }
    else if (/^\d+\.\s/.test(t)) { ul.push(<li key={i}>{inline(t.replace(/^\d+\.\s/, ""))}</li>) }
    else if (t === "---") { /* bỏ đường kẻ markdown */ }
    else { flush(); out.push(<p key={i}>{inline(t)}</p>) }
  })
  flush(); return out
}

// ─── FLOATING CHAT (kiểu Messenger) ───────────────────────────────────────────
function DoctorNote({ value, onChange }){
  const [open, setOpen] = useState(false)
  const pencil = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
  return (
    <>
      <button className="dn-fab" onClick={()=>setOpen(o=>!o)} title="Ghi chú của bác sĩ" aria-label="Ghi chú của bác sĩ">
        {pencil}{value && value.trim() && <span className="dn-dot"/>}
      </button>
      {open && (
        <div className="dn-panel">
          <div className="dn-head">{pencil}<span>Ghi chú của bác sĩ</span><button className="dn-x" onClick={()=>setOpen(false)} aria-label="Đóng"><Icon.Close d={13} color="#64748B"/></button></div>
          <textarea className="dn-ta" value={value} onChange={e=>onChange(e.target.value)} placeholder="Nhập nhận định, lưu ý, kế hoạch theo dõi cho hồ sơ này. Ghi chú được tự lưu và gộp vào báo cáo khi bạn xuất/in."/>
          <div className="dn-foot">{(value||"").trim().length} ký tự · tự lưu · in kèm báo cáo</div>
        </div>
      )}
    </>
  )
}
function FloatingChat({ report, hoSoText, messages, setMessages, onExpand, mode }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef()
  useEffect(() => { if (open) bottomRef.current?.scrollIntoView({ behavior:"smooth" }) }, [messages, open])

  const send = async (text) => {
    const q = text || input.trim(); if (!q || loading) return
    setInput(""); setMessages(prev => [...prev, { role:"user", content:q }]); setLoading(true)
    try {
      const res = await fetch(`${API_URL}/chat`, { method:"POST", headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ question:q, ho_so_text:hoSoText||JSON.stringify(report), chat_history:messages.slice(-6), mode }) })
      const data = await res.json()
      // fetch KHÔNG tự throw khi status lỗi (400/500) nếu backend vẫn trả JSON
      // hợp lệ (FastAPI HTTPException trả {"detail":"..."}, không có "answer").
      // Nếu không kiểm tra res.ok, data.answer sẽ là undefined -> hiện bong
      // bóng chat rỗng, nhìn như app vỡ. Coi lỗi HTTP như lỗi mạng -> rơi
      // xuống catch để dùng DEMO_CHAT, người dùng vẫn có câu trả lời hữu ích.
      if (!res.ok || !data || !data.answer) throw new Error(data?.detail || "no answer")
      setMessages(prev => [...prev, { role:"assistant", content:data.answer }])
    } catch {
      const key = Object.keys(DEMO_CHAT).find(k => q.toLowerCase().includes(k))
      const ans = key ? DEMO_CHAT[key] : "Không tìm thấy thông tin cụ thể trong hồ sơ. Bác sĩ có thể hỏi về: biến chứng sau mổ, thuốc chống đông, kết quả siêu âm, hoặc diễn biến CRP."
      setMessages(prev => [...prev, { role:"assistant", content:ans }])
    }
    setLoading(false)
  }

  const unread = !open && messages.filter(m => m.role === "assistant").length

  return (
    <>
      {!open && (
        <button className="fab-chat" onClick={()=>setOpen(true)} aria-label="Mở trợ lý ảo MedAmi">
          <Icon.Chat d={22} color="#fff"/>
          {unread > 0 && <span className="fab-badge">{unread}</span>}
        </button>
      )}
      {open && (
        <div className="fc-panel">
          <div className="fc-head">
            <div className="fc-head-l">
              <div className="fc-avatar"><MedAmiAvatar robotSize={15}/></div>
              <div>
                <div className="fc-title">MedAmi</div>
                <div className="fc-sub">{report.thong_tin_benh_nhan.ho_ten}</div>
              </div>
            </div>
            <div className="fc-head-r">
              <button className="fc-icon-btn" title="Mở rộng" onClick={onExpand}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              </button>
              <button className="fc-icon-btn" title="Thu nhỏ" onClick={()=>setOpen(false)}>
                <Icon.Close d={15} color="#fff"/>
              </button>
            </div>
          </div>
          <div className="fc-msgs">
            {messages.map((m,i)=>(
              <div key={i} className={`msg-row${m.role==="user"?" user":""}`}>
                {m.role==="assistant"&&<div className="bot-avatar sm"><MedAmiAvatar robotSize={11}/></div>}
                <div className={`bubble sm ${m.role==="user"?"user":"bot"}`}>{renderMd(m.content)}</div>
              </div>
            ))}
            {loading&&<div className="msg-row"><div className="bot-avatar sm"><MedAmiAvatar robotSize={11}/></div><div className="bubble sm bot"><div className="typing"><span/><span/><span/></div></div></div>}
            <div ref={bottomRef}/>
          </div>
          <div className="fc-sug">
            {chatSuggestions(mode).slice(0,3).map(s=>(
              <button key={s} onClick={()=>send(s)} disabled={loading}>{s}</button>
            ))}
          </div>
          <div className="fc-input">
            <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Hỏi nhanh về bệnh nhân..."/>
            <button className="send-btn sm" onClick={()=>send()} disabled={!input.trim()||loading}>
              <Icon.Send d={12} color={input.trim()&&!loading?"white":"#9BB5D8"}/>
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function ChatTab({ report, hoSoText, messages, setMessages, mode }) {
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef()
  const inputRef = useRef()
  useEffect(() => { bottomRef.current?.scrollIntoView({behavior:"smooth"}) }, [messages])

  const send = async (text) => {
    const q = text || input.trim(); if (!q || loading) return
    setInput(""); setMessages(prev => [...prev, {role:"user", content:q}]); setLoading(true)
    try {
      const res = await fetch(`${API_URL}/chat`, {method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({question:q, ho_so_text:hoSoText||JSON.stringify(report), chat_history:messages.slice(-6), mode})})
      const data = await res.json()
      // Xem ghi chú ở FloatingChat.send(): fetch không tự throw khi status lỗi
      // nhưng vẫn trả JSON hợp lệ -> phải tự kiểm tra res.ok + data.answer.
      if (!res.ok || !data || !data.answer) throw new Error(data?.detail || "no answer")
      setMessages(prev => [...prev, {role:"assistant", content:data.answer}])
    } catch {
      const key = Object.keys(DEMO_CHAT).find(k => q.toLowerCase().includes(k))
      const ans = key ? DEMO_CHAT[key] : "Không tìm thấy thông tin cụ thể trong hồ sơ. Bác sĩ có thể hỏi về: biến chứng sau mổ, thuốc chống đông, kết quả siêu âm, hoặc diễn biến CRP."
      setMessages(prev => [...prev, {role:"assistant", content:ans}])
    }
    setLoading(false)
  }

  return (
    <div className="chat-wrap">
      <div className="chat-msgs">
        {messages.map((m,i)=>(
          <div key={i} className={`msg-row${m.role==="user"?" user":""}`}>
            {m.role==="assistant"&&<div className="bot-avatar"><MedAmiAvatar robotSize={13}/></div>}
            <div className={`bubble ${m.role==="user"?"user":"bot"}`}>{renderMd(m.content)}</div>
          </div>
        ))}
        {loading&&<div className="msg-row"><div className="bot-avatar"><MedAmiAvatar robotSize={13}/></div><div className="bubble bot"><div className="typing"><span/><span/><span/></div></div></div>}
        <div ref={bottomRef}/>
      </div>
      <div className="chat-suggestions">
        {chatSuggestions(mode).map(s=>(
          <button key={s} className="sug-chip" onClick={()=>send(s)} disabled={loading}>{s}</button>
        ))}
      </div>
      <div className="chat-input-row">
        <Icon.Chat d={16} style={{color:"#7A96C8",flexShrink:0}}/>
        <input id="chat-input-field" ref={inputRef} className="chat-input" value={input}
          onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()}
          placeholder="Hỏi về bệnh nhân..."/>
        <div className="kbd-hint"><kbd className="kbd">Ctrl</kbd><span>+</span><kbd className="kbd">K</kbd></div>
        <button className="send-btn" onClick={()=>send()} disabled={!input.trim()||loading}>
          <Icon.Send d={13} color={input.trim()&&!loading?"white":"#9BB5D8"}/>
        </button>
      </div>
    </div>
  )
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) { console.error("MedParcours render error:", err, info) }
  render() {
    if (this.state.err) {
      const e = this.state.err
      return (
        <div style={{ maxWidth: 680, margin: "60px auto", padding: 24, fontFamily: "system-ui, -apple-system, sans-serif" }}>
          <h2 style={{ color: "#B42318", marginBottom: 8 }}>Đã xảy ra lỗi hiển thị</h2>
          <p style={{ color: "#33485F", lineHeight: 1.6 }}>
            Giao diện gặp sự cố khi dựng phần này (dữ liệu phân tích vẫn an toàn). Hãy thử tải lại trang.
          </p>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#FEF3F2", border: "1px solid #FCD9D3", borderRadius: 8, padding: 12, fontSize: 12, color: "#7A271A", overflow: "auto", maxHeight: 280 }}>
            {String((e && (e.stack || e.message)) || e)}
          </pre>
          <button onClick={() => location.reload()} style={{ marginTop: 12, border: "none", background: "#1D6FE8", color: "#fff", padding: "10px 18px", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>
            Tải lại trang
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DEMO: hồ sơ thứ 2 (Bệnh nhân 3, ẩn danh = "Nguyễn Văn B"), đăng nhập,
// ghi âm tài liệu, 3 chế độ xem, lịch sử bệnh án. Chạy client-side, không gọi
// backend. Tên bác sĩ ẩn danh dạng "Nguyễn Văn X / Lê Văn Y".
// ═══════════════════════════════════════════════════════════════════════════
const PATIENT_B = {
  thong_tin_benh_nhan: { ho_ten:"NGUYỄN VĂN B", ngay_sinh:"01/01/1958", tuoi:68, gioi_tinh:"Nam", dia_chi:"Xã Tân Tiến, Hưng Yên", ngay_vao_vien:"04/06/2026", ngay_ra_vien:"", so_benh_an:"26.007850" },
  chan_doan_chinh: "Hở van hai lá nhiều type II P2.P3 (đứt dây chằng sa lá sau P3) - Hở van ba lá nhiều - Tăng áp động mạch phổi nặng (ALĐMP tâm thu ~85 mmHg) - Suy tim. Sau mổ sửa van hai lá + sửa van ba lá nội soi (05/06/2026).",
  ly_do_vao_vien: "Khó thở tăng, suy tim mất bù. Phát hiện hở van hai lá nhiều trên 1 năm, vào viện chờ phẫu thuật.",
  tien_su_benh: "Bệnh mạch vành đã đặt 2 stent ĐMV (2024), tăng huyết áp, suy tim với EF từng giảm còn 32% rồi hồi phục dần (58% cuối 2025). Theo dõi hở van hai lá tiến triển trên 1 năm, lần này vào viện vì suy tim mất bù do hở van hai lá nặng. Nam 68 tuổi, gia đình bình thường.",
  phau_thuat: { ngay:"05/06/2026", phuong_phap:"Sửa van hai lá (vòng van Edwards 28mm) + Sửa van ba lá (vòng van Edwards 26mm), nội soi. Phẫu thuật đặc biệt khó, gây mê nội khí quản, chạy tuần hoàn ngoài cơ thể.", ket_qua:"Khâu khép A3P3 đặt vòng van, test nước còn hở nhẹ. Siêu âm thực quản trong mổ: van hai lá và van ba lá hở nhẹ.", bac_si_phau_thuat:"ThS.BS Nguyễn Văn X / ThS.BS Lê Văn Y" },
  dien_bien_lam_sang: [
    { ngay:"04/06/2026", mo_ta:"Nhập viện khoa Phẫu Thuật Tim Người Lớn vì suy tim mất bù do hở van hai lá nặng. Chờ phẫu thuật.", loai:"binh_thuong" },
    { ngay:"05/06/2026", mo_ta:"Phẫu thuật sửa van hai lá + van ba lá nội soi thành công. Chuyển hồi sức, an thần thở máy, huyết động ổn định.", loai:"binh_thuong" },
    { ngay:"06/06/2026", mo_ta:"Hậu phẫu nặng: lactate tăng vọt đỉnh 9.28 mmol/L, toan chuyển hóa. Phù phổi, suy tim phụ thuộc máy thở và thuốc vận mạch.", loai:"canh_bao" },
    { ngay:"07/06/2026", mo_ta:"Đáp ứng viêm hệ thống nặng: CRP 202.74, Procalcitonin 13.59, WBC tăng, Troponin T 457, CK 1232. Tổn thương thận cấp: Creatinine 122, eGFR 51.", loai:"canh_bao" },
    { ngay:"08/06/2026", mo_ta:"Hội chẩn dinh dưỡng: ăn qua sonde không tiêu, thể trạng suy kiệt. Thêm nuôi dưỡng tĩnh mạch (Nutriflex peri, Smoflipid). INR tăng 3.27.", loai:"bat_thuong" },
    { ngay:"09/06/2026", mo_ta:"INR đỉnh 3.94 (quá liều chống đông, nguy cơ chảy máu). Loét tỳ đè vùng cùng cụt độ 1-2. Còn phụ thuộc hô hấp.", loai:"canh_bao" },
    { ngay:"11/06/2026", mo_ta:"Cải thiện: CRP giảm còn 75.81, cấy máu và đờm âm tính. Albumin còn thấp 29.8. INR về 1.96.", loai:"bat_thuong" },
    { ngay:"12/06/2026", mo_ta:"NT-proBNP giảm mạnh còn 837 pg/mL (từ đỉnh 4851). Chức năng thận hồi phục (eGFR 72). INR 1.59.", loai:"binh_thuong" },
    { ngay:"13/06/2026", mo_ta:"Ổn định hô hấp, huyết động. CRP còn 27.58. Chuyển khoa Ngoại tiếp tục điều trị.", loai:"binh_thuong" },
    { ngay:"14/06/2026", mo_ta:"Tiểu cầu tăng phản ứng 423, đường máu ổn. Tiếp tục theo dõi dinh dưỡng và chống đông tại khoa Ngoại.", loai:"binh_thuong" },
  ],
  vital_signs: [
    { ngay:"08/06", crp:202.7, wbc:17.4 },
    { ngay:"11/06", crp:75.8,  wbc:11.9 },
    { ngay:"13/06", crp:27.6,  wbc:12.7 },
  ],
  xet_nghiem_truoc_mo: { ghi_chu:"Siêu âm tim trước mổ (04/06): Dd 52, EF 68%. Hở van hai lá 4/4 do sa toàn bộ lá sau, đứt dây chằng. Hở van ba lá 3.5/4. Tăng áp ĐMP nặng (ALĐMP tâm thu ~85 mmHg). NT-proBNP 4235. Chụp mạch vành: hẹp nhẹ 30% LAD và RCA." },
  xet_nghiem_meta: [
    { key:"HGB",       val:"137 g/L",     rawVal:137,  unit:"g/L",    desc:"Hemoglobin (hồng cầu)", normal:"130-172", status:"normal", trend:[122,148,120,137], trendDates:["05/06","05/06","11/06","14/06"], arrow:"ok" },
    { key:"WBC",       val:"12.7 G/L",    rawVal:12.7, unit:"G/L",    desc:"Bạch cầu",              normal:"4-10",    status:"high",   trend:[15.1,17.4,11.9,12.7], trendDates:["05/06","08/06","11/06","13/06"], arrow:"down" },
    { key:"PLT",       val:"423 G/L",     rawVal:423,  unit:"G/L",    desc:"Tiểu cầu (tăng phản ứng)", normal:"150-400", status:"high", trend:[94,135,278,423], trendDates:["05/06","08/06","12/06","14/06"], arrow:"up" },
    { key:"Creatinin", val:"91 µmol/L",   rawVal:91,   unit:"µmol/L", desc:"Chức năng thận",        normal:"62-106",  status:"normal", trend:[127,122,112,91], trendDates:["06/06","07/06","09/06","12/06"], arrow:"down" },
    { key:"eGFR",      val:"72 mL/ph",    rawVal:72,   unit:"mL/ph/1.73", desc:"Mức lọc cầu thận",  normal:"≥60",     status:"normal", trend:[49,51,56,72], trendDates:["06/06","07/06","09/06","12/06"], arrow:"up" },
    { key:"Albumin",   val:"29.8 g/L",    rawVal:29.8, unit:"g/L",    desc:"Albumin máu (suy kiệt)", normal:"35-52",  status:"low",    trend:[37.5,29.8], trendDates:["07/06","11/06"], arrow:"down" },
    { key:"CRP",       val:"27.6 mg/L",   rawVal:27.6, unit:"mg/L",   desc:"Viêm nhiễm (gần nhất)", normal:"<5",      status:"high",   trend:[202.7,75.8,27.6], trendDates:["08/06","11/06","13/06"], arrow:"down" },
    { key:"PCT",       val:"13.59 ng/mL", rawVal:13.59,unit:"ng/mL",  desc:"Procalcitonin (nhiễm khuẩn)", normal:"<0.5", status:"high", trend:[13.59], trendDates:["06/06"], arrow:"down" },
    { key:"INR",       val:"1.8",         rawVal:1.8,  unit:"",       desc:"Đông máu (chống đông)", normal:"2.0-3.0", status:"low",    trend:[1.65,3.94,2.2,1.8], trendDates:["05/06","09/06","10/06","14/06"], arrow:"down" },
    { key:"NT-proBNP", val:"837 pg/mL",   rawVal:837,  unit:"pg/mL",  desc:"Marker suy tim",        normal:"<125",    status:"high",   trend:[4235,4851,837], trendDates:["tiền mổ","06/06","12/06"], arrow:"down" },
    { key:"Lactate",   val:"9.28 mmol/L", rawVal:9.28, unit:"mmol/L", desc:"Lactate đỉnh (giảm tưới máu)", normal:"0.4-2.2", status:"high", trend:[1.96,3.7,9.28], trendDates:["05/06","05/06","06/06"], arrow:"up" },
    { key:"EF",        val:"68%",         rawVal:68,   unit:"%",      desc:"Phân suất tống máu (diễn tiến 2025-2026)", normal:"55-70", status:"normal", trend:[32,42,58,68], trendDates:["19/05/25","21/05/25","13/12/25","04/06/26"], arrow:"up" },
  ],
  sieu_am_tim: {
    lan_kham: [
      { ngay:"19/05/2025", nguon:"SA tim Philips", chan_doan:"Suy tim, EF giảm nặng", ef:32, grad_max:5, grad_tb:null, hoc:"Nhẹ (1/4)", phase:"truoc_mo", ghi_chu:"Giảm vận động đồng đều các thành thất trái. Tiền sử 2 stent ĐMV (2024), tăng huyết áp. HoHL nhẹ.", canh_bao:true },
      { ngay:"21/05/2025", nguon:"SA tim Philips", chan_doan:"Chức năng tâm thu thất trái giảm", ef:42, grad_max:5, grad_tb:null, hoc:"Nhẹ (1/4)", phase:"truoc_mo", ghi_chu:"EF Simpson 4B ~44%, 2B ~40%, Biplane ~42%. Thất trái không giãn (Dd index 28.3). ALĐMP tâm thu 25 mmHg. Không dịch màng tim.", canh_bao:false },
      { ngay:"13/12/2025", nguon:"SA tim Philips", chan_doan:"Chức năng tâm thu thất trái hồi phục", ef:58, grad_max:4, grad_tb:null, hoc:"Nhẹ (1/4)", phase:"truoc_mo", ghi_chu:"Không rối loạn vận động vùng. EF 58%, thất trái không giãn (Dd index 27.5). ALĐMP 23 mmHg. Giãn nhẹ ĐMC lên 37 mm, không tách thành.", canh_bao:false },
      { ngay:"04/06/2026", nguon:"SA tim tiền mê", chan_doan:"HoHL 4/4 - HoBL 3.5/4 - TAP nặng", ef:68, grad_max:null, grad_tb:null, hoc:"Nặng (ngoài van)", phase:"truoc_mo", ghi_chu:"Dd 52, EF 68%. Sa toàn bộ lá sau do đứt dây chằng. ALĐMP tâm thu ~85 mmHg. Giãn buồng tim phải, nhĩ trái giãn, không huyết khối.", canh_bao:true },
      { ngay:"05/06/2026", nguon:"SA thực quản trong mổ", chan_doan:"Sau sửa VHL + VBL", ef:null, grad_max:4, grad_tb:2, hoc:"Nhẹ (trong vòng van)", phase:"sau_mo", ghi_chu:"Đánh giá kết quả sửa van: HoHL nhẹ <1/4 (VC 2.9mm); HoBL nhẹ-vừa 1.5/4 (VC 3.9mm). Vòng van Edwards 28mm (hai lá) + 26mm (ba lá).", canh_bao:false, latest:true },
    ],
  },
  canh_bao_nguy_co: [
    { mo_ta:"Toan chuyển hóa - tăng lactate nặng sau mổ, đỉnh 9.28 mmol/L (06/06): dấu hiệu giảm tưới máu mô, cần hồi sức tích cực và tối ưu huyết động.", muc_do:"cao", can_cu:"Khí máu 06/06/2026: lactate 9.28 mmol/L (bình thường 0.4-2.2)." },
    { mo_ta:"Đáp ứng viêm hệ thống / nhiễm khuẩn nặng: Procalcitonin 13.59, CRP đỉnh 202.74, WBC 17.4, Troponin T 457, CK 1232. Cần cấy bệnh phẩm và kháng sinh theo kinh nghiệm.", muc_do:"cao", can_cu:"XN 06-08/06/2026: PCT 13.59 ng/mL, CRP 202.74 mg/L, Troponin T hs 457 ng/L." },
    { mo_ta:"Quá liều chống đông: INR tăng đỉnh 3.94 (09/06), vượt mục tiêu 2.0-3.0 trên bệnh nhân vừa mổ tim, nguy cơ chảy máu. Cần chỉnh liều và theo dõi sát.", muc_do:"cao", can_cu:"Đông máu 09/06/2026: PT-INR 3.94 (mục tiêu 2.0-3.0)." },
    { mo_ta:"Tổn thương thận cấp (AKI) sau mổ: Creatinine đỉnh 127, eGFR thấp nhất 49 mL/ph. Đã cải thiện (eGFR 72 ngày 12/06) nhưng cần thận trọng liều thuốc thải qua thận.", muc_do:"cao", can_cu:"Sinh hóa 06/06/2026: Creatinine 127 µmol/L, eGFR 49." },
    { mo_ta:"Suy hô hấp - suy tim phụ thuộc máy thở và thuốc vận mạch, phù phổi sau mổ. Cai máy thở từng bước theo huyết động.", muc_do:"cao", can_cu:"Biên bản hội chẩn 08/06/2026: suy tim phụ thuộc máy thở, huyết áp phụ thuộc thuốc tăng co, vận mạch." },
    { mo_ta:"Suy kiệt - suy dinh dưỡng: ăn qua sonde không tiêu, Albumin 29.8 g/L, BMI 18.6. Cần nuôi dưỡng tĩnh mạch bổ sung.", muc_do:"trung_binh", can_cu:"Hội chẩn dinh dưỡng 08/06/2026; Albumin 29.8 g/L (11/06)." },
    { mo_ta:"Loét tỳ đè vùng cùng cụt (độ 1-2) do nằm lâu. Cần xoay trở, đệm chống loét, chăm sóc da.", muc_do:"thap", can_cu:"Phiếu đánh giá loét 06/06/2026: loét vùng cùng cụt." },
  ],
  ket_luan_giai_doan: {
    1: "Suy tim mất bù do hở van hai lá nặng (sa lá sau, đứt dây chằng) kèm hở van ba lá và tăng áp ĐMP nặng. EF còn bảo tồn 68%. Chỉ định phẫu thuật sửa van đúng đắn.",
    2: "Mổ sửa van hai lá + van ba lá nội soi thành công, nhưng hậu phẫu rất nặng: toan - tăng lactate (đỉnh 9.28), đáp ứng viêm/nhiễm khuẩn (PCT 13.59, CRP 202), tổn thương thận cấp (eGFR 49), INR quá liều (3.94), phù phổi phụ thuộc máy thở và vận mạch, suy kiệt.",
    3: "Cải thiện rõ: NT-proBNP giảm 4851 → 837, CRP 202 → 27.58, chức năng thận hồi phục (eGFR 72), INR về ~1.8. Chuyển khoa Ngoại ngày 13/06 tiếp tục điều trị dinh dưỡng, chống đông và chăm sóc loét.",
  },
  clinical_takeaway: [
    { txt:"Ca sửa van phức tạp thành công nhưng hậu phẫu rất nặng: nhiễm khuẩn, AKI, toan-lactate cao, suy hô hấp phụ thuộc máy thở.", loai:"watch" },
    { txt:"Đang cải thiện rõ rệt: NT-proBNP 4851 → 837, CRP 202 → 27.6, chức năng thận hồi phục (eGFR 49 → 72).", loai:"good" },
    { txt:"Cần theo dõi sát: chống đông (INR dao động, đỉnh 3.94), dinh dưỡng (suy kiệt, Albumin thấp), và loét tỳ đè cùng cụt.", loai:"watch" },
  ],
  ly_luan_lam_sang: [
    { muc:"critical", phase:2, tieu_de:"Lactate 9.28 kèm tụt tưới máu sau mổ tim lớn",
      noi_dung:"Lactate tăng vọt đỉnh 9.28 mmol/L (06/06) phản ánh giảm tưới máu mô sau tuần hoàn ngoài cơ thể kéo dài (thời gian chạy máy 248 phút, cặp ĐMC 144 phút). Phối hợp suy tim phụ thuộc vận mạch. Cần tối ưu cung lượng tim, theo dõi lactate clearance thay vì chỉ một trị số." },
    { muc:"critical", phase:2, tieu_de:"INR 3.94 trên nền albumin thấp và kháng sinh",
      noi_dung:"INR vọt 3.94 (09/06) ở bệnh nhân vừa mổ tim là nguy cơ chảy máu cao. Albumin thấp (29.8) làm giảm gắn kết thuốc chống đông; phối hợp kháng sinh có thể tăng tác dụng kháng vitamin K. Cần chỉnh liều theo INR và cân nhắc nguyên nhân phối hợp." },
    { muc:"warning", phase:3, tieu_de:"Nhiễm khuẩn giảm dần nhưng dinh dưỡng vẫn là nút thắt",
      noi_dung:"PCT 13.59 và CRP 202 đã giảm về 27.6 cho thấy kiểm soát nhiễm khuẩn tốt. Tuy nhiên ăn sonde không tiêu, Albumin 29.8, suy kiệt là yếu tố làm chậm lành thương và cai máy thở. Nuôi dưỡng tĩnh mạch bổ sung là ưu tiên song song." },
  ],
  problem_status: {
    hien_tai: [
      { ten:"Van hai lá - ba lá sau sửa", trang_thai:"monitoring", mo_ta:"Còn hở nhẹ trong vòng van, theo dõi mức hở và chức năng tim" },
      { ten:"Chống đông sau sửa van", trang_thai:"active", mo_ta:"INR dao động, cần giữ trong mục tiêu, tránh quá liều" },
      { ten:"Suy dinh dưỡng - suy kiệt", trang_thai:"active", mo_ta:"Nuôi dưỡng tĩnh mạch bổ sung, Albumin thấp" },
      { ten:"Loét tỳ đè cùng cụt", trang_thai:"monitoring", mo_ta:"Độ 1-2, chăm sóc da, xoay trở, đệm chống loét" },
      { ten:"Theo dõi nhiễm khuẩn", trang_thai:"monitoring", mo_ta:"CRP/PCT đang giảm, tiếp tục theo dõi" },
    ],
    da_qua: [
      { ten:"Lactate 9.28 - toan chuyển hóa", mo_ta:"06/06, đã cải thiện sau hồi sức" },
      { ten:"INR đỉnh 3.94", mo_ta:"09/06, đã chỉnh về ~1.8" },
      { ten:"Tổn thương thận cấp (eGFR 49)", mo_ta:"06/06, hồi phục eGFR 72 ngày 12/06" },
      { ten:"NT-proBNP 4851", mo_ta:"06/06, giảm còn 837 ngày 12/06" },
      { ten:"Phù phổi phụ thuộc máy thở", mo_ta:"Giai đoạn hồi sức, đã ổn định hô hấp" },
    ],
  },
  hanh_dong_uu_tien: [
    { uu_tien:1, viec:"Theo dõi INR và chỉnh liều chống đông", ly_do:"INR từng vọt 3.94 vượt mục tiêu; sau sửa van cần giữ INR ổn định, tránh chảy máu lẫn huyết khối." },
    { uu_tien:2, viec:"Đánh giá lại chức năng thận và điện giải", ly_do:"AKI sau mổ (eGFR thấp nhất 49) đã cải thiện nhưng cần theo dõi khi dùng lợi tiểu và thuốc thải qua thận." },
    { uu_tien:3, viec:"Tối ưu dinh dưỡng (đường tĩnh mạch + tập ăn đường miệng)", ly_do:"Suy kiệt, Albumin 29.8, ăn sonde không tiêu làm chậm hồi phục và cai máy thở." },
    { uu_tien:4, viec:"Chăm sóc loét tỳ đè cùng cụt", ly_do:"Loét độ 1-2 do nằm lâu, cần xoay trở và đệm chống loét để tránh tiến triển." },
    { uu_tien:5, viec:"Theo dõi dấu hiệu nhiễm khuẩn (CRP, PCT, cấy)", ly_do:"Đáp ứng viêm nặng sau mổ đang giảm, cần đảm bảo không tái phát nhiễm khuẩn." },
  ],
  thuoc_cuoi_ky: [
    { ten_thuoc:"Cefamandol 2g", nhom:"Kháng sinh", lieu:"Theo chỉ định", cach_dung:"Tiêm tĩnh mạch", bat_dau:"05/06", color:"#EF4444" },
    { ten_thuoc:"Chống đông kháng vitamin K", nhom:"Chống đông", lieu:"Chỉnh theo INR", cach_dung:"Uống, giữ INR mục tiêu", bat_dau:"06/06", keo_dai:true, color:"#8B5CF6" },
    { ten_thuoc:"Furosemid (Takizd)", nhom:"Lợi tiểu", lieu:"Theo cân bằng dịch", cach_dung:"Tiêm/uống", bat_dau:"06/06", keo_dai:true, color:"#06B6D4" },
    { ten_thuoc:"Dobutamine", nhom:"Vận mạch - tăng co", lieu:"Truyền bơm tiêm điện", cach_dung:"Giai đoạn hồi sức", bat_dau:"05/06", color:"#10B981" },
    { ten_thuoc:"Nutriflex peri + Smoflipid", nhom:"Nuôi dưỡng tĩnh mạch", lieu:"80 ml/giờ", cach_dung:"Truyền tĩnh mạch", bat_dau:"08/06", keo_dai:true, color:"#F59E0B" },
    { ten_thuoc:"Esomeprazole (Nexium 40mg)", nhom:"Dạ dày", lieu:"1 lọ/ngày", cach_dung:"Tiêm tĩnh mạch", bat_dau:"05/06", keo_dai:true, color:"#3B82F6" },
  ],
  tom_tat_toan_canh: "GIAI ĐOẠN TRƯỚC MỔ: Bệnh nhân nam 68 tuổi, tiền sử hở van hai lá nhiều trên 1 năm, vào viện 04/06/2026 vì khó thở tăng và suy tim mất bù. Siêu âm tim cho thấy hở van hai lá 4/4 do sa toàn bộ lá sau (đứt dây chằng), hở van ba lá 3.5/4, tăng áp động mạch phổi nặng (ALĐMP tâm thu ~85 mmHg), EF còn bảo tồn 68%. GIAI ĐOẠN SAU MỔ - NỘI TRÚ: Ngày 05/06/2026 phẫu thuật sửa van hai lá (vòng van Edwards 28mm) và sửa van ba lá (vòng van 26mm) qua nội soi, kết quả còn hở nhẹ trong vòng van. Hậu phẫu rất nặng: toan chuyển hóa với lactate đỉnh 9.28 mmol/L, đáp ứng viêm và nhiễm khuẩn nặng (Procalcitonin 13.59, CRP đỉnh 202.74), tổn thương thận cấp (eGFR thấp nhất 49), INR quá liều (đỉnh 3.94), phù phổi phụ thuộc máy thở và thuốc vận mạch, kèm suy kiệt - suy dinh dưỡng phải nuôi dưỡng tĩnh mạch và loét tỳ đè cùng cụt. GIAI ĐOẠN HỒI PHỤC: Các chỉ số cải thiện rõ - NT-proBNP giảm từ 4851 còn 837 pg/mL, CRP còn 27.58, chức năng thận hồi phục (eGFR 72), INR về khoảng 1.8. Bệnh nhân được chuyển khoa Ngoại ngày 13/06/2026 để tiếp tục điều trị dinh dưỡng, chống đông và chăm sóc loét.",
  dau_hieu_sinh_ton: { ngay:"05/06/2026", ha_tt:110, ha_ttr:80, mach:71, nhiet_do:36.0, nhip_tho:19, spo2:98, lactate:1.96 },
}

// Lịch sử bệnh án (demo, tĩnh). Bác sĩ ẩn danh dạng "Nguyễn Văn X / Lê Văn Y".
function recMeta(data){
  const t = data.thong_tin_benh_nhan
  return {
    ho_ten: t.ho_ten, tuoi: t.tuoi, gioi_tinh: t.gioi_tinh,
    so_benh_an: t.so_benh_an, ngay_vao_vien: t.ngay_vao_vien,
    chan_doan: data.chan_doan_chinh,
    bac_si: data.phau_thuat?.bac_si_phau_thuat || "BS. Nguyễn Văn X", data,
  }
}
const HISTORY = [
  { id:"BN-A", ...recMeta(MOCK_REPORT) },
  { id:"BN-B", ...recMeta(PATIENT_B) },
]

// ─── Lời chào chatbot theo ngữ cảnh (mode) ───────────────────────────────────
function modeGreeting(mode, name){
  const n = name || "này"
  if(mode==="teaching") return `Xin chào, tôi là **MedAmi** - gia sư lâm sàng. Chúng ta cùng phân tích ca **${n}** theo từng bước bệnh án nhé. Bạn muốn bắt đầu từ bệnh sử, thăm khám, hay biện luận chẩn đoán?`
  if(mode==="hoi_chan") return `Xin chào, tôi là **MedAmi** - thư ký y khoa của buổi hội chẩn. Tôi đã tổng hợp hồ sơ ca **${n}** và ý kiến các chuyên khoa. Anh/chị cần tôi làm rõ phần nào của biên bản hội chẩn?`
  return `Xin chào Bác sĩ, tôi là **MedAmi**. Tôi đã đọc xong hồ sơ bệnh nhân **${n}**. Bác sĩ muốn hỏi gì về ca này?`
}
function chatSuggestions(mode){
  if(mode==="hoi_chan") return ["Tóm tắt kết luận hội chẩn?","Vấn đề ưu tiên số 1 là gì?","Điểm nào các khoa chưa đồng thuận?","Cần thêm cận lâm sàng gì?"]
  if(mode==="teaching") return ["Tóm tắt ca bệnh trong 2 câu?","Chẩn đoán phân biệt gồm những gì?","Vì sao nghĩ đến suy tim?","Hướng điều trị và theo dõi?"]
  return ["Bệnh nhân có biến chứng gì sau mổ?","Đang dùng thuốc chống đông loại nào?","Kết quả siêu âm tim sau mổ?","Diễn biến CRP theo thời gian?"]
}

// ─── Tiện ích chung ───────────────────────────────────────────────────────────
function clampN(n,a,b){ return Math.max(a,Math.min(b,Math.round(n))) }
function riskTone(p){ return p>=80?"green":p>=60?"amber":"red" }
function matchKw(text, kws){ const t=(text||"").toLowerCase(); return kws.some(k=>t.includes(k)) }
function pickCanhBao(r, kws){ return (r.canh_bao_nguy_co||[]).filter(c=>matchKw(c.mo_ta, kws)) }
function shortLabel(s){ return ((s||"").split(/[:\-]/)[0]||s||"").trim().slice(0,72) }
function splitSentences(s){ return (s||"").split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(x=>x.length>2) }

// ─── Engine Hội chẩn ảo (Virtual MDT) ─────────────────────────────────────────
const SPEC_DEFS = [
  { khoa:"Tim mạch", relevance:"Rất cao", role:"Đánh giá chức năng tim, van tim và nguy cơ suy tim.", kw:["van","tim","ef","suy tim","nt-probnp","chênh áp","hở van","tăng áp","mạch vành","rung nhĩ"] },
  { khoa:"Phẫu thuật Tim", relevance:"Rất cao", role:"Đánh giá kết quả mổ, vết mổ, dẫn lưu và biến chứng hậu phẫu.", kw:["mổ","phẫu thuật","sửa van","thay van","vòng van","nội soi","tuần hoàn ngoài cơ thể"] },
  { khoa:"Hồi sức tích cực", relevance:"Rất cao", role:"Ổn định huyết động, hô hấp và cân bằng nội môi giai đoạn hậu phẫu.", kw:["lactate","toan","máy thở","huyết động","vận mạch","phù phổi","sốc","hồi sức","tưới máu","an thần"] },
  { khoa:"Truyền nhiễm", relevance:"Cao", role:"Đánh giá nhiễm khuẩn, lựa chọn và xuống thang kháng sinh.", kw:["nhiễm","crp","pct","procalcitonin","viêm","bạch cầu","sepsis","kháng sinh","cấy","sốt"] },
  { khoa:"Huyết học - Đông máu", relevance:"Cao", role:"Cân bằng nguy cơ chảy máu và huyết khối khi dùng chống đông.", kw:["inr","chống đông","đông máu","tiểu cầu","chảy máu","huyết khối"] },
  { khoa:"Thận - Tiết niệu", relevance:"Cao", role:"Theo dõi chức năng thận, cân bằng dịch và liều thuốc thải qua thận.", kw:["thận","creatinin","egfr","aki","lọc máu","niệu"] },
  { khoa:"Dinh dưỡng lâm sàng", relevance:"Trung bình", role:"Đánh giá và hỗ trợ dinh dưỡng để hồi phục và lành thương.", kw:["dinh dưỡng","albumin","suy kiệt","sonde","bmi","nuôi dưỡng"] },
]
const SPEC_GAP = {
  "Tim mạch":"Siêu âm tim kiểm tra lại sau can thiệp (đánh giá chức năng và mức hở van).",
  "Phẫu thuật Tim":"Theo dõi vết mổ và dẫn lưu để loại trừ biến chứng ngoại khoa.",
  "Hồi sức tích cực":"Xu hướng huyết động khi giảm dần vận mạch.",
  "Truyền nhiễm":"Kết quả cấy định danh và kháng sinh đồ.",
  "Huyết học - Đông máu":"Thêm các lần đo INR để khẳng định ổn định.",
  "Thận - Tiết niệu":"Diễn biến chức năng thận khi điều chỉnh lợi tiểu.",
  "Dinh dưỡng lâm sàng":"Đánh giá nhu cầu năng lượng và khả năng dung nạp ăn đường miệng.",
}
function deriveRisk(r){
  const meta=(k)=>(r.xet_nghiem_meta||[]).find(x=>(x.key||"").toLowerCase()===k.toLowerCase())
  const out=[]
  const ef=meta("EF"); if(ef&&ef.rawVal!=null) out.push({ten:"Chức năng tim",pct:clampN(Math.min(95,ef.rawVal+22),20,95)})
  const bnp=meta("NT-proBNP"); if(bnp&&bnp.rawVal!=null){ const v=bnp.rawVal; out.push({ten:"Kiểm soát suy tim",pct:v<1000?75:v<2500?62:50}) }
  const crp=meta("CRP"); if(crp&&crp.rawVal!=null){ const v=crp.rawVal; out.push({ten:"Kiểm soát nhiễm khuẩn",pct:v<10?85:v<50?64:v<120?55:45}) }
  const egfr=meta("eGFR"); if(egfr&&egfr.rawVal!=null){ const v=egfr.rawVal; out.push({ten:"Chức năng thận",pct:v>=60?85:v>=45?60:45}) }
  const inr=meta("INR"); if(inr){ const tr=inr.trend||[]; const hadHigh=tr.some(x=>x>3)||(inr.rawVal>3); const inRange=inr.rawVal>=2&&inr.rawVal<=3; out.push({ten:"Kiểm soát chống đông",pct:hadHigh?48:inRange?82:62}) }
  return out.map(o=>({...o,tone:riskTone(o.pct)}))
}
function buildThread(r, names){
  const t=[]
  const good=(r.clinical_takeaway||[]).find(x=>x.loai==="good")
  if(names.includes("Tim mạch")) t.push({khoa:"Tim mạch", text: good?good.txt:"Chức năng tim ổn định, các chỉ số tim mạch đang cải thiện."})
  if(names.includes("Truyền nhiễm")) t.push({khoa:"Truyền nhiễm", text:"Đồng ý. Tuy nhiên CRP/PCT từng rất cao, chưa thể loại trừ hoàn toàn nhiễm khuẩn tồn dư."})
  if(names.includes("Huyết học - Đông máu")) t.push({khoa:"Huyết học - Đông máu", text:"Đồng ý. Tuy nhiên INR còn dao động, cần thận trọng nguy cơ chảy máu nếu can thiệp."})
  if(names.includes("Hồi sức tích cực")) t.push({khoa:"Hồi sức tích cực", text:"Bổ sung: cần cai vận mạch và hỗ trợ hô hấp từng bước theo huyết động."})
  if(names.includes("Thận - Tiết niệu")) t.push({khoa:"Thận - Tiết niệu", text:"Đồng ý. Lưu ý điều chỉnh liều thuốc và lợi tiểu theo chức năng thận."})
  if(names.includes("Dinh dưỡng lâm sàng")) t.push({khoa:"Dinh dưỡng lâm sàng", text:"Nguy cơ dễ bị bỏ sót: suy kiệt làm chậm hồi phục và cai máy thở, cần nuôi dưỡng tích cực."})
  return t
}
function buildAskMDT(r, names){
  const f=(arr)=>arr.filter(a=>names.includes(a.khoa))
  const text=[r.chan_doan_chinh,...(r.canh_bao_nguy_co||[]).map(c=>c.mo_ta),...(r.thuoc_cuoi_ky||[]).map(t=>t.nhom)].join(" ")
  const has=(...k)=>matchKw(text,k)
  const out=[]
  if(has("kháng sinh","nhiễm","crp","pct")) out.push({ q:"Có nên xuống thang kháng sinh không?",
    answers:f([{khoa:"Truyền nhiễm",stance:"Nghiêng về Có",ly_do:"CRP/PCT giảm mạnh, lâm sàng cải thiện."},{khoa:"Hồi sức tích cực",stance:"Trung lập",ly_do:"Cần ổn định nguồn nhiễm trước khi thu hẹp phổ."},{khoa:"Tim mạch",stance:"Trung lập",ly_do:"Ưu tiên đối chiếu kết quả cấy vi sinh."}]),
    moderator:{ muc:"Trung bình", khuyen_nghi:"Tiếp tục theo dõi marker viêm và cân nhắc xuống thang khi có bằng chứng vi sinh phù hợp." } })
  if(has("vận mạch","dobutamine","tăng co")) out.push({ q:"Có nên giảm/ngừng thuốc vận mạch (Dobutamine)?",
    answers:f([{khoa:"Hồi sức tích cực",stance:"Nghiêng về Có",ly_do:"Huyết động cải thiện, lactate đã giảm."},{khoa:"Tim mạch",stance:"Trung lập",ly_do:"Cần đánh giá cung lượng tim/EF trước khi cai."}]),
    moderator:{ muc:"Cao", khuyen_nghi:"Giảm dần theo huyết động và lactate, không ngừng đột ngột; đánh giá lại chức năng tim mỗi bước." } })
  out.push({ q:"Đã đủ điều kiện chuyển bệnh nhân ra khỏi Hồi sức (ICU)?",
    answers:f([{khoa:"Hồi sức tích cực",stance:"Nghiêng về Có",ly_do:"Đã cai vận mạch, hô hấp tự thở ổn định."},{khoa:"Truyền nhiễm",stance:"Trung lập",ly_do:"Chờ marker nhiễm khuẩn giảm thêm và không sốt."},{khoa:"Tim mạch",stance:"Nghiêng về Có",ly_do:"Huyết động ổn, không còn phụ thuộc trợ tim."}]),
    moderator:{ muc:"Trung bình", khuyen_nghi:"Cân nhắc chuyển khoa khi huyết động - hô hấp ổn định và nhiễm khuẩn được kiểm soát." } })
  return out
}
function deriveMDT(r){
  const text=[r.chan_doan_chinh,r.tom_tat_toan_canh,...(r.canh_bao_nguy_co||[]).map(c=>c.mo_ta),...(r.thuoc_cuoi_ky||[]).map(t=>t.nhom),r.phau_thuat&&r.phau_thuat.phuong_phap].join(" ")
  const specialties=SPEC_DEFS.filter(s=>matchKw(text,s.kw)).map(s=>{
    const cbs=pickCanhBao(r,s.kw)
    const fullEval = cbs.length ? cbs.map(c=>c.mo_ta)
      : (s.khoa==="Tim mạch" ? [expandAbbr(r.chan_doan_chinh)]
      : (s.khoa==="Phẫu thuật Tim" ? [`Kết quả mổ: ${(r.phau_thuat&&r.phau_thuat.ket_qua)||"theo tường trình phẫu thuật"}`]
      : ["Phối hợp theo dõi chung; chưa ghi nhận vấn đề chuyên biệt nổi bật."]))
    const ket_luan_chinh = fullEval.slice(0,2).map(shortLabel)
    const de_xuat=(r.hanh_dong_uu_tien||[]).filter(a=>matchKw(a.viec+" "+a.ly_do,s.kw)).map(a=>a.viec).slice(0,3)
    if(de_xuat.length===0 && s.khoa==="Tim mạch") de_xuat.push("Theo dõi NT-proBNP, siêu âm tim kiểm tra")
    const hasNum=cbs.some(c=>/\d/.test(c.can_cu||""))
    const conf = (cbs.length&&hasNum)?90:(cbs.length?72:58)
    return { khoa:s.khoa, relevance:s.relevance, role:s.role, ket_luan_chinh, de_xuat,
      con_thieu:SPEC_GAP[s.khoa]||"Cần thêm dữ liệu theo dõi.", confidence:conf, muc_cao:cbs.some(c=>c.muc_do==="cao"),
      details:{ danh_gia:fullEval, ho_tro:cbs.map(c=>c.can_cu).filter(Boolean) } }
  })
  const names=specialties.map(s=>s.khoa)
  const order=["sốc","sepsis","nhiễm","lactate","toan","hô hấp","máy thở","phù phổi","huyết động","thận","creatinin","egfr","inr","chống đông","dinh dưỡng","albumin","loét"]
  const sev=c=>{ const t=c.mo_ta.toLowerCase(); const i=order.findIndex(k=>t.includes(k)); return i<0?999:i }
  const priorities=(r.canh_bao_nguy_co||[]).filter(c=>c.muc_do==="cao").slice().sort((a,b)=>sev(a)-sev(b)).slice(0,3).map((c,i)=>({rank:i+1,ten:shortLabel(c.mo_ta),ly_do:c.mo_ta}))
  const has=(...k)=>matchKw(text,k)
  const agreement=[`Thống nhất chẩn đoán chính: ${expandAbbr(r.chan_doan_chinh)}`]
  ;(r.clinical_takeaway||[]).filter(t=>t.loai==="good").forEach(t=>agreement.push(t.txt))
  const concern=(r.problem_status&&r.problem_status.hien_tai||[]).filter(p=>p.trang_thai==="active").map(p=>`${p.ten}: ${p.mo_ta}`)
  ;(r.canh_bao_nguy_co||[]).filter(c=>c.muc_do==="cao").slice(0,2).forEach(c=>concern.push(c.mo_ta))
  const uncertainty=[]
  if(has("van","sửa van","thay van")) uncertainty.push("Chưa có siêu âm tim kiểm tra lại sau mổ để khẳng định mức hở van và chức năng tim.")
  if(has("nhiễm","cấy","crp","pct")) uncertainty.push("Chưa khẳng định tác nhân nhiễm khuẩn (cấy định danh, kháng sinh đồ).")
  if(has("dinh dưỡng","albumin","sonde")) uncertainty.push("Khả năng dung nạp dinh dưỡng đường miệng và thời điểm rút nuôi dưỡng tĩnh mạch chưa rõ.")
  if(uncertainty.length===0) uncertainty.push("Một số dữ liệu theo dõi còn thiếu, cần bổ sung.")
  const disagreement=[]
  if(has("vận mạch","dobutamine","tăng co")) disagreement.push("Thời điểm cai vận mạch: cai sớm để tránh tác dụng phụ hay duy trì để bảo đảm tưới máu?")
  if(has("kháng sinh","nhiễm","sepsis","crp","pct")) disagreement.push("Kháng sinh phổ rộng: tiếp tục đủ liệu trình hay xuống thang sớm theo đáp ứng?")
  if(has("inr","chống đông")) disagreement.push("Mục tiêu INR: giữ thấp (gần 2.0) để giảm chảy máu hay chuẩn 2.0-3.0 để phòng huyết khối?")
  const consensus=(r.ket_luan_giai_doan&&(r.ket_luan_giai_doan[3]||r.ket_luan_giai_doan[2]))||r.tom_tat_toan_canh.slice(0,260)
  return { risk:deriveRisk(r), specialties, priorities, thread:buildThread(r,names), discussion:{agreement,concern,uncertainty,disagreement}, ask_mdt:buildAskMDT(r,names), consensus }
}

// ─── Engine Giảng dạy (khung bệnh án ngoại khoa HMU + tutor) ──────────────────
function buildDecisions(r){
  const text=[r.chan_doan_chinh,...(r.canh_bao_nguy_co||[]).map(c=>c.mo_ta)].join(" ")
  const has=(...k)=>matchKw(text,k)
  const out=[]
  if(has("lactate","toan")) out.push({ tinh_huong:"Hậu phẫu, lactate tăng cao kèm toan chuyển hóa, bệnh nhân còn phụ thuộc thuốc vận mạch.",
    options:[{k:"A",t:"Giảm vận mạch ngay"},{k:"B",t:"Hồi sức tối ưu huyết động, theo dõi lactate clearance"},{k:"C",t:"Cho ăn đường miệng sớm"},{k:"D",t:"Ngừng theo dõi sát"}],
    dung:"B", giai_thich:"Lactate cao phản ánh giảm tưới máu mô; ưu tiên tối ưu cung lượng tim và theo dõi xu hướng lactate. Giảm vận mạch quá sớm có thể làm nặng tụt tưới máu." })
  if(has("inr","chống đông")) out.push({ tinh_huong:"Bệnh nhân vừa mổ tim, INR vọt lên ngưỡng nguy cơ chảy máu.",
    options:[{k:"A",t:"Tăng liều chống đông"},{k:"B",t:"Giữ nguyên liều"},{k:"C",t:"Tạm ngừng/giảm liều và đánh giá nguy cơ chảy máu"},{k:"D",t:"Truyền chế phẩm máu ngay"}],
    dung:"C", giai_thich:"INR vượt mục tiêu trên bệnh nhân vừa phẫu thuật làm tăng nguy cơ chảy máu; cần giảm/tạm ngừng và đánh giá. Đảo ngược bằng chế phẩm chỉ khi có chảy máu hoặc cần can thiệp." })
  if(out.length===0 && (r.canh_bao_nguy_co||[]).length){ const c=r.canh_bao_nguy_co[0]
    out.push({ tinh_huong:c.mo_ta, options:[{k:"A",t:"Theo dõi tiếp"},{k:"B",t:"Xử trí theo ưu tiên đã nêu"},{k:"C",t:"Cho xuất viện"},{k:"D",t:"Bỏ qua"}], dung:"B", giai_thich:"Đây là vấn đề ưu tiên cao, cần can thiệp theo hướng đã nêu." }) }
  return out
}
function deriveTeaching(r){
  const p=r.thong_tin_benh_nhan
  const dx=expandAbbr(r.chan_doan_chinh)
  const dxl=(r.chan_doan_chinh||"").toLowerCase()
  const dst=r.dau_hieu_sinh_ton
  const kham=[
    dst?`Dấu hiệu sinh tồn (${dst.ngay}): HA ${dst.ha_tt}/${dst.ha_ttr} mmHg, mạch ${dst.mach} l/ph, nhiệt độ ${dst.nhiet_do}, nhịp thở ${dst.nhip_tho}, SpO2 ${dst.spo2}%${dst.lactate!=null?`, lactate ${dst.lactate}`:""}.`:"Theo dõi toàn trạng và các cơ quan theo diễn biến.",
    "Khám tuần hoàn: trọng tâm tiếng tim, tiếng thổi và dấu hiệu suy tim (Nhìn - Sờ - Gõ - Nghe).",
    "Khám hô hấp, tiêu hóa, thận - tiết niệu: phát hiện biến chứng và đánh giá cơ quan liên quan.",
  ]
  const ddx=[]
  if(matchKw(dxl,["hở van","hohl","hở van hai lá","hở van ba lá"])) ddx.push("Hở van do thoái hóa (sa van, đứt dây chằng) với hở van cơ năng do giãn vòng van / bệnh cơ tim.")
  if(matchKw(dxl,["hẹp","hhoc","đmc"])) ddx.push("Hẹp van ĐMC do thoái hóa vôi với van ĐMC hai mảnh bẩm sinh hoặc do thấp tim.")
  if(matchKw(dxl,["suy tim"])) ddx.push("Suy tim do bệnh van tim với suy tim do bệnh cơ tim giãn / thiếu máu cục bộ.")
  if(matchKw(dxl,["tăng áp"])) ddx.push("Tăng áp ĐMP nhóm 2 (do tim trái) với các nhóm tăng áp ĐMP khác.")
  if(ddx.length===0) ddx.push("Phân biệt nguyên nhân dựa trên bệnh cảnh và cận lâm sàng đặc hiệu.")
  const red_flags=(r.canh_bao_nguy_co||[]).filter(c=>c.muc_do==="cao").map(c=>({ dau_hieu:shortLabel(c.can_cu||c.mo_ta), y_nghia:c.mo_ta }))
  const reasoning_score={ items:[
    {ten:"Khai thác bệnh sử", score:9, nx:"Nắm tốt diễn tiến trước - trong - sau mổ."},
    {ten:"Tóm tắt bệnh án", score:8, nx:"Cần làm nổi bật hơn các hội chứng chính."},
    {ten:"Chẩn đoán phân biệt", score:7, nx:"Bổ sung phân biệt nguyên nhân của tổn thương van."},
    {ten:"Chỉ định cận lâm sàng", score:8, nx:"Hợp lý; nên nêu rõ kết quả kỳ vọng."},
    {ten:"Lập kế hoạch điều trị", score:9, nx:"Toàn diện cả nội và ngoại khoa."},
  ], overall:82 }
  return {
    dx, hanh_chinh:`${p.ho_ten}, ${p.tuoi} tuổi, ${p.gioi_tinh}. Địa chỉ: ${p.dia_chi||"-"}. Vào viện: ${p.ngay_vao_vien}. Số bệnh án: ${p.so_benh_an}.`,
    ly_do:r.ly_do_vao_vien, benh_su:(r.dien_bien_lam_sang||[]).map(d=>`${d.ngay}: ${d.mo_ta}`), tien_su:r.tien_su_benh, kham,
    tom_tat:splitSentences(r.tom_tat_toan_canh), chan_doan_so_bo:dx, ddx,
    bien_luan:(r.ly_luan_lam_sang||[]).map(l=>`${l.tieu_de}: ${l.noi_dung}`),
    can_lam_sang:(r.hanh_dong_uu_tien||[]).map(a=>({viec:a.viec,ly_do:a.ly_do})),
    dieu_tri_ngoai:r.phau_thuat?`Ngoại khoa (${r.phau_thuat.ngay}): ${r.phau_thuat.phuong_phap}`:"",
    dieu_tri_noi:(r.thuoc_cuoi_ky||[]).map(m=>`${m.nhom}: ${m.ten_thuoc}`),
    tien_luong:(r.ket_luan_giai_doan&&(r.ket_luan_giai_doan[3]||r.ket_luan_giai_doan[2]))||"",
    red_flags, decisions:buildDecisions(r), reasoning_score,
    muc_tieu:["Khai thác bệnh sử và khám lâm sàng theo khung bệnh án ngoại khoa Đại học Y Hà Nội (HMU).","Tóm tắt thành hội chứng, chẩn đoán sơ bộ và phân biệt.","Biện luận và đề nghị cận lâm sàng hợp lý.","Trình bày điều trị, tiên lượng và dự phòng biến chứng."],
    socratic:[
      { q:"Từ bệnh sử và thăm khám, hãy tóm tắt ca này bằng 1-2 câu (nêu các hội chứng chính).", a:splitSentences(r.tom_tat_toan_canh).slice(0,2).join(" ") },
      { q:"Từ các dữ kiện hiện có, anh/chị nghĩ tới chẩn đoán sơ bộ nào và dựa vào đâu?", a:`${dx} Dựa trên bệnh cảnh suy tim, khám tim mạch và siêu âm tim.` },
      { q:"Vì sao nghĩ đến chẩn đoán đó? Dấu hiệu nào ủng hộ, dữ kiện nào chống lại?", a:(r.ly_luan_lam_sang&&r.ly_luan_lam_sang[0]?r.ly_luan_lam_sang[0].noi_dung:ddx.join(" ")) },
      { q:"Cần phân biệt với những bệnh nào?", a:ddx.join(" ") },
      { q:"Đề nghị cận lâm sàng nào và kỳ vọng kết quả gì?", a:(r.hanh_dong_uu_tien||[]).map(a=>a.viec).join("; ") },
      { q:"Trình bày nguyên tắc điều trị và theo dõi hậu phẫu.", a:`${r.phau_thuat?("Ngoại khoa: "+r.phau_thuat.phuong_phap+". "):""}Nội khoa: ${(r.thuoc_cuoi_ky||[]).map(m=>m.nhom).join(", ")}.` },
    ],
  }
}

// ─── Đăng nhập (demo) ─────────────────────────────────────────────────────────
function LoginPage({ onLogin }){
  const [u, setU] = useState("")
  const [p, setP] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState("")
  const submit = () => {
    if(u.trim()==="hackaithon2026" && p==="medparcours"){ setErr(""); onLogin() }
    else setErr("Tên đăng nhập hoặc mật khẩu không đúng.")
  }
  const FEATURES = [
    { ic:<Icon.FileText d={16} color="#1D6FE8"/>, t:"Tự động phân tích và tóm tắt diễn biến lâm sàng theo 3 giai đoạn." },
    { ic:<Icon.Alert d={16} color="#DC2626"/>, t:"Phát hiện và cảnh báo sớm nguy cơ dựa trên hồ sơ bệnh án." },
    { ic:<Icon.Stethoscope d={16} color="#0E9488"/>, t:"Hỗ trợ hội chẩn đa chuyên khoa (Virtual MDT) và giảng dạy từ Đại học Y Hà Nội (HMU)." },
    { ic:<Icon.Chat d={16} color="#9333EA"/>, t:"Trợ lý ảo MedAmi hỏi đáp chuyên sâu cho từng hồ sơ cụ thể." },
  ]
  const STATS = [
    { v:"~90%", l:"thời gian được tiết kiệm" },
    { v:"~30 giây", l:"cho mỗi báo cáo phân tích" },
    { v:"3 chế độ", l:"Bác sĩ - Hội chẩn - Giảng dạy" },
    { v:"100%", l:"cảnh báo rủi ro lâm sàng" },
  ]
  return (
    <div className="login-wrap">
      <div className="login-bg1"/><div className="login-bg2"/><div className="login-bg3"/>
      <div className="login-inner2">
        <div className="login-grid">
          <div className="login-col-form">
            <div className="login-card">
              <div className="login-logo"><BrandMark size={46} radius={13}/></div>
              <div className="login-brand">Med<em>Parcours</em> <span>AI</span></div>
              <div className="login-sub">Trợ lý lâm sàng cho bác sĩ - Đăng nhập để tiếp tục</div>
              <div className="login-field">
                <label>Tên đăng nhập</label>
                <input value={u} onChange={e=>setU(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Nhập tên đăng nhập" autoFocus/>
              </div>
              <div className="login-field">
                <label>Mật khẩu</label>
                <div className="pw-wrap">
                  <input type={showPw?"text":"password"} value={p} onChange={e=>setP(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Nhập mật khẩu" style={{paddingRight:"40px"}}/>
                  <button type="button" className="pw-eye" onClick={()=>setShowPw(s=>!s)} title={showPw?"Ẩn mật khẩu":"Hiện mật khẩu"} aria-label="Hiện/ẩn mật khẩu">
                    {showPw
                      ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                  </button>
                </div>
              </div>
              {err && <div className="login-err"><Icon.Alert d={14} color="#B91C1C"/>{err}</div>}
              <button className="btn-primary login-btn" onClick={submit}>Đăng nhập</button>
              <div className="login-hint">
                <div className="login-hint-row"><span>Tài khoản dùng thử</span><b>hackaithon2026</b></div>
                <div className="login-hint-row"><span>Mật khẩu</span><b>medparcours</b></div>
              </div>
            </div>
          </div>
          <div className="login-col-hero">
            <div className="login-hero-tag">Nền tảng phân tích bệnh án bằng AI</div>
            <div className="login-team">Team UN1SVENGERS · Vietnamese Student HackAIthon 2026 · Bảng B Challenger · Đề tài 5: Y tế</div>
            <h1 className="login-hero-title">Đọc hồ sơ nhanh hơn,<br/>quyết định lâm sàng tự tin hơn.</h1>
            <p className="login-hero-desc">MedParcours AI đọc hồ sơ HIS, tự động tóm tắt, cảnh báo nguy cơ và hỗ trợ hội chẩn cùng giảng dạy lâm sàng cho bác sĩ và sinh viên y khoa.</p>
            <div className="login-feat">
              {FEATURES.map((f,i)=>(<div key={i} className="login-feat-row"><span className="login-feat-ic">{f.ic}</span>{f.t}</div>))}
            </div>
            <div className="login-stats">
              {STATS.map((s,i)=>(<div key={i} className="login-stat"><div className="login-stat-v">{s.v}</div><div className="login-stat-l">{s.l}</div></div>))}
            </div>
          </div>
        </div>
        <div className="login-logos"><LogoBar/></div>
      </div>
    </div>
  )
}

// ─── Ghi âm tài liệu hỗ trợ (Web Speech API vi-VN, có xử lý quyền + lỗi) ───────
function AudioRecorder({ value, onChange, onAttach }){
  const [supported] = useState(() => typeof window!=="undefined" && !!(window.SpeechRecognition||window.webkitSpeechRecognition))
  const [rec, setRec] = useState(false)
  const [err, setErr] = useState("")
  const ref = useRef(null)         // đối tượng SpeechRecognition
  const finalRef = useRef("")      // tích lũy phần văn bản đã chốt
  const wantRef = useRef(false)    // người dùng còn muốn ghi (để tự khởi động lại khi im lặng)
  const ERR = {
    "not-allowed":"Trang web chưa được cấp quyền micro. Bấm biểu tượng khóa trên thanh địa chỉ, cho phép Micro rồi thử lại.",
    "service-not-allowed":"Trình duyệt chặn dịch vụ nhận dạng giọng nói. Hãy dùng Chrome hoặc Edge mới nhất.",
    "no-speech":"Chưa nghe thấy giọng nói. Hãy nói gần micro hơn rồi thử lại.",
    "audio-capture":"Không tìm thấy micro. Kiểm tra thiết bị micro của máy.",
    "network":"Lỗi mạng: nhận dạng giọng nói cần kết nối Internet.",
  }
  useEffect(() => () => { wantRef.current=false; try{ ref.current && ref.current.stop() }catch{} }, [])
  const start = async () => {
    setErr("")
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if(!SR){ setErr("Trình duyệt chưa hỗ trợ nhận dạng giọng nói. Hãy dùng Chrome/Edge mới nhất."); return }
    // Xin quyền rồi NHẢ micro ngay, nếu không SpeechRecognition sẽ không lấy được audio.
    try {
      if(navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
        const s = await navigator.mediaDevices.getUserMedia({ audio:true })
        s.getTracks().forEach(t => t.stop())
      }
    } catch { setErr("Không truy cập được micro. Hãy cho phép quyền micro cho trang web rồi thử lại."); return }
    const r = new SR()
    r.lang="vi-VN"; r.continuous=true; r.interimResults=true; r.maxAlternatives=1
    finalRef.current = value ? (value.replace(/\s+$/,"") + " ") : ""
    r.onresult = (e) => {
      let interim = ""
      for(let i=e.resultIndex; i<e.results.length; i++){
        const seg = e.results[i][0].transcript
        if(e.results[i].isFinal) finalRef.current += seg + " "
        else interim += seg
      }
      onChange && onChange(finalRef.current + interim)
    }
    r.onerror = (e) => {
      if(e.error==="no-speech") return            // bỏ qua, để tự chạy lại
      wantRef.current = false
      if(e.error!=="aborted") setErr(ERR[e.error] || ("Lỗi ghi âm: "+e.error))
      setRec(false)
    }
    r.onend = () => {
      // Chrome tự dừng sau khoảng lặng; nếu người dùng vẫn muốn ghi thì khởi động lại.
      if(wantRef.current){ try{ r.start() }catch{ setRec(false); wantRef.current=false } }
      else setRec(false)
    }
    ref.current = r
    wantRef.current = true
    try { r.start(); setRec(true) } catch { setErr("Không khởi động được ghi âm. Hãy thử lại sau giây lát."); wantRef.current=false }
  }
  const stop = () => { wantRef.current=false; try{ ref.current && ref.current.stop() }catch{} setRec(false) }
  const attach = () => { const v=(value||"").trim(); if(!v) return; if(rec) stop(); onAttach && onAttach(v); setErr("") }
  const onKey = (e) => { if((e.metaKey||e.ctrlKey) && e.key==="Enter"){ e.preventDefault(); attach() } }
  const chars = (value||"").trim().length
  return (
    <div className={`smart-note${rec?" rec":""}`}>
      <textarea className="smart-note-ta" value={value} onChange={e=>onChange && onChange(e.target.value)} onKeyDown={onKey} placeholder="Nhập lời dặn, chỉ định thêm cho hồ sơ... hoặc bấm micro để đọc bằng giọng nói."/>
      <div className="smart-note-bar">
        <button type="button" className={`sn-mic${rec?" on":""}`} onClick={rec?stop:start} disabled={!supported} title={rec?"Dừng ghi":"Ghi âm bằng giọng nói (vi-VN)"}>
          {rec
            ? <><span className="rec-dot pulse"/>Đang nghe... bấm để dừng</>
            : <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>Ghi âm</>}
        </button>
        <span className="sn-count">{chars>0 ? `${chars} ký tự` : "Ctrl/Cmd + Enter để đính kèm"}</span>
        <span style={{flex:1}}/>
        <button type="button" className="sn-send" onClick={attach} disabled={!(value||"").trim()}><Icon.Send d={13} color="#fff"/>Đính kèm</button>
      </div>
      {!supported && <div className="rec-note warn">Trình duyệt chưa hỗ trợ ghi âm giọng nói. Hãy dùng Chrome hoặc Edge mới nhất (trên trang HTTPS đã xuất bản).</div>}
      {err && <div className="rec-note err"><Icon.Alert d={13} color="#B91C1C"/>{err}</div>}
    </div>
  )
}

// ─── Dropdown chế độ ──────────────────────────────────────────────────────────
const VIEW_MODES = [
  { key:"clinical", label:"Bác sĩ (Lâm sàng)" },
  { key:"hoi_chan", label:"Hội chẩn AI" },
  { key:"teaching", label:"Học vụ (Giảng dạy)" },
]
const MODE_DESC = { clinical:"Tóm tắt & cảnh báo cho bác sĩ", hoi_chan:"Hội đồng chuyên khoa ảo", teaching:"Vấn đáp theo bệnh án Đại học Y Hà Nội (HMU)" }
const MODE_COLOR = { clinical:"#1D6FE8", hoi_chan:"#0E9488", teaching:"#D97706" }
function ModeDropdown({ mode, onChange }){
  const [open, setOpen] = useState(false)
  const cur = VIEW_MODES.find(m=>m.key===mode) || VIEW_MODES[0]
  return (
    <div className="mode-dd">
      <span className="mode-dd-lbl">Chế độ</span>
      <div className="mode-cd">
        <button type="button" className={`mode-cd-btn${open?" open":""}`} onClick={()=>setOpen(o=>!o)}>
          <span className="mode-cd-dot" style={{background:MODE_COLOR[cur.key]||"#1D6FE8"}}/>{cur.label}
          <svg className="mode-cd-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {open && <>
          <div className="mode-cd-ov" onClick={()=>setOpen(false)}/>
          <div className="mode-cd-list">
            {VIEW_MODES.map(m=>(
              <button key={m.key} className={`mode-cd-item${m.key===mode?" sel":""}`} onClick={()=>{onChange(m.key);setOpen(false);mpToast("Đã chuyển sang chế độ: "+m.label)}}>
                <span className="mode-cd-dot" style={{background:MODE_COLOR[m.key]||"#1D6FE8"}}/>
                <span className="mode-cd-txt"><b>{m.label}</b><span>{MODE_DESC[m.key]}</span></span>
                {m.key===mode && <Icon.Dot d={8} color={MODE_COLOR[m.key]||"#1D6FE8"}/>}
              </button>
            ))}
          </div>
        </>}
      </div>
    </div>
  )
}

// ─── Hội chẩn AI ──────────────────────────────────────────────────────────────
const SPEC_ICON = {
  "Tim mạch":{ic:Icon.Heart, c:"#E11D48"},
  "Phẫu thuật Tim":{ic:Icon.Pulse, c:"#1D6FE8"},
  "Hồi sức tích cực":{ic:Icon.Stethoscope, c:"#0E9488"},
  "Truyền nhiễm":{ic:Icon.Shield, c:"#9333EA"},
  "Huyết học - Đông máu":{ic:Icon.Flask, c:"#DC2626"},
  "Thận - Tiết niệu":{ic:Icon.Layers, c:"#0891B2"},
  "Dinh dưỡng lâm sàng":{ic:Icon.Pill, c:"#D97706"},
}
function SpecIcon({ khoa, d=15 }){ const m=SPEC_ICON[khoa]||{ic:Icon.Stethoscope,c:"#1D6FE8"}; const I=m.ic; return <span className="spec-ic" style={{background:m.c+"1A"}}><I d={d} color={m.c}/></span> }
function Step({ n, t }){
  const [collapsed, setCollapsed] = useGlobalCollapse(false)
  const ref = useRef(null)
  return (
    <div ref={ref} className={`mdt-step${collapsed?" collapsed":""}`} onClick={()=>setCollapsed(c=>!c)} role="button" title={collapsed?"Mở rộng":"Thu gọn"}>
      <span className="mdt-step-n">{n}</span><span className="mdt-step-t">{t}</span>
      <span className="sec-tools" onClick={e=>e.stopPropagation()}>
        <FlagBtn pkey={CURRENT_PKEY} label={t} sub="Mục hội chẩn" detail={()=>elText(ref.current && ref.current.nextElementSibling)}/>
        <CopyBtn text={()=>elText(ref.current && ref.current.nextElementSibling)} label=""/>
      </span>
      <span className="mdt-step-chev">{collapsed ? <Icon.ChevDown d={13} color="#94A3B8"/> : <Icon.ChevUp d={13} color="#94A3B8"/>}</span>
    </div>
  )
}
function confClass(p){ return p>=85?"hi":p>=65?"mid":"lo" }
function DiscBlock({ kind, title, items }){
  if(!items||items.length===0) return null
  return <div className={`disc ${kind}`}><div className="disc-t">{title}</div><ul className="ul-clean">{items.map((it,i)=><li key={i}>{it}</li>)}</ul></div>
}
function SpecCard({ y }){
  const [more, setMore] = useState(false)
  return (
    <div className="spec-card">
      <div className="spec-hd">
        <SpecIcon khoa={y.khoa}/>
        <span className="spec-name">{y.khoa}</span>
        {y.muc_cao && <span className="spec-flag">Ưu tiên cao</span>}
        <span className={`conf ${confClass(y.confidence)}`}>Tin cậy {y.confidence}%</span>
      </div>
      <div className="spec-row"><span className="spec-lbl">Kết luận chính</span><ul className="ul-clean">{y.ket_luan_chinh.map((d,j)=><li key={j}>{d}</li>)}</ul></div>
      {y.de_xuat.length>0 && <div className="spec-row"><span className="spec-lbl teal">Đề xuất</span><ul className="ul-clean teal">{y.de_xuat.map((d,j)=><li key={j}>{d}</li>)}</ul></div>}
      <div className="spec-row"><span className="spec-lbl amber">Dữ liệu còn thiếu</span><span className="spec-gap">{y.con_thieu}</span></div>
      {(y.details.danh_gia.length>0 || y.details.ho_tro.length>0) && (
        <>
          <button className="spec-more" onClick={()=>setMore(m=>!m)}>{more?"Thu gọn":"Xem thêm"}</button>
          {more && <div className="spec-detail">
            <div className="spec-lbl">Phân tích chi tiết</div>
            <ul className="ul-clean">{y.details.danh_gia.map((d,j)=><li key={j}>{d}</li>)}</ul>
            {y.details.ho_tro.length>0 && <div className="spec-sup"><b>Dữ liệu hỗ trợ:</b> {y.details.ho_tro.join(" ")}</div>}
          </div>}
        </>
      )}
    </div>
  )
}
function stanceClass(s){ return /có/i.test(s)?"yes":/không/i.test(s)?"no":"neu" }
function MDTView({ report }){
  const [mdt, setMdt] = useState(() => deriveMDT(report))
  const [shown, setShown] = useState(0)
  const [askI, setAskI] = useState(-1)
  useEffect(() => {
    let alive = true
    setMdt(deriveMDT(report))
    mpApi.mdt(report).then(d => { if(alive && d && Array.isArray(d.specialties)) setMdt(d) }).catch(()=>{})
    return () => { alive = false }
  }, [report])
  useEffect(() => {
    setShown(0); setAskI(-1)
    const id=setInterval(()=>setShown(s=>{ if(s>=mdt.specialties.length){clearInterval(id);return s} return s+1 }),520)
    return ()=>clearInterval(id)
  }, [report])
  const done = shown >= mdt.specialties.length
  return (
    <div className="mode-card mdt-card">
      <div className="mode-hero mdt-hero">
        <div className="mode-hero-ic"><Icon.Stethoscope d={22} color="#fff"/></div>
        <div>
          <div className="mode-hero-tag">Hội chẩn AI · Virtual MDT</div>
          <h2>Hội chẩn đa chuyên khoa</h2>
          <p>Hội đồng chuyên gia ảo cùng phân tích và thảo luận ca <b>{report.thong_tin_benh_nhan.ho_ten}</b>: tổng quan nguy cơ, ưu tiên, mời đúng chuyên khoa, thảo luận và ra đồng thuận.</p>
        </div>
      </div>

      <Step n="1" t="Tổng quan nguy cơ (MDT Risk Dashboard)"/>
      <div className="risk-dash">
        {mdt.risk.map((d,i)=>(
          <div key={i} className="risk-row">
            <span className={`risk-dot ${d.tone}`}/>
            <span className="risk-ten">{d.ten}</span>
            <span className="risk-bar"><span className={`risk-fill ${d.tone}`} style={{width:d.pct+"%"}}/></span>
            <span className={`risk-pct ${d.tone}`}>{d.pct}%</span>
          </div>
        ))}
      </div>

      <Step n="2" t="Phân tích ca & xếp ưu tiên lâm sàng"/>
      <div className="prio-wrap">
        {mdt.priorities.map(pr=>(
          <div key={pr.rank} className={`prio p${pr.rank}`}><span className="prio-rank">Ưu tiên {pr.rank}</span><span className="prio-ten">{pr.ten}</span><span className="prio-ly">{pr.ly_do}</span></div>
        ))}
      </div>

      <Step n="3" t="Chuyên khoa được mời tham gia"/>
      <div className="invite-grid">
        {mdt.specialties.map((y,i)=>(
          <div key={i} className="invite">
            <SpecIcon khoa={y.khoa} d={16}/>
            <div className="invite-info"><div className="invite-name">{y.khoa} <span className={`rel ${y.relevance==="Rất cao"?"hi":y.relevance==="Cao"?"mid":"lo"}`}>{y.relevance}</span></div><div className="invite-role">{y.role}</div></div>
          </div>
        ))}
      </div>

      <Step n="4" t="Nhận định theo từng chuyên khoa"/>
      <div className="spec-list">
        {mdt.specialties.slice(0,shown).map((y,i)=><SpecCard key={i} y={y}/>)}
        {!done && <div className="mdt-loading"><span className="mdt-typing"><i/><i/><i/></span>{mdt.specialties[shown] ? `${mdt.specialties[shown].khoa} đang trình bày nhận định...` : "Hội đồng đang tổng hợp ý kiến..."}<span className="mdt-progress">{shown}/{mdt.specialties.length} khoa</span></div>}
      </div>

      {done && <>
        <div className="mdt-reached"><Icon.ShieldCheck d={15} color="#0E9488"/>Hội đồng đã hoàn tất thảo luận và đạt đồng thuận</div>
        <Step n="5" t="Thảo luận liên chuyên khoa"/>
        <div className="thread">
          {mdt.thread.map((m,i)=>(
            <div key={i} className="thread-row"><SpecIcon khoa={m.khoa} d={14}/><div className="thread-bub"><span className="thread-khoa">{m.khoa}</span>{m.text}</div></div>
          ))}
        </div>

        <Step n="6" t="Đồng thuận - Lưu ý - Chưa chắc chắn - Khác biệt"/>
        <div className="disc-grid">
          <DiscBlock kind="agree" title="Đồng thuận" items={mdt.discussion.agreement}/>
          <DiscBlock kind="concern" title="Cần lưu ý" items={mdt.discussion.concern}/>
          <DiscBlock kind="uncert" title="Chưa chắc chắn" items={mdt.discussion.uncertainty}/>
          <DiscBlock kind="disagree" title="Khác biệt quan điểm" items={mdt.discussion.disagreement}/>
        </div>

        <Step n="7" t="Kết luận hội chẩn"/>
        <div className="mdt-final"><div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"4px"}}><span className="mdt-final-lbl" style={{margin:0}}>Đồng thuận cuối cùng</span><span style={{marginLeft:"auto"}}><CopyBtn text={mdt.consensus} label=""/></span></div>{mdt.consensus}</div>

        <Step n="8" t="Hỏi Hội đồng (Ask the MDT)"/>
        <div className="ask-qs">
          {mdt.ask_mdt.map((a,i)=>(<button key={i} className={`ask-q${askI===i?" on":""}`} onClick={()=>setAskI(askI===i?-1:i)}>{a.q}</button>))}
        </div>
        {askI>=0 && (
          <div className="ask-ans">
            {mdt.ask_mdt[askI].answers.map((a,j)=>(
              <div key={j} className="ask-row"><span className="ask-khoa"><SpecIcon khoa={a.khoa} d={13}/>{a.khoa}</span><span className={`stance ${stanceClass(a.stance)}`}>{a.stance}</span><span className="ask-txt">{a.ly_do}</span></div>
            ))}
            <div className="ask-cons"><span className="ask-cons-hd">Điều phối viên · Mức đồng thuận: {mdt.ask_mdt[askI].moderator.muc}</span>{mdt.ask_mdt[askI].moderator.khuyen_nghi}</div>
          </div>
        )}
      </>}
    </div>
  )
}

function TeachCard({ n, title, children, accent }){
  const [collapsed, setCollapsed] = useGlobalCollapse(false)
  const bodyRef = useRef(null)
  return (
    <div className={`teach-sec${accent?" "+accent:""}${collapsed?" collapsed":""}`}>
      <div className="teach-sec-t" onClick={()=>setCollapsed(c=>!c)} style={{cursor:"pointer"}} title={collapsed?"Mở rộng":"Thu gọn"}>
        <span className="teach-sec-n">{n}</span>{title}
        <span className="sec-tools" onClick={e=>e.stopPropagation()}>
          <FlagBtn pkey={CURRENT_PKEY} label={typeof title === "string" ? title : "Mục giảng dạy"} sub="Mục giảng dạy" detail={()=>elText(bodyRef.current)}/>
          <CopyBtn text={()=>elText(bodyRef.current)} label=""/>
        </span>
        <span className="teach-sec-chev">{collapsed ? <Icon.ChevDown d={13} color="#94A3B8"/> : <Icon.ChevUp d={13} color="#94A3B8"/>}</span>
      </div>
      {!collapsed && <div className="teach-sec-b" ref={bodyRef}>{children}</div>}
    </div>
  )
}
function TeachingView({ report }){
  const [t, setT] = useState(() => deriveTeaching(report))
  const [sub, setSub] = useState("guided")
  useEffect(() => {
    let alive = true
    setT(deriveTeaching(report))
    mpApi.teaching(report).then(d => { if(alive && d && Array.isArray(d.socratic)) setT(d) }).catch(()=>{})
    return () => { alive = false }
  }, [report])
  const [revealAns, setRevealAns] = useState(false)
  const [open, setOpen] = useState(() => ({}))
  const [pick, setPick] = useState(() => ({}))
  useEffect(()=>{ setRevealAns(false); setOpen({}); setPick({}) }, [sub, report])
  const toggle = (i) => setOpen(o => ({ ...o, [i]: !o[i] }))
  const challenge = sub==="challenge"
  const showAns = !challenge || revealAns
  let n = 0; const num = () => ++n
  return (
    <div className="mode-card teach-card">
      <div className="mode-hero teach-hero">
        <div className="mode-hero-ic teal"><Icon.FileText d={20} color="#fff"/></div>
        <div>
          <div className="mode-hero-tag teal">Học vụ · Giảng viên lâm sàng ảo</div>
          <h2>Chế độ giảng dạy</h2>
          <p>Vấn đáp lâm sàng theo khung bệnh án ngoại khoa Đại học Y Hà Nội (HMU) trên ca <b>{report.thong_tin_benh_nhan.ho_ten}</b>: tự suy luận, nhận phản biện và đánh giá.</p>
        </div>
      </div>

      <div className="teach-submode">
        <span className="teach-submode-lbl">Phương pháp học</span>
        <div className="teach-seg">
          <button className={!challenge?"on":""} onClick={()=>setSub("guided")}>Dẫn dắt (Guided)</button>
          <button className={challenge?"on":""} onClick={()=>setSub("challenge")}>Tự thử thách (Challenge)</button>
        </div>
        <span className="teach-mode-note">{challenge?"Ẩn đáp án - bạn tự suy luận trước, mở đáp án sau khi hoàn thành.":"Hiển thị đầy đủ nội dung để học và ôn tập."}</span>
      </div>

      <TeachCard n={num()} title="Mục tiêu học tập"><ol className="ol-num">{t.muc_tieu.map((x,i)=><li key={i}>{x}</li>)}</ol></TeachCard>

      <div className="teach-block-h">Dữ kiện bệnh án</div>
      <TeachCard n={num()} title="Hành chính"><p className="teach-p">{t.hanh_chinh}</p></TeachCard>
      <TeachCard n={num()} title="Lý do vào viện"><p className="teach-p">{t.ly_do}</p></TeachCard>
      <TeachCard n={num()} title="Bệnh sử"><ul className="ul-clean">{t.benh_su.map((x,i)=><li key={i}>{x}</li>)}</ul></TeachCard>
      <TeachCard n={num()} title="Tiền sử"><p className="teach-p">{t.tien_su}</p></TeachCard>
      <TeachCard n={num()} title="Khám lâm sàng"><ul className="ul-clean">{t.kham.map((x,i)=><li key={i}>{x}</li>)}</ul></TeachCard>

      <div className="teach-block-h">Red Flags - điểm cần ghi nhớ</div>
      <div className="rf-wrap">
        {t.red_flags.map((rf,i)=>(
          <div key={i} className="rf"><span className="rf-ic"><Icon.Alert d={14} color="#DC2626"/></span><div><div className="rf-dh">{rf.dau_hieu}</div><div className="rf-yn">{rf.y_nghia}</div></div></div>
        ))}
      </div>

      <div className="teach-block-h">Vấn đáp Socratic</div>
      <div className="teach-soc">
        <div className="teach-soc-hd"><span className="teach-soc-ic">?</span><div><div className="teach-soc-t">Giảng viên ảo đặt câu hỏi theo từng bước</div><div className="teach-soc-s">Nhập câu trả lời của bạn, sau đó mở nhận xét và đáp án mẫu.</div></div></div>
        {t.socratic.map((qa,i)=>(
          <div key={i} className="teach-q open">
            <div className="teach-q-t"><span className="teach-q-num">Bước {i+1}</span><span>{qa.q}</span></div>
            <textarea className="teach-ans" placeholder="Nhập câu trả lời của bạn..."/>
            <button className="teach-reveal" onClick={()=>toggle(i)}>{open[i]?"Ẩn nhận xét":"Xem nhận xét & đáp án mẫu"}</button>
            {open[i] && <div className="teach-q-a"><div className="teach-q-fb"><b>Nhận xét:</b> đối chiếu xem bạn đã nêu đủ ý chính, trình bày theo trình tự bệnh án và logic chưa.</div><div><span className="teach-q-a-lbl">Đáp án mẫu</span>{qa.a}</div></div>}
          </div>
        ))}
      </div>

      {t.decisions.length>0 && <>
        <div className="teach-block-h">Tình huống ra quyết định (Clinical Decision Challenge)</div>
        {t.decisions.map((dc,i)=>(
          <div key={i} className="dc">
            <div className="dc-q">{dc.tinh_huong}</div>
            <div className="dc-opts">
              {dc.options.map(o=>{
                const chosen = pick[i]
                const cls = chosen ? (o.k===dc.dung?"ok":(o.k===chosen?"wrong":"")) : ""
                return <button key={o.k} className={`dc-opt ${cls}`} onClick={()=>setPick(pk=>({...pk,[i]:o.k}))}><b>{o.k}.</b> {o.t}</button>
              })}
            </div>
            {pick[i] && <div className={`dc-fb ${pick[i]===dc.dung?"ok":"wrong"}`}>{pick[i]===dc.dung?"Chính xác. ":"Chưa tối ưu. "}{dc.giai_thich}</div>}
          </div>
        ))}
      </>}

      <div className="teach-block-h">Đáp án tham khảo</div>
      {challenge && !revealAns
        ? <button className="teach-unlock" onClick={()=>setRevealAns(true)}><Icon.Search d={14} color="#0E9488"/>Mở đáp án tham khảo (sau khi đã tự suy luận)</button>
        : <>
          <TeachCard n={num()} title="Tóm tắt bệnh án"><ul className="ul-clean">{t.tom_tat.map((x,i)=><li key={i}>{x}</li>)}</ul></TeachCard>
          <TeachCard n={num()} title="Chẩn đoán sơ bộ"><p className="teach-p">{t.chan_doan_so_bo}</p></TeachCard>
          <TeachCard n={num()} title="Chẩn đoán phân biệt"><ul className="ul-clean">{t.ddx.map((x,i)=><li key={i}>{x}</li>)}</ul></TeachCard>
          <TeachCard n={num()} title="Biện luận lâm sàng"><ul className="ul-clean">{t.bien_luan.map((x,i)=><li key={i}>{x}</li>)}</ul></TeachCard>
          <TeachCard n={num()} title="Đề nghị cận lâm sàng"><ul className="ul-pair">{t.can_lam_sang.map((x,i)=><li key={i}><b>{x.viec}</b><span>{x.ly_do}</span></li>)}</ul></TeachCard>
          <TeachCard n={num()} title="Hướng điều trị">{t.dieu_tri_ngoai&&<p className="teach-p" style={{marginBottom:"8px"}}>{t.dieu_tri_ngoai}</p>}<div className="teach-chips">{t.dieu_tri_noi.map((m,i)=><span key={i} className="teach-chip">{m}</span>)}</div></TeachCard>
          <TeachCard n={num()} title="Tiên lượng & dự phòng"><p className="teach-p">{t.tien_luong}</p></TeachCard>
        </>}

      <div className="teach-block-h">Đánh giá năng lực suy luận lâm sàng</div>
      <div className="score-card">
        {t.reasoning_score.items.map((s,i)=>(
          <div key={i} className="score-row">
            <span className="score-ten">{s.ten}</span>
            <span className="score-bar"><span className="score-fill" style={{width:(s.score*10)+"%"}}/></span>
            <span className="score-num">{s.score}/10</span>
            <span className="score-nx">{s.nx}</span>
          </div>
        ))}
        <div className="score-overall">Tổng điểm: <b>{t.reasoning_score.overall}/100</b></div>
      </div>
    </div>
  )
}

// ─── Lịch sử bệnh án (overlay) ────────────────────────────────────────────────
function HistoryPanel({ onClose, onOpen, currentId }){
  return (
    <div className="hist-overlay" onClick={onClose}>
      <div className="hist-modal" onClick={e=>e.stopPropagation()}>
        <div className="hist-head">
          <span className="hist-title"><Icon.FileText d={17} color="#1D6FE8"/>Lịch sử bệnh án</span>
          <button className="fp-close" onClick={onClose} title="Đóng"><Icon.Close d={15} color="#475569"/></button>
        </div>
        <div className="hist-list">
          {HISTORY.map(rec=>(
            <div key={rec.id} className={`hist-item${rec.id===currentId?" cur":""}`} onClick={()=>onOpen(rec)}>
              <div className="hist-avatar">{rec.ho_ten.charAt(0)}</div>
              <div className="hist-info">
                <div className="hist-name">{rec.ho_ten} <span className="hist-meta">{rec.tuoi} tuổi, {rec.gioi_tinh} · BA {rec.so_benh_an}</span></div>
                <div className="hist-dx">{expandAbbr(rec.chan_doan)}</div>
                <div className="hist-foot"><Icon.Clock d={11} color="#94a3b8"/>Vào viện {rec.ngay_vao_vien} · {rec.bac_si}</div>
              </div>
              <span className="hist-open">Mở ▶</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── EcgPanel: công cụ quét/số hóa điện tâm đồ — ĐỘC LẬP với report ─────────
// Khác với RiskScoresCard/CareGapCard (gắn liền 1 bệnh nhân đã phân tích),
// đây là công cụ phụ trợ riêng: bác sĩ upload ảnh ECG bất kỳ (không cần đã
// phân tích hồ sơ PDF nào) để số hóa lại + ước tính nhịp tim. Mở dạng overlay
// full-screen (giống HistoryPanel) thay vì 1 tab trong ReportPage, vì không
// có mối quan hệ dữ liệu nào với report hiện tại (nếu có).
//
// AN TOÀN: chỉ trực quan hóa hỗ trợ, KHÔNG tự chẩn đoán. Không hiện sẵn dữ
// liệu demo/ảnh tổng hợp giả làm ví dụ — tránh gây hiểu lầm là dữ liệu thật
// (đã xác nhận với Đăng). Trạng thái mặc định là "trống, mời upload".
function EcgPanel({ onClose }) {
  const [staged, setStaged] = useState(null)      // { url, name } ảnh đã chọn
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)       // response từ /ecg
  const [error, setError] = useState(null)
  const inputRef = useRef()

  const reset = () => { setStaged(null); setResult(null); setError(null) }

  const onPickFile = (file) => {
    if (!file) return
    reset()
    const url = URL.createObjectURL(file)
    setStaged({ url, name: file.name, file })
  }

  const analyze = async () => {
    if (!staged?.file) return
    setLoading(true); setError(null)
    try {
      const buf = await staged.file.arrayBuffer()
      const b64 = btoa(new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ""))
      const res = await fetch(`${API_URL}/ecg`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: b64 }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data?.detail || "Không số hóa được ảnh.")
      setResult(data)
    } catch (e) {
      setError(e.message || "Lỗi không xác định khi xử lý ảnh.")
    }
    setLoading(false)
  }

  // Vẽ lại signal[] thành đường SVG (polyline đơn giản, không cần lib biểu đồ)
  const signalPath = (signal, w = 600, h = 160) => {
    if (!signal || signal.length === 0) return ""
    const stepX = w / signal.length
    return signal.map((v, i) => `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(1)} ${(h - v * h).toFixed(1)}`).join(" ")
  }

  return (
    <div className="ecg-overlay" onClick={onClose}>
      <div className="ecg-modal" onClick={e => e.stopPropagation()}>
        <div className="hist-head">
          <span className="hist-title"><Icon.Pulse d={17} color="#1D6FE8"/>Quét điện tâm đồ (ECG)</span>
          <button className="fp-close" onClick={onClose} title="Đóng"><Icon.Close d={15} color="#475569"/></button>
        </div>

        <div className="ecg-disclaimer">
          <Icon.Alert d={13} color="#D97706"/>
          Công cụ trực quan hóa hỗ trợ — số hóa lại ảnh ECG và ước tính nhịp tim. KHÔNG tự chẩn đoán (không gán "rung nhĩ", "block nhĩ thất"...). Mọi kết quả cần bác sĩ xác nhận.
        </div>

        <input ref={inputRef} type="file" accept=".png,.jpg,.jpeg" style={{ display: "none" }}
          onChange={e => { onPickFile(e.target.files[0]); e.target.value = "" }}/>

        {!staged && (
          <div className="ecg-dropzone" onClick={() => inputRef.current.click()}>
            <Icon.Upload d={26} color="#1D6FE8"/>
            <p className="upload-title">Chọn ảnh điện tâm đồ</p>
            <p className="upload-sub">Ảnh chụp/scan, định dạng PNG hoặc JPG</p>
          </div>
        )}

        {staged && (
          <div className="ecg-workspace">
            <div className="ecg-col">
              <div className="ecg-col-label">Ảnh gốc</div>
              <img src={staged.url} alt={staged.name} className="ecg-img"/>
              <div className="ecg-actions">
                <button className="stage-clear" onClick={reset}>Chọn ảnh khác</button>
                {!result && <button className="btn-primary" onClick={analyze} disabled={loading}>
                  {loading ? "Đang xử lý..." : "Số hóa & ước tính nhịp tim"}
                </button>}
              </div>
            </div>

            <div className="ecg-col">
              <div className="ecg-col-label">Kết quả số hóa</div>
              {loading && <div className="ecg-loading">Đang xử lý ảnh...</div>}
              {error && <div className="rec-note err"><Icon.Alert d={13} color="#B91C1C"/>{error}</div>}
              {result && (
                <>
                  <svg viewBox="0 0 600 160" className="ecg-signal-svg">
                    <path d={signalPath(result.signal)} fill="none" stroke="#DC2626" strokeWidth="1.5"/>
                  </svg>
                  {result.warning && (
                    <div className="rec-note warn"><Icon.Alert d={13} color="#92400e"/>{result.warning}</div>
                  )}
                  <div className="ecg-hr-row">
                    <div className="ecg-hr-box">
                      <div className="ecg-hr-lbl">Nhịp tim ước tính</div>
                      <div className="ecg-hr-val">
                        {result.heart_rate?.bpm_avg != null ? `${result.heart_rate.bpm_avg} lần/phút` : "Không xác định"}
                      </div>
                    </div>
                    <div className="ecg-hr-box">
                      <div className="ecg-hr-lbl">Độ tin cậy tỉ lệ px/mm</div>
                      <div className="ecg-hr-val" style={{fontSize:14}}>
                        {result.calibration?.do_tin_cay === "cao" ? "Cao" : result.calibration?.do_tin_cay === "trung_binh" ? "Trung bình" : "Thấp / không xác định"}
                      </div>
                    </div>
                  </div>
                  {result.heart_rate?.nhip_deu_theo_nguong_sach === false && (
                    <div className="rec-note warn">
                      <Icon.Alert d={13} color="#92400e"/>
                      Khoảng R-R dao động vượt ngưỡng tham khảo — nghi ngờ nhịp không đều, cần bác sĩ xác nhận trực tiếp trên ảnh gốc.
                    </div>
                  )}
                  {result.heart_rate?.warning && (
                    <div className="rec-note err"><Icon.Alert d={13} color="#B91C1C"/>{result.heart_rate.warning}</div>
                  )}
                  <div className="drug-disclaimer">{result.disclaimer}</div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// CSS bổ sung cho các tính năng demo
const EXTRA_CSS = `
.login-wrap{position:relative;min-height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;background:radial-gradient(1200px 600px at 15% 10%,#13284a 0%,#0A1628 55%),linear-gradient(135deg,#0A1628,#0d2444 55%,#0E5a55);padding:28px 16px}
.login-bg1,.login-bg2,.login-bg3{position:absolute;border-radius:50%;filter:blur(20px);opacity:.5;pointer-events:none}
.login-bg1{width:420px;height:420px;background:radial-gradient(circle,#1D6FE8,transparent 70%);top:-120px;left:-80px}
.login-bg2{width:380px;height:380px;background:radial-gradient(circle,#0E9488,transparent 70%);bottom:-120px;right:-60px}
.login-bg3{width:260px;height:260px;background:radial-gradient(circle,#7FE7F5,transparent 70%);top:40%;right:18%;opacity:.25}
.login-inner{position:relative;z-index:1;width:100%;max-width:760px;display:flex;flex-direction:column;align-items:center;gap:22px}
.login-card{width:100%;max-width:400px;background:rgba(255,255,255,.97);border-radius:22px;padding:34px 30px;box-shadow:0 30px 70px rgba(0,0,0,.35);text-align:center;backdrop-filter:blur(6px)}
.login-logo{display:flex;justify-content:center;margin-bottom:12px}
.login-brand{font-size:26px;font-weight:800;color:#0F2740;letter-spacing:-.3px}.login-brand em{color:#1D6FE8;font-style:normal}.login-brand span{color:#5A748F;font-weight:700;font-size:17px}
.login-sub{font-size:13px;color:#7A96C8;margin:6px 0 24px}
.login-field{text-align:left;margin-bottom:15px}
.login-field label{display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:6px}
.login-field input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #d8e2f0;border-radius:11px;font-size:14px;outline:none;transition:border .15s,box-shadow .15s}
.login-field input:focus{border-color:#1D6FE8;box-shadow:0 0 0 3px rgba(29,111,232,.12)}
.login-err{display:flex;align-items:center;gap:7px;background:#FEF2F2;color:#B91C1C;font-size:12.5px;padding:9px 12px;border-radius:9px;margin-bottom:13px;text-align:left}
.login-btn{width:100%;justify-content:center;margin-top:4px;padding:12px}
.login-hint{margin-top:18px;border-top:1px dashed #e7eef8;padding-top:14px;display:flex;flex-direction:column;gap:7px}
.login-hint-row{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#94a3b8}
.login-hint-row b{color:#1D6FE8;font-size:12.5px;background:rgba(29,111,232,.08);padding:3px 10px;border-radius:7px}
.login-logos{width:100%;background:rgba(255,255,255,.96);border-radius:18px;padding:6px 8px;box-shadow:0 16px 40px rgba(0,0,0,.22)}
.login-logos .logo-bar{margin:0;border:none;background:transparent}
.rec-panel{margin-top:14px;border:1px solid #dbe6f5;border-radius:16px;padding:16px;background:linear-gradient(180deg,rgba(29,111,232,.045),rgba(14,148,136,.03))}
.rec-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:10px}
.rec-title{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:700;color:#0F2740}
.rec-tag{font-size:11px;font-weight:600;color:#1D6FE8;background:rgba(29,111,232,.1);padding:4px 9px;border-radius:8px;white-space:nowrap}
.rec-row{display:flex;gap:10px;align-items:center;margin-bottom:10px}
.rec-btn{display:inline-flex;align-items:center;gap:9px;border:none;background:#1D6FE8;color:#fff;font-size:13px;font-weight:600;padding:10px 18px;border-radius:11px;cursor:pointer;transition:background .15s,transform .1s}
.rec-btn:hover{background:#1559bf}.rec-btn:active{transform:scale(.98)}
.rec-btn.on{background:#DC2626}.rec-btn.on:hover{background:#b91c1c}
.rec-live{font-size:12px;color:#DC2626;font-weight:600}
.rec-clear{border:1px solid #d8e2f0;background:#fff;color:#475569;font-size:12px;padding:9px 13px;border-radius:10px;cursor:pointer}
.rec-dot{width:9px;height:9px;border-radius:50%;background:#fff;display:inline-block}
.rec-dot.pulse{animation:recPulse 1s infinite}
@keyframes recPulse{0%,100%{opacity:1}50%{opacity:.25}}
.rec-text{width:100%;box-sizing:border-box;min-height:78px;border:1px solid #d8e2f0;border-radius:11px;padding:11px 13px;font-size:13px;resize:vertical;outline:none;font-family:inherit;line-height:1.55}
.rec-text:focus{border-color:#1D6FE8}
.rec-note{font-size:11.5px;color:#7A96C8;margin-top:9px;line-height:1.55;display:flex;align-items:flex-start;gap:6px}
.rec-note.err{color:#B91C1C;background:#FEF2F2;padding:8px 11px;border-radius:9px}
.rec-note.warn{color:#92400e;background:#FFFBEB;padding:9px 12px;border-radius:9px}
.rec-note.dim{color:#9fb2cc}
.mode-dd{display:inline-flex;align-items:center;gap:6px;margin-right:6px}
.mode-dd-lbl{font-size:12px;color:#7A96C8;font-weight:600}
.mode-dd select{font-size:13px;font-weight:600;color:#0F2740;border:1px solid #d8e2f0;border-radius:9px;padding:7px 10px;background:#fff;cursor:pointer;outline:none}
.mode-dd select:focus{border-color:#1D6FE8}
.mode-card{max-width:960px;margin:0 auto;background:#fff;border:1px solid #e7eef8;border-radius:18px;padding:0 0 24px;box-shadow:0 6px 28px rgba(10,22,40,.06);overflow:hidden}
.mode-hero{display:flex;gap:16px;align-items:flex-start;padding:24px 26px;color:#fff}
.mdt-hero{background:linear-gradient(120deg,#1A56DB,#1D6FE8 55%,#0E9488)}
.teach-hero{background:linear-gradient(120deg,#0E7c73,#0E9488 55%,#1D6FE8)}
.mode-hero-ic{width:46px;height:46px;border-radius:13px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.mode-hero-tag{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;opacity:.85;margin-bottom:3px}
.mode-hero h2{font-size:21px;font-weight:800;margin:0 0 5px}
.mode-hero p{font-size:13px;line-height:1.6;margin:0;opacity:.95}
.mode-hero b{font-weight:700}
.mdt-step{display:flex;align-items:center;gap:9px;margin:20px 26px 10px}
.mdt-step-n{width:22px;height:22px;border-radius:50%;background:#1D6FE8;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.mdt-step-t{font-size:14px;font-weight:800;color:#0F2740}
.mdt-khoa{display:flex;flex-wrap:wrap;gap:8px;padding:0 26px}
.mdt-khoa-chip{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:#1D6FE8;background:rgba(29,111,232,.07);border:1px solid rgba(29,111,232,.16);padding:5px 11px 5px 5px;border-radius:20px}
.mdt-khoa-ava{width:22px;height:22px;border-radius:50%;background:#1D6FE8;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;text-transform:uppercase}
.mdt-list{display:flex;flex-direction:column;gap:11px;padding:0 26px}
.mdt-op{border:1px solid #e7eef8;border-radius:14px;padding:14px 16px;background:#fafcff;animation:fadeIn .4s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
.mdt-op-hd{display:flex;align-items:center;gap:9px;margin-bottom:9px}
.mdt-op-ava{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#1D6FE8,#0E9488);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;text-transform:uppercase;flex-shrink:0}
.mdt-op-name{font-size:14px;font-weight:700;color:#0F2740}
.mdt-op-flag{font-size:10.5px;font-weight:700;color:#DC2626;background:#FEF2F2;padding:3px 9px;border-radius:7px;margin-left:auto}
.mdt-sub{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:#1D6FE8;margin:6px 0 4px}
.mdt-sub.teal{color:#0E9488}
.ul-clean{list-style:none;margin:0;padding:0}
.ul-clean li{position:relative;padding-left:18px;font-size:13px;color:#334155;line-height:1.65;margin-bottom:5px}
.ul-clean li:before{content:"";position:absolute;left:2px;top:8px;width:6px;height:6px;border-radius:50%;background:#1D6FE8}
.ul-clean.teal li:before{background:#0E9488}
.ul-clean.red li{color:#9f1d1d}.ul-clean.red li:before{background:#EF4444}
.mdt-loading{display:flex;align-items:center;gap:8px;font-size:13px;color:#7A96C8;padding:6px 2px}
.mdt-loading .rec-dot{background:#1D6FE8}
.mdt-typing{display:inline-flex;align-items:center;gap:3px}
.mdt-typing i{width:5px;height:5px;border-radius:50%;background:#1D6FE8;display:inline-block;animation:mdtBlink 1s infinite ease-in-out}
.mdt-typing i:nth-child(2){animation-delay:.18s}
.mdt-typing i:nth-child(3){animation-delay:.36s}
@keyframes mdtBlink{0%,60%,100%{opacity:.25;transform:translateY(0)}30%{opacity:1;transform:translateY(-2px)}}
.mdt-progress{margin-left:auto;font-size:11.5px;font-weight:600;color:#9fb2cc;background:#f1f5fb;padding:3px 9px;border-radius:20px}
.mdt-reached{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600;color:#0E7C70;background:linear-gradient(135deg,rgba(14,148,136,.12),rgba(29,111,232,.08));border:1px solid rgba(14,148,136,.25);border-radius:11px;padding:11px 14px;margin:4px 0 14px;animation:reachedIn .4s ease}
@keyframes reachedIn{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
.prio-count{border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);cursor:pointer;transition:all .14s;font-size:11.5px;border-radius:20px;padding:4px 10px;display:inline-flex;align-items:center;gap:6px;font-weight:600}
.prio-count:hover{background:rgba(255,255,255,.18)}
.prio-count.on{background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.12)}
.prio-count.clear{color:#fff!important;background:rgba(255,255,255,.14)}
.prio-board.one{grid-template-columns:1fr}
.ecmp{border:1px solid var(--border);border-radius:13px;padding:14px 15px;margin:14px 0;background:var(--glass)}
.ecmp-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--navy);margin-bottom:11px}
.ecmp-pick{display:flex;align-items:center;gap:9px;margin-bottom:12px;flex-wrap:wrap}
.ecmp-pick select{border:1px solid var(--border);border-radius:9px;padding:7px 10px;font-size:12.5px;font-family:inherit;color:var(--navy);background:var(--glass);cursor:pointer;outline:none}
.ecmp-pick select:focus{border-color:var(--blue)}
.ecmp-vs{font-size:12px;color:var(--muted);font-weight:600}
.ecmp-row{display:grid;grid-template-columns:1.6fr .8fr auto .8fr 1.3fr;align-items:center;gap:8px;padding:8px 0;border-top:1px dashed var(--border);font-size:12.5px}
.ecmp-lbl{color:var(--muted2);font-weight:600}
.ecmp-a,.ecmp-b{font-weight:700;color:var(--navy);text-align:center}
.ecmp-arrow{color:var(--muted);font-size:11px;text-align:center}
.ecmp-d{font-weight:700;font-size:12px;text-align:right}
.ecmp-d.good{color:var(--green)}
.ecmp-d.bad{color:var(--red)}
.ecmp-d.flat{color:var(--muted)}
.ecmp-notes{margin-top:11px;display:flex;flex-direction:column;gap:5px;font-size:11.5px;color:var(--muted2);line-height:1.5}
@media(max-width:620px){.ecmp-row{grid-template-columns:1fr 1fr auto 1fr;}.ecmp-lbl{grid-column:1/-1}}
.theme-toggle{width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;background:#f1f5fb;border:1px solid #e2e8f0;border-radius:11px;color:#475569;cursor:pointer;transition:all .15s}
.theme-toggle:hover{background:#e7eef8;border-color:#1D6FE8;color:#1D6FE8}
body.theme-dark{
  --blue:#5B95F2; --blue-dk:#7BACF7; --blue-lt:#1A2942;
  --cyan:#2DD4BF; --teal:#2DD4BF; --green:#34D399; --red:#F87171; --amber:#FBBF24;
  --navy:#E8EEF7; --navy2:#C7D4E6; --navy3:#9FB3CC;
  --muted:#94A7C0; --muted2:#AEBFD4;
  --border:#2A3650; --glass:#161E2E;
  --page-bg:#0E1626;
  --shadow-sm:0 1px 2px rgba(0,0,0,.35); --shadow-md:0 8px 22px rgba(0,0,0,.45);
  background:#0E1626; color:#E8EEF7;
}
body.theme-dark .app,body.theme-dark .report-outer,body.theme-dark .upload-page,body.theme-dark .up-wrap{background:transparent}
body.theme-dark .card,body.theme-dark .mode-card,body.theme-dark .prio-col,body.theme-dark .echo-tbl-wrap,body.theme-dark .ecmp,body.theme-dark .sidebar-minimap,body.theme-dark .chip-bar,body.theme-dark .hist-panel,body.theme-dark .summary-card,body.theme-dark .smart-note,body.theme-dark .stat-block,body.theme-dark .upload-card,body.theme-dark .drop-zone{background:var(--glass);border-color:var(--border);color:var(--navy)}
body.theme-dark .nav,body.theme-dark .topnav,body.theme-dark .nav-bar{background:#11192A;border-color:var(--border)}
body.theme-dark .theme-toggle,body.theme-dark .nav-burger{background:#1B2536;border-color:var(--border);color:var(--navy2)}
body.theme-dark .nav-menu,body.theme-dark .mode-cd-list,body.theme-dark .mode-cd-btn,body.theme-dark .rpt-search{background:#1B2536;border-color:var(--border);color:var(--navy)}
body.theme-dark .nav-menu button,body.theme-dark .mode-cd-item{color:var(--navy2)}
body.theme-dark .nav-menu button:hover,body.theme-dark .mode-cd-item:hover{background:#222E44}
body.theme-dark input,body.theme-dark textarea,body.theme-dark select,body.theme-dark .smart-note-ta{background:#0F1828;color:var(--navy);border-color:var(--border)}
body.theme-dark .smart-note-bar{background:#131D2E;border-color:var(--border)}
body.theme-dark .tb-group,body.theme-dark .tab-group,body.theme-dark .echo-seg{background:#1B2536}
body.theme-dark .cfm{background:#1B2536;color:var(--navy)}
body.theme-dark .prio-box,body.theme-dark .invite{background:#1B2536;border-color:var(--border)}

/* ===== DARK MODE v2: toi han, chu sang ===== */
body.theme-dark{background:#0A1220;color:#EAF1FB}
body.theme-dark .upload-page,body.theme-dark .report-outer,body.theme-dark .report-main,body.theme-dark .mode-wrap{background:transparent}
body.theme-dark .nav,body.theme-dark .chip-bar,body.theme-dark .topbar{background:#0E1828;border-color:#28364E}
body.theme-dark .hero-status,body.theme-dark .stage-card,body.theme-dark .fp-modal,body.theme-dark .fp-frame,body.theme-dark .modal-box,body.theme-dark .hist-modal,body.theme-dark .fc-panel,body.theme-dark .spec-card,body.theme-dark .prio-col,body.theme-dark .prio-box,body.theme-dark .reason-phase,body.theme-dark .rf,body.theme-dark .ask-q,body.theme-dark .teach-q,body.theme-dark .dc-opt,body.theme-dark .cfm,body.theme-dark .nav-menu,body.theme-dark .mode-cd-list,body.theme-dark .mode-cd-btn,body.theme-dark .rpt-search,body.theme-dark .smart-note,body.theme-dark .note-upload,body.theme-dark .mode-card,body.theme-dark .invite,body.theme-dark .echo-tbl-wrap,body.theme-dark .ecmp,body.theme-dark .summary-card,body.theme-dark .stat-block,body.theme-dark .hist-panel,body.theme-dark .login-card,body.theme-dark .thread-bub,body.theme-dark .ask-txt,body.theme-dark .ask-cons,body.theme-dark .teach-p{background:#161F33;border-color:#28364E;color:#EAF1FB}
body.theme-dark .card{background:#141D2F;border-color:#28364E}
body.theme-dark .card-head{background:#101A2C;border-color:#28364E}
body.theme-dark .tb-group,body.theme-dark .tab-group,body.theme-dark .echo-seg,body.theme-dark .mode-cd,body.theme-dark .prio-counts{background:#1C2740}
body.theme-dark input,body.theme-dark textarea,body.theme-dark select,body.theme-dark .smart-note-ta,body.theme-dark .ecmp-pick select{background:#0F1A2C;color:#EAF1FB;border-color:#28364E}
body.theme-dark .smart-note-bar{background:#13203353;border-color:#28364E}
body.theme-dark .sidebar-item:hover{background:#1A2438;color:#EAF1FB}
body.theme-dark .sidebar-item.active{background:#1E2B44;color:#7FB0FF;border-color:#2F4368}
body.theme-dark .ask-khoa,body.theme-dark .cfm-t,body.theme-dark .dc-q,body.theme-dark .hist-name,body.theme-dark .hist-title,body.theme-dark .invite-name,body.theme-dark .login-brand,body.theme-dark .mdt-block-t,body.theme-dark .mdt-op-name,body.theme-dark .mdt-step-t,body.theme-dark .mode-cd-btn,body.theme-dark .mode-dd,body.theme-dark .prio-ten,body.theme-dark .rec-inline-h,body.theme-dark .rec-title,body.theme-dark .rpt-search,body.theme-dark .score-overall,body.theme-dark .score-ten,body.theme-dark .smart-note-ta,body.theme-dark .spec-name,body.theme-dark .teach-q-t,body.theme-dark .teach-sec-t,body.theme-dark .teach-soc-t,body.theme-dark .ul-pair,body.theme-dark .ask-cons,body.theme-dark .ask-txt,body.theme-dark .dc-opt,body.theme-dark .mdt-final,body.theme-dark .mode-cd-item,body.theme-dark .nav-menu,body.theme-dark .ol-num,body.theme-dark .risk-ten,body.theme-dark .teach-chip,body.theme-dark .teach-p,body.theme-dark .thread-bub,body.theme-dark .ul-clean,body.theme-dark .cfm-cancel,body.theme-dark .conf,body.theme-dark .hist-dx,body.theme-dark .prio-ly,body.theme-dark .rec-clear,body.theme-dark .rel,body.theme-dark .rf-yn,body.theme-dark .sn-mic,body.theme-dark .spec-gap,body.theme-dark .stance,body.theme-dark .tb-btn,body.theme-dark .teach-q-a,body.theme-dark .teach-q-fb,body.theme-dark .theme-toggle,body.theme-dark .up-logout,body.theme-dark .card-title,body.theme-dark .stat-label{color:#EAF1FB}
body.theme-dark .stat-sub,body.theme-dark .invite-role,body.theme-dark .prio-ly,body.theme-dark .spec-gap,body.theme-dark .hist-dx,body.theme-dark .ecmp-lbl,body.theme-dark .ecmp-notes{color:#A8BBD6}
body.theme-dark .copy-btn{background:#1C2740;border-color:#2F4368;color:#7FB0FF}
body.theme-dark .report-nav{background:rgba(12,20,34,0.94);border-color:#28364E}
body.theme-dark .logo-text,body.theme-dark .logo-sub,body.theme-dark .patient-name,body.theme-dark .patient-meta,body.theme-dark .chip-lbl,body.theme-dark .nav-patient{color:#EAF1FB}
body.theme-dark .nav-sep{color:#3C5878}
body.theme-dark .patient-meta{background:rgba(91,149,242,0.16)}
body.theme-dark .patient-avatar{background:#1E2B44;color:#7FB0FF}
body.theme-dark .hero-title,body.theme-dark .hero-sub,body.theme-dark .up-title,body.theme-dark .up-sub,body.theme-dark .hero-feat-item{color:#EAF1FB}
body.theme-dark .chip-bar{background:#0E1828}
.term-tip{position:relative;cursor:help;display:inline-flex;align-items:center;gap:3px}
.term-q{display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;background:var(--blue-lt);color:var(--blue);font-size:9px;font-weight:800;line-height:1;flex-shrink:0}
.term-pop{display:none;position:absolute;bottom:calc(100% + 8px);left:0;width:232px;background:#102942;color:#fff;font-size:11.5px;font-weight:500;line-height:1.55;text-transform:none;letter-spacing:0;padding:9px 11px;border-radius:9px;box-shadow:0 8px 24px rgba(15,39,64,.28);z-index:60;white-space:normal}
.term-pop:after{content:"";position:absolute;top:100%;left:14px;border:5px solid transparent;border-top-color:#102942}
.term-tip:hover .term-pop,.term-tip:focus .term-pop{display:block}
body.theme-dark .term-pop{background:#1C2740;color:#EAF1FB;border:1px solid #2F4368}
body.theme-dark .term-pop:after{border-top-color:#1C2740}
body.theme-dark .term-q{background:#1E2B44;color:#7FB0FF}
.upload-err-hint{font-size:12px;color:#9A4B2E;margin-top:8px;line-height:1.55}
.upload-err-actions{display:flex;gap:9px;margin-top:11px;flex-wrap:wrap}
.upload-err-retry{display:inline-flex;align-items:center;gap:6px;border:none;background:#DC2626;color:#fff;font-size:12.5px;font-weight:600;padding:8px 14px;border-radius:9px;cursor:pointer}
.upload-err-retry:hover{filter:brightness(1.07)}
.upload-err-demo{border:1px solid #FECACA;background:#fff;color:#B91C1C;font-size:12.5px;font-weight:600;padding:8px 14px;border-radius:9px;cursor:pointer}
.upload-err-demo:hover{background:#FEF2F2}
body.focus-mode .sidebar{display:none}
body.focus-mode .chip-bar{display:none}
body.focus-mode .report-outer{max-width:1000px;gap:0}
body.focus-mode .report-main{padding:0 6px}
body.focus-mode .report-nav{box-shadow:none}
.dn-fab{position:fixed;left:24px;bottom:24px;z-index:90;width:50px;height:50px;border-radius:50%;border:none;background:linear-gradient(135deg,#0E9488,#1D6FE8);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 22px rgba(14,148,136,.35)}
.dn-fab:hover{filter:brightness(1.07)}
.dn-dot{position:absolute;top:9px;right:9px;width:10px;height:10px;border-radius:50%;background:#FBBF24;border:2px solid #fff}
.dn-panel{position:fixed;left:24px;bottom:84px;z-index:91;width:322px;max-width:calc(100vw - 48px);background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 44px rgba(15,39,64,.22);overflow:hidden;animation:fadeIn .16s ease}
.dn-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border);font-size:13px;font-weight:700;color:var(--navy)}
.dn-head span{flex:1}
.dn-x{border:none;background:none;cursor:pointer;display:flex;padding:0}
.dn-ta{display:block;width:100%;box-sizing:border-box;min-height:144px;border:none;outline:none;resize:vertical;padding:12px 14px;font-size:13px;font-family:inherit;color:var(--navy);background:transparent;line-height:1.55}
.dn-foot{padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);background:#FAFBFD}
body.theme-dark .dn-panel{background:#161F33;border-color:#28364E}
body.theme-dark .dn-head{color:#EAF1FB;border-color:#28364E}
body.theme-dark .dn-ta{color:#EAF1FB}
body.theme-dark .dn-foot{background:#10192A;border-color:#28364E;color:#A8BBD6}
body.theme-dark .dn-dot{border-color:#161F33}
body.focus-mode .dn-fab{opacity:.35}
.tls-card{background:var(--glass);border:1px solid var(--border);border-radius:14px;padding:14px 4px 14px 16px;margin:12px 0}
.tls-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--navy);margin-bottom:12px;padding-right:14px}
.tls-head span:first-of-type{flex:1}
.tls-hint{font-size:11px;font-weight:500;color:var(--muted)}
.tls-scroll{overflow-x:auto;padding-bottom:6px}
.tls-track{display:flex;gap:0;min-width:min-content;position:relative}
.tls-track:before{content:"";position:absolute;left:0;right:0;top:46px;height:2px;background:var(--border)}
.tls-item{flex:0 0 200px;display:flex;flex-direction:column;align-items:center;padding:0 8px}
.tls-date{font-size:11.5px;font-weight:700;color:var(--navy2);margin-bottom:8px}
.tls-dotwrap{position:relative;z-index:1;height:18px;display:flex;align-items:center}
.tls-dot{width:13px;height:13px;border-radius:50%;border:3px solid var(--glass);box-shadow:0 0 0 1px var(--border)}
.tls-box{margin-top:8px;background:var(--page-bg);border:1px solid var(--border);border-radius:10px;padding:9px 11px;width:100%;box-sizing:border-box;min-height:74px}
.tls-tag{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;margin-bottom:5px}
.tls-txt{display:block;font-size:11.5px;color:var(--muted2);line-height:1.5}
body.theme-dark .tls-box{background:#0F1A2C;border-color:#28364E}
body.theme-dark .tls-dot{border-color:#161F33}
.read-progress{position:fixed;top:0;left:0;right:0;height:3px;background:transparent;z-index:120;pointer-events:none}
.read-progress-bar{height:100%;background:linear-gradient(90deg,#1D6FE8,#0E9488);transition:width .1s linear;box-shadow:0 0 6px rgba(29,111,232,.4)}
body.focus-mode .read-progress{height:4px}
.nav-menu-font{display:flex;align-items:center;gap:6px;padding:9px 12px;font-size:13px;font-weight:500;color:#334155;border-top:1px solid var(--border);margin-top:4px}
.nav-menu-font span{flex:1}
.nav-menu-font button{width:32px;height:28px;border:1px solid var(--border);background:#fff;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;color:#1D6FE8;display:inline-flex;align-items:center;justify-content:center}
.nav-menu-font button:hover{background:#f1f6fd}
body.theme-dark .nav-menu-font{color:#C7D4E6;border-color:#2F4368}
body.theme-dark .nav-menu-font button{background:#1B2536;border-color:#2F4368;color:#7FB0FF}
.flag-btn{border:none;background:none;cursor:pointer;color:#CBD5E1;padding:2px;display:inline-flex;align-items:center;vertical-align:middle;margin-left:6px;transition:color .15s}
.flag-btn:hover{color:#D97706}
.flag-btn.on{color:#D97706}
.takeaway-card li{position:relative}
.prob-top{display:flex;align-items:center;gap:6px}
.prob-top .flag-btn{margin-left:auto}
.bm-ov{position:fixed;inset:0;z-index:130;background:rgba(15,39,64,.45);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px;animation:toastIn .15s ease}
.bm-panel{background:#fff;border-radius:16px;width:420px;max-width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(15,39,64,.3);overflow:hidden}
.bm-head{display:flex;align-items:center;gap:9px;padding:14px 16px;border-bottom:1px solid var(--border);font-size:14px;font-weight:700;color:var(--navy)}
.bm-head svg{color:#D97706}
.bm-head span{flex:1}
.bm-body{padding:8px;overflow-y:auto}
.bm-empty{padding:26px 18px;text-align:center;color:var(--muted);font-size:12.5px;line-height:1.65}
.bm-item{display:flex;align-items:flex-start;gap:10px;padding:11px 12px;border-radius:10px}
.bm-item:hover{background:#f7f9fc}
.bm-flag{color:#D97706;margin-top:1px;flex-shrink:0;display:inline-flex}
.bm-main{flex:1;min-width:0}
.bm-label{font-size:13px;font-weight:600;color:var(--navy);line-height:1.45}
.bm-sub{font-size:11.5px;color:var(--muted2);margin-top:3px;line-height:1.5}
.bm-detail{font-size:12px;color:var(--muted2);margin-top:6px;line-height:1.55;white-space:pre-wrap;max-height:150px;overflow:auto}
body.theme-dark .bm-detail{color:#A8BBD6}
.bm-item{display:block;padding:0;overflow:hidden}
.bm-item-top{display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer}
.bm-item-top:hover{background:rgba(29,111,232,.035)}
.bm-go{border:1px solid var(--border);background:#fff;border-radius:8px;width:30px;height:28px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:#1D6FE8;flex-shrink:0}
.bm-go:hover{background:#eaf2fe}
.bm-chev{display:inline-flex;flex-shrink:0;align-items:center}
.bm-item .bm-detail{margin:0;padding:12px 14px 14px;border-top:1px solid var(--border);max-height:300px;overflow:auto}
.bm-flash{animation:bmflash 1.5s ease}
@keyframes bmflash{0%,100%{box-shadow:0 0 0 0 rgba(29,111,232,0)}30%{box-shadow:0 0 0 3px rgba(29,111,232,.4)}}
body.theme-dark .bm-go{background:#1B2536;border-color:#2F4368;color:#7FB0FF}
body.theme-dark .bm-go:hover{background:#22304a}
body.theme-dark .bm-item-top:hover{background:rgba(127,176,255,.06)}
body.theme-dark .bm-item .bm-detail{border-color:#28364E}
[id^="sec-"],.phase-sec,.tls-card{scroll-margin-top:74px}
.mode-card{animation:mpfadeup .34s ease}
@keyframes mpfadeup{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.sidebar-item,.chip-tag,.tb-btn,.tab-group button,.mode-cd-btn{transition:all .16s ease}
.risk-fill,.score-fill,.bar-fill,.prog-fill,.donut-seg{transition:all .8s cubic-bezier(.22,1,.36,1)}
.stat-card,.ov-card,.phase-sec,.tls-card{transition:box-shadow .2s ease,transform .2s ease}
.stat-card:hover,.ov-card:hover{transform:translateY(-1px);box-shadow:var(--shadow-md)}
.fab,.dn-fab{transition:transform .18s ease,box-shadow .18s ease,filter .18s ease}
.fab:hover,.dn-fab:hover{transform:translateY(-2px)}
.top-nav-actions{display:flex;align-items:center;gap:10px;flex-shrink:0}
.top-nav .up-logout{position:static;top:auto;right:auto}
body.theme-dark{--muted:#AEC0D8;--muted2:#C8D6E8;--navy3:#AFC1DA;--navy2:#D2DEEE}
body.theme-dark .top-nav{background:rgba(15,23,40,0.72);border-color:var(--border)}
body.theme-dark .up-logout{background:#1B2536;border-color:var(--border)}
body.theme-dark .takeaway-card{background:#13212B;border-color:#235049;border-left-color:#2DD4BF}
body.theme-dark .takeaway-card li,body.theme-dark .takeaway-card{color:#DCE6F4}
body.theme-dark .hero-status{background:#11192A;border-color:var(--border)}
body.theme-dark .phase-sec{background:#131D2E}
body.theme-dark .reason-phase{background:#1B2536;border-color:var(--border)}
body.theme-dark .echo-bar-title{color:#EAF1FB}
body.theme-dark .next-actions{background:#231D11;border-color:#473a20;border-left-color:#FBBF24}
body.theme-dark .next-actions,body.theme-dark .next-actions .na-viec,body.theme-dark .next-actions .na-ly,body.theme-dark .next-actions li,body.theme-dark .next-actions p,body.theme-dark .next-actions span{color:#E7DCC8}
body.theme-dark .medio{background:#201A0C;border-color:#3a3119}
/* ===== DARK MODE v3: toi hoa cac the translucent bi nhat ===== */
body.theme-dark .lab-cell{background:#141E2C;border-color:#2A3A52}
body.theme-dark .lab-legend{background:#141E2C;border-color:#2A3A52;color:#B4C4DA}
body.theme-dark .lab-clarify{background:#2A2410;color:#FCD9A6;border-color:#4A3D22}
body.theme-dark .lab-desc,body.theme-dark .lab-normal,body.theme-dark .lab-foot,body.theme-dark .date-val{color:#9FB3CC}
body.theme-dark .drug-egfr-box{background:#13202E;border-color:#2A3A52}
body.theme-dark .drug-egfr-box *{color:#C6D5E8}
body.theme-dark .fc-msgs{background:#0E1726}
body.theme-dark .bot{background:#1A2536;border-color:#2A3A52;color:#E2EBF7}
body.theme-dark .bot *{color:#E2EBF7}
body.theme-dark .alert-item{background:#161F2E;border-color:#2A3A52}
body.theme-dark .alert-item *{color:#D6E2F2}
body.theme-dark .dc-opt{background:#141E2C;border-color:#2A3A52;color:#D6E2F2}
body.theme-dark .echo-tl-insight{background:#141E2C;border-color:#2A3A52;color:#C6D5E8}
body.theme-dark .stage-wrap{background:#141E2C;border-color:#2A3A52}
body.theme-dark .sug-chip{background:#1A2536;border-color:#2A3A52;color:#C6D5E8}
body.theme-dark .sug-chip:hover{background:#22304a}
body.theme-dark .chat-input-row{background:#0F1828;border-color:#2A3A52}
body.theme-dark .prio-col,body.theme-dark .prio-count,body.theme-dark .prio-counts,body.theme-dark .tl-filter-btn{background:#141E2C;border-color:#2A3A52;color:#C6D5E8}
body.theme-dark .prio-col-n{background:#1A2536;color:#E2EBF7}
body.theme-dark .upload-page{background:#0A1220}
body.theme-dark .hero-h1,body.theme-dark .hero-desc,body.theme-dark .feat-item{color:#E2EBF7}
body.theme-dark .hero-h1 em{color:#7FB0FF}
body.theme-dark .stat-n{color:#EAF1FB}
body.theme-dark .stat-sub{color:#AEC0D8}
body.theme-dark .hero-tag,body.theme-dark .hero-tag-lines span{color:#C6D5E8}
/* ===== DARK v4: chu bullet + the teaching/reasoning/timeline ===== */
body.theme-dark .ul-clean li{color:#C6D5E8}
body.theme-dark .disc{border-color:#2A3A52}
body.theme-dark .phase-chip{background:#1A2536;color:#C6D5E8;border-color:#2A3A52}
body.theme-dark .phase-ketluan{background:#141E2C;color:#C6D5E8}
body.theme-dark .ai-insight{background:#141E2C;border-color:#2A3A52}
body.theme-dark .ai-insight *{color:#C6D5E8}
body.theme-dark .reason-item{background:#151E2C !important;border-color:#2A3A52 !important}
body.theme-dark .ul-pair li{background:#141E2C;border-color:#2A3A52}
body.theme-dark .ul-pair li b{color:#E2EBF7}
body.theme-dark .ul-pair li span{color:#9FB3CC}
body.theme-dark .teach-chip{background:#1A2536;color:#C6D5E8;border-color:#2A3A52}
/* ===== TONG QUAN NHANH (CaseOverview) ===== */
.co-wrap{max-width:1100px;margin:0 auto 20px;background:#fff;border:1px solid var(--border);border-radius:16px;padding:16px 18px;box-shadow:var(--shadow-sm)}
.co-head{display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.co-h-title{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:800;letter-spacing:.06em;color:var(--navy);text-transform:uppercase}
.co-phase{font-size:11.5px;font-weight:700;color:#1D6FE8;background:rgba(29,111,232,0.1);padding:3px 11px;border-radius:999px}
.co-alerts{display:inline-flex;gap:6px}
.co-alert{font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px}
.co-alert-crit{color:#DC2626;background:rgba(239,68,68,0.12)}
.co-alert-warn{color:#D97706;background:rgba(245,158,11,0.14)}
.co-head-r{margin-left:auto;display:inline-flex;gap:6px;align-items:center}
.co-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px}
.co-stat{border:1px solid var(--border);border-radius:12px;padding:10px 12px;background:var(--page-bg);transition:transform .18s ease,box-shadow .18s ease}
.co-stat:hover{transform:translateY(-2px);box-shadow:var(--shadow-sm)}
.co-stat-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px}
.co-stat-key{font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.03em}
.co-stat-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.co-stat-val{font-size:17px;font-weight:800;color:var(--navy);line-height:1.15}
.co-spark{display:block;width:100%;height:24px;margin:3px 0 1px}
.co-stat-norm{font-size:10px;color:var(--muted2)}
.co-prios{display:flex;align-items:flex-start;gap:12px;margin-top:14px;padding-top:12px;border-top:1px dashed var(--border);flex-wrap:wrap}
.co-prios-lbl{font-size:12px;font-weight:800;color:var(--navy2);white-space:nowrap;padding-top:1px}
.co-prio-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px;flex:1;min-width:200px}
.co-prio-list li{font-size:12.5px;color:var(--navy2);line-height:1.5}
body.theme-dark .co-wrap{background:#0F1A2A;border-color:#2A3A52}
body.theme-dark .co-stat{background:#141E2C;border-color:#2A3A52}
body.theme-dark .co-phase{background:rgba(29,111,232,0.22);color:#7FB0FF}
/* ===== SO SANH HAI MOC XET NGHIEM (VisitCompare) ===== */
.vc-pickers{display:flex;align-items:flex-end;gap:14px;margin-bottom:14px;flex-wrap:wrap}
.vc-pick{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.03em}
.vc-pick select{font-size:13px;font-weight:600;color:var(--navy);background:#fff;border:1px solid var(--border);border-radius:9px;padding:7px 11px;cursor:pointer;min-width:120px}
.vc-sep{color:var(--blue);margin-bottom:9px}
.vc-table{border:1px solid var(--border);border-radius:12px;overflow:hidden}
.vc-row{display:grid;grid-template-columns:1.4fr 1fr 1.5fr 1fr;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--border);font-size:13px}
.vc-row:last-child{border-bottom:none}
.vc-thead{background:var(--page-bg);font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
.vc-thead span:nth-child(2),.vc-thead span:nth-child(4),.vc-thead span:nth-child(3){text-align:center}
.vc-key{font-weight:700;color:var(--navy)}
.vc-key em{font-style:normal;font-weight:500;color:var(--muted2);font-size:11px;margin-left:4px}
.vc-val{text-align:center;font-weight:700;color:var(--navy2);font-variant-numeric:tabular-nums}
.vc-delta{display:inline-flex;align-items:center;justify-content:center;gap:4px;font-size:12px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}
.vc-delta.up{color:#DC2626}
.vc-delta.down{color:#0E9488}
.vc-note{font-size:11px;color:var(--muted2);margin-top:10px;line-height:1.5}
.vc-empty{font-size:13px;color:var(--muted);padding:8px 0}
@media(max-width:560px){.vc-row{grid-template-columns:1.2fr .8fr 1.3fr .8fr;font-size:12px;padding:8px 10px}}
body.theme-dark .vc-pick select{background:#141E2C;border-color:#2A3A52;color:#E2EBF7}
body.theme-dark .vc-table{border-color:#2A3A52}
body.theme-dark .vc-row{border-color:#2A3A52}
body.theme-dark .vc-thead{background:#141E2C}
body.theme-dark .vc-delta.up{color:#F87171}
body.theme-dark .vc-delta.down{color:#2DD4BF}
/* ===== F5: timeline event nav ===== */
.tls-nav{display:inline-flex;align-items:center;gap:7px;margin-left:8px}
.tls-nav-btn{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;border:1px solid var(--border);background:#fff;color:#1D6FE8;cursor:pointer;transition:all .15s}
.tls-nav-btn:hover{background:rgba(29,111,232,0.08);transform:translateY(-1px)}
.tls-nav-lbl{font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap}
.tls-flash{animation:tlsflash 1.2s ease}
@keyframes tlsflash{0%,100%{box-shadow:0 0 0 0 rgba(29,111,232,0)}30%{box-shadow:0 0 0 3px rgba(29,111,232,0.45)}}
body.theme-dark .tls-nav-btn{background:#141E2C;border-color:#2A3A52;color:#7FB0FF}
body.theme-dark .tls-nav-btn:hover{background:#1E2A40}
/* ===== F3: loc he co quan (lab system filter) ===== */
.lab-sysbar{display:flex;align-items:center;gap:10px;margin:10px 0 4px;flex-wrap:wrap}
.lab-sysbar-lbl{font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.lab-sysbar-chips{display:flex;gap:7px;flex-wrap:wrap}
.lab-sys-chip{font-size:12px;font-weight:600;color:var(--navy2);background:#fff;border:1px solid var(--border);border-radius:999px;padding:5px 12px;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:5px}
.lab-sys-chip:hover{border-color:var(--blue);color:var(--blue)}
.lab-sys-chip.on{background:var(--blue);border-color:var(--blue);color:#fff}
.lab-sys-chip.on .lab-filter-n{color:#fff;opacity:.85}
.lab-empty{font-size:13px;color:var(--muted);padding:14px 4px;text-align:center}
body.theme-dark .lab-sys-chip{background:#141E2C;border-color:#2A3A52;color:#C6D5E8}
body.theme-dark .lab-sys-chip:hover{border-color:#3B82F6;color:#7FB0FF}
body.theme-dark .lab-sys-chip.on{background:#1D6FE8;border-color:#1D6FE8;color:#fff}
/* ===== CHECKLIST viec can lam ===== */
.ckl-wrap{max-width:1100px;margin:0 auto 20px;background:#fff;border:1px solid var(--border);border-radius:16px;padding:16px 18px;box-shadow:var(--shadow-sm)}
.ckl-head{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.ckl-title{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:800;letter-spacing:.06em;color:var(--navy);text-transform:uppercase}
.ckl-prog-txt{font-size:11.5px;font-weight:700;color:var(--blue);white-space:nowrap}
.ckl-bar{flex:1;min-width:120px;height:7px;background:var(--page-bg);border-radius:999px;overflow:hidden}
.ckl-bar-fill{height:100%;background:linear-gradient(90deg,var(--blue),var(--cyan));border-radius:999px;transition:width .5s cubic-bezier(.22,1,.36,1)}
.ckl-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.ckl-item{display:flex;align-items:flex-start;gap:11px;padding:11px 13px;border:1px solid var(--border);border-radius:11px;cursor:pointer;transition:all .15s;background:var(--page-bg)}
.ckl-item:hover{border-color:var(--blue);transform:translateX(2px)}
.ckl-box{flex-shrink:0;width:20px;height:20px;border-radius:6px;border:2px solid var(--muted2);display:inline-flex;align-items:center;justify-content:center;margin-top:1px;transition:all .15s}
.ckl-item.done .ckl-box{background:var(--blue);border-color:var(--blue)}
.ckl-viec{font-size:13.5px;font-weight:600;color:var(--navy);line-height:1.45}
.ckl-ly{font-size:12px;color:var(--muted);line-height:1.5;margin-top:2px}
.ckl-item.done .ckl-viec{text-decoration:line-through;color:var(--muted)}
.ckl-item.done{opacity:.72}
body.theme-dark .ckl-wrap{background:#0F1A2A;border-color:#2A3A52}
body.theme-dark .ckl-item{background:#141E2C;border-color:#2A3A52}
body.theme-dark .ckl-bar{background:#1A2536}
/* ===== XU HUONG TONG HOP (MultiTrend) ===== */
.mt-chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px}
.mt-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--muted);background:#fff;border:1px solid var(--border);border-radius:999px;padding:5px 12px;cursor:pointer;transition:all .15s}
.mt-chip:hover{border-color:var(--blue)}
.mt-chip.on{background:rgba(29,111,232,0.06);font-weight:700}
.mt-chip-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.mt-svg{display:block;max-width:680px;margin:0 auto;overflow:visible}
.mt-note{font-size:11px;color:var(--muted2);margin-top:10px;line-height:1.5}
body.theme-dark .mt-chip{background:#141E2C;border-color:#2A3A52}
body.theme-dark .mt-chip.on{background:rgba(29,111,232,0.18)}
body.theme-dark .takeaway-txt,body.theme-dark .clin-txt,body.theme-dark .lead,body.theme-dark .desc{color:#D6E2F2}
.sidebar-item.active svg{opacity:1}
.bm-x{border:none;background:none;cursor:pointer;padding:2px;flex-shrink:0}
body.theme-dark .bm-panel{background:#161F33}
body.theme-dark .bm-head{color:#EAF1FB;border-color:#28364E}
body.theme-dark .bm-item:hover{background:#1B2536}
body.theme-dark .bm-label{color:#EAF1FB}
.sh-ov{position:fixed;inset:0;z-index:140;background:rgba(15,39,64,.45);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px;animation:toastIn .15s ease}
.sh-panel{background:#fff;border-radius:16px;width:432px;max-width:100%;box-shadow:0 24px 60px rgba(15,39,64,.3);overflow:hidden}
.sh-head{display:flex;align-items:center;gap:9px;padding:14px 16px;border-bottom:1px solid var(--border);font-size:14px;font-weight:700;color:var(--navy)}
.sh-head span{flex:1}
.sh-body{padding:6px 16px 16px}
.sh-row{display:flex;align-items:center;gap:14px;padding:11px 0;border-bottom:1px dashed var(--border)}
.sh-row:last-child{border-bottom:none}
.sh-keys{display:flex;gap:5px;flex-shrink:0;min-width:126px;flex-wrap:wrap}
.sh-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 7px;background:#f1f5fb;border:1px solid var(--border);border-bottom-width:2px;border-radius:6px;font-size:11.5px;font-weight:700;color:var(--navy2);font-family:inherit}
.sh-desc{font-size:13px;color:var(--muted2);line-height:1.45}
body.theme-dark .sh-panel{background:#161F33}
body.theme-dark .sh-head{color:#EAF1FB;border-color:#28364E}
body.theme-dark .sh-kbd{background:#1B2536;border-color:#2F4368;color:#C7D4E6}
.sidebar::-webkit-scrollbar,.bm-body::-webkit-scrollbar,.tls-scroll::-webkit-scrollbar,.dn-ta::-webkit-scrollbar{width:8px;height:8px}
.sidebar::-webkit-scrollbar-thumb,.bm-body::-webkit-scrollbar-thumb,.tls-scroll::-webkit-scrollbar-thumb,.dn-ta::-webkit-scrollbar-thumb{background:rgba(110,137,168,.35);border-radius:8px}
.sidebar::-webkit-scrollbar-thumb:hover,.tls-scroll::-webkit-scrollbar-thumb:hover{background:rgba(110,137,168,.55)}
body.theme-dark .sidebar::-webkit-scrollbar-thumb,body.theme-dark .bm-body::-webkit-scrollbar-thumb,body.theme-dark .tls-scroll::-webkit-scrollbar-thumb{background:rgba(127,176,255,.28)}
button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.prio-box-name{display:flex;align-items:flex-start;gap:6px}
.prio-box-name .flag-btn{margin-left:auto;margin-top:1px}
@media(max-width:860px){
  .report-outer{padding:14px 12px 48px;gap:0}
  .sidebar{display:none}
  .report-nav-inner{padding:6px 12px;height:auto;min-height:52px;flex-wrap:wrap;gap:6px 8px}
  .nav-right{gap:7px;flex-wrap:wrap;justify-content:flex-end}
  .patient-meta{display:none}
  .mode-dd-lbl{display:none}
}
@media(max-width:600px){
  .stats-row{grid-template-columns:1fr}
  .prio-board{grid-template-columns:1fr}
  .disc-grid,.invite-grid,.score-grid,.med-grid,.dc-opts{grid-template-columns:1fr !important}
  .tls-item{flex-basis:172px}
  .dn-fab{left:14px;bottom:14px;width:46px;height:46px}
  .dn-panel{left:14px;bottom:70px}
  .fc-panel{max-width:calc(100vw - 28px)}
  .nav-export{padding:8px 11px}
  .login-hero-title{font-size:24px}
  .ecmp-pick select{flex:1;min-width:0}
  .ecmp-row{grid-template-columns:1fr 1fr auto 1fr}
  .ecmp-lbl{grid-column:1/-1}
}


.mdt-ket{margin:0 26px;border:1px solid #eef3fa;border-radius:14px;padding:16px 18px;background:#fbfdff}
.mdt-block{margin-bottom:14px;padding-left:12px;border-left:3px solid #1D6FE8}
.mdt-block.green{border-color:#22C55E}.mdt-block.red{border-color:#EF4444}.mdt-block.blue{border-color:#1D6FE8}.mdt-block.teal{border-color:#0E9488}
.mdt-block-t{font-size:13px;font-weight:700;color:#0F2740;margin-bottom:5px}
.mdt-final{margin-top:6px;font-size:13px;color:#334155;line-height:1.7;background:linear-gradient(180deg,rgba(14,148,136,.07),rgba(29,111,232,.05));border-radius:11px;padding:13px 15px}
.mdt-final-lbl{display:block;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:#0E9488;margin-bottom:4px}
.teach-submode{display:flex;align-items:center;gap:12px;padding:18px 26px 4px;flex-wrap:wrap}
.teach-submode-lbl{font-size:12px;font-weight:600;color:#7A96C8}
.teach-seg{display:inline-flex;background:#eef3fa;border-radius:11px;padding:3px}
.teach-seg button{border:none;background:transparent;font-size:12.5px;font-weight:600;color:#5A748F;padding:7px 14px;border-radius:9px;cursor:pointer}
.teach-seg button.on{background:#fff;color:#0E9488;box-shadow:0 2px 6px rgba(10,22,40,.08)}
.teach-sec{margin:0 26px;padding:14px 0;border-bottom:1px solid #f0f4fa}
.teach-sec-t{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:800;color:#0F2740;margin-bottom:8px}
.teach-sec-n{width:23px;height:23px;border-radius:8px;background:rgba(14,148,136,.12);color:#0E9488;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.teach-p{font-size:13px;color:#334155;line-height:1.7;margin:0}
.ol-num{margin:0;padding-left:20px}.ol-num li{font-size:13px;color:#334155;line-height:1.7;margin-bottom:4px}
.ul-pair{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.ul-pair li{background:#fafcff;border:1px solid #eef3fa;border-radius:10px;padding:10px 12px}
.ul-pair li b{display:block;font-size:13px;color:#0F2740;margin-bottom:2px}
.ul-pair li span{font-size:12px;color:#5A748F;line-height:1.55}
.teach-chips{display:flex;flex-wrap:wrap;gap:8px}
.teach-chip{font-size:12px;color:#334155;background:#f1f6fc;border:1px solid #e2ecf8;padding:6px 11px;border-radius:9px}
.teach-chip b{color:#0E9488;font-weight:700}
.teach-soc{margin:18px 26px 0;background:linear-gradient(180deg,rgba(14,148,136,.06),rgba(29,111,232,.04));border-radius:14px;padding:16px}
.teach-soc-hd{display:flex;align-items:flex-start;gap:11px;margin-bottom:12px}
.teach-soc-ic{width:30px;height:30px;border-radius:9px;background:#0E9488;color:#fff;font-size:17px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.teach-soc-t{font-size:14px;font-weight:800;color:#0F2740}
.teach-soc-s{font-size:12px;color:#5A748F;margin-top:2px;line-height:1.5}
.teach-q{background:#fff;border:1px solid #e7eef8;border-radius:11px;margin-bottom:9px;overflow:hidden}
.teach-q-t{font-size:13px;font-weight:600;color:#0F2740;display:flex;gap:9px;align-items:flex-start;padding:12px 14px;cursor:pointer}
.teach-q-ic{color:#0E9488;font-weight:800;width:13px;display:inline-block;flex-shrink:0}
.teach-q-a{font-size:12.5px;color:#475569;line-height:1.65;padding:0 14px 13px 36px}
.teach-q-a-lbl{display:inline-block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:#0E9488;background:rgba(14,148,136,.1);padding:2px 8px;border-radius:6px;margin-right:8px}
.hist-overlay{position:fixed;inset:0;background:rgba(10,22,40,.5);backdrop-filter:blur(3px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}
.hist-modal{width:100%;max-width:580px;max-height:84vh;overflow:auto;background:#fff;border-radius:20px;padding:24px}
.hist-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.hist-title{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:800;color:#0F2740}
.hist-list{display:flex;flex-direction:column;gap:11px}
.hist-item{display:flex;gap:13px;align-items:center;border:1px solid #e7eef8;border-radius:14px;padding:14px;cursor:pointer;transition:all .15s}
.hist-item:hover{border-color:#1D6FE8;background:rgba(29,111,232,.03);transform:translateY(-1px);box-shadow:0 6px 18px rgba(29,111,232,.1)}
.hist-item.cur{border-color:#1D6FE8;background:rgba(29,111,232,.06)}
.hist-avatar{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#1D6FE8,#0E9488);color:#fff;font-weight:700;font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.hist-info{flex:1;min-width:0}
.hist-name{font-size:14.5px;font-weight:700;color:#0F2740}
.hist-meta{font-size:11.5px;font-weight:500;color:#7A96C8}
.hist-dx{font-size:12px;color:#475569;line-height:1.5;margin:3px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hist-foot{display:flex;align-items:center;gap:5px;font-size:11px;color:#94a3b8}
.hist-open{font-size:12px;font-weight:600;color:#1D6FE8;flex-shrink:0}
.hist-link{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:#1D6FE8;background:none;border:none;cursor:pointer;margin-top:10px;padding:6px 8px;border-radius:8px}
.hist-link:hover{background:rgba(29,111,232,.08)}
@media(max-width:560px){.mode-hero{flex-direction:column}.mdt-step,.mdt-khoa,.mdt-list,.mdt-ket,.teach-sec,.teach-soc,.teach-submode{margin-left:16px;margin-right:16px}.mode-hero{padding:20px 16px}}
.mdt-why{font-size:12px;color:#5A748F;margin:0 0 9px;line-height:1.55}.mdt-why b{color:#1D6FE8}
.conf{margin-left:auto;font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:7px;white-space:nowrap}
.conf.hi{color:#15803d;background:#dcfce7}.conf.mid{color:#b45309;background:#fef3c7}.conf.lo{color:#475569;background:#eef2f7}
.conf-detail{margin-top:9px;border-top:1px dashed #eef3fa;padding-top:8px;font-size:11.5px;color:#7A96C8;line-height:1.55}
.conf-detail .cd-lbl{font-weight:700;color:#5A748F}
.prio-wrap{display:flex;flex-direction:column;gap:9px;padding:0 26px}
.prio{display:flex;flex-wrap:wrap;align-items:center;gap:10px;border:1px solid #e7eef8;border-left-width:4px;border-radius:11px;padding:11px 14px;background:#fafcff}
.prio.p1{border-left-color:#EF4444}.prio.p2{border-left-color:#F59E0B}.prio.p3{border-left-color:#1D6FE8}
.prio-rank{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;padding:3px 9px;border-radius:7px;color:#fff;flex-shrink:0}
.prio.p1 .prio-rank{background:#EF4444}.prio.p2 .prio-rank{background:#F59E0B}.prio.p3 .prio-rank{background:#1D6FE8}
.prio-ten{font-size:13.5px;font-weight:700;color:#0F2740}
.prio-ly{flex-basis:100%;font-size:12.5px;color:#475569;line-height:1.55}
.disc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 26px}
.disc{border:1px solid #e7eef8;border-radius:13px;padding:13px 15px}
.disc-t{font-size:13px;font-weight:800;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid;display:inline-block}
.disc.agree{background:rgba(34,197,94,.05)}.disc.agree .disc-t{color:#15803d;border-color:#22C55E}
.disc.concern{background:rgba(245,158,11,.06)}.disc.concern .disc-t{color:#b45309;border-color:#F59E0B}
.disc.uncert{background:rgba(99,102,241,.06)}.disc.uncert .disc-t{color:#4f46e5;border-color:#6366F1}
.disc.disagree{background:rgba(239,68,68,.05)}.disc.disagree .disc-t{color:#b91c1c;border-color:#EF4444}
.disc.agree .ul-clean li:before{background:#22C55E}.disc.concern .ul-clean li:before{background:#F59E0B}.disc.uncert .ul-clean li:before{background:#6366F1}.disc.disagree .ul-clean li:before{background:#EF4444}
.ask-qs{display:flex;flex-wrap:wrap;gap:9px;padding:0 26px}
.ask-q{font-size:12.5px;font-weight:600;color:#1D6FE8;background:#fff;border:1px solid #cfe0f5;border-radius:20px;padding:8px 14px;cursor:pointer;transition:all .15s}
.ask-q:hover{background:rgba(29,111,232,.06)}.ask-q.on{background:#1D6FE8;color:#fff;border-color:#1D6FE8}
.ask-ans{margin:12px 26px 0;border:1px solid #e7eef8;border-radius:13px;padding:14px;background:#fafcff}
.ask-row{display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-bottom:1px solid #f0f4fa}
.ask-row:last-of-type{border-bottom:none}
.ask-khoa{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:#0F2740;min-width:170px;flex-shrink:0}
.mdt-op-ava.sm{width:24px;height:24px;border-radius:7px;font-size:10px}
.ask-txt{font-size:12.5px;color:#334155;line-height:1.6}
.ask-cons{margin-top:10px;font-size:12.5px;color:#334155;line-height:1.65;background:rgba(14,148,136,.07);border-radius:10px;padding:11px 13px}
@media(max-width:620px){.disc-grid{grid-template-columns:1fr}.ask-khoa{min-width:120px}}
.spec-ic{width:30px;height:30px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.risk-dash{display:flex;flex-direction:column;gap:8px;padding:0 26px}
.risk-row{display:flex;align-items:center;gap:10px}
.risk-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.risk-dot.green{background:#22C55E}.risk-dot.amber{background:#F59E0B}.risk-dot.red{background:#EF4444}
.risk-ten{font-size:12.5px;color:#334155;min-width:165px;flex-shrink:0}
.risk-bar{flex:1;height:9px;background:#eef2f7;border-radius:6px;overflow:hidden}
.risk-fill{display:block;height:100%;border-radius:6px}
.risk-fill.green{background:#22C55E}.risk-fill.amber{background:#F59E0B}.risk-fill.red{background:#EF4444}
.risk-pct{font-size:12px;font-weight:700;min-width:40px;text-align:right}
.risk-pct.green{color:#15803d}.risk-pct.amber{color:#b45309}.risk-pct.red{color:#b91c1c}
.invite-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 26px}
.invite{display:flex;gap:10px;align-items:flex-start;border:1px solid #e7eef8;border-radius:12px;padding:11px 13px;background:#fafcff}
.invite-info{min-width:0}
.invite-name{font-size:13px;font-weight:700;color:#0F2740;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rel{font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px}
.rel.hi{color:#b91c1c;background:#fee2e2}.rel.mid{color:#b45309;background:#fef3c7}.rel.lo{color:#475569;background:#eef2f7}
.invite-role{font-size:11.5px;color:#5A748F;line-height:1.5;margin-top:3px}
.spec-list{display:flex;flex-direction:column;gap:11px;padding:0 26px}
.spec-card{border:1px solid #e7eef8;border-radius:14px;padding:14px 16px;background:#fff;animation:fadeIn .35s ease}
.spec-hd{display:flex;align-items:center;gap:9px;margin-bottom:10px}
.spec-name{font-size:14px;font-weight:700;color:#0F2740}
.spec-flag{font-size:10px;font-weight:700;color:#DC2626;background:#FEF2F2;padding:3px 8px;border-radius:7px}
.conf{margin-left:auto;font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:7px;white-space:nowrap}
.conf.hi{color:#15803d;background:#dcfce7}.conf.mid{color:#b45309;background:#fef3c7}.conf.lo{color:#475569;background:#eef2f7}
.spec-row{display:flex;gap:10px;margin-bottom:7px}
.spec-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:#1D6FE8;min-width:128px;flex-shrink:0;padding-top:1px}
.spec-lbl.teal{color:#0E9488}.spec-lbl.amber{color:#b45309}
.spec-gap{font-size:12.5px;color:#475569;line-height:1.55}
.spec-row .ul-clean{flex:1}
.spec-more{margin-top:2px;border:none;background:none;color:#1D6FE8;font-size:12px;font-weight:600;cursor:pointer;padding:4px 0}
.spec-detail{margin-top:8px;border-top:1px dashed #eef3fa;padding-top:9px}
.spec-sup{font-size:11.5px;color:#7A96C8;margin-top:6px;line-height:1.5}.spec-sup b{color:#5A748F}
.thread{display:flex;flex-direction:column;gap:10px;padding:0 26px}
.thread-row{display:flex;gap:10px;align-items:flex-start}
.thread-bub{background:#f4f8fd;border:1px solid #e7eef8;border-radius:12px;border-top-left-radius:3px;padding:10px 13px;font-size:12.5px;color:#334155;line-height:1.6}
.thread-khoa{display:block;font-size:12px;font-weight:700;color:#1D6FE8;margin-bottom:3px}
.stance{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:7px;white-space:nowrap;flex-shrink:0}
.stance.yes{color:#15803d;background:#dcfce7}.stance.no{color:#b91c1c;background:#fee2e2}.stance.neu{color:#475569;background:#eef2f7}
.ask-cons-hd{display:block;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:#0E9488;margin-bottom:4px}
.teach-block-h{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#0E9488;margin:18px 26px 4px;padding-top:12px;border-top:1px solid #eef3fa}
.teach-mode-note{font-size:11.5px;color:#7A96C8;flex-basis:100%}
.rf-wrap{display:flex;flex-direction:column;gap:9px;padding:0 26px}
.rf{display:flex;gap:11px;align-items:flex-start;border:1px solid #fde0e0;background:#fff6f6;border-radius:12px;padding:11px 13px}
.rf-ic{width:26px;height:26px;border-radius:8px;background:#fee2e2;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.rf-dh{font-size:13px;font-weight:700;color:#b91c1c}
.rf-yn{font-size:12.5px;color:#475569;line-height:1.55;margin-top:2px}
.teach-ans{width:100%;box-sizing:border-box;min-height:54px;border:1px solid #d8e2f0;border-radius:9px;padding:9px 11px;font-size:12.5px;font-family:inherit;resize:vertical;outline:none;margin:8px 0}
.teach-ans:focus{border-color:#0E9488}
.teach-reveal{border:1px solid #cde7e3;background:#f0faf8;color:#0E9488;font-size:12px;font-weight:600;padding:7px 13px;border-radius:9px;cursor:pointer}
.teach-q-num{display:inline-block;font-size:10.5px;font-weight:700;color:#0E9488;background:rgba(14,148,136,.1);padding:2px 8px;border-radius:6px;margin-right:8px}
.teach-q-fb{font-size:12px;color:#475569;line-height:1.6;margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed #e7eef8}
.teach-unlock{margin:0 26px;display:inline-flex;align-items:center;gap:8px;border:1px dashed #9ad9d0;background:#f0faf8;color:#0E7c73;font-size:13px;font-weight:600;padding:12px 16px;border-radius:12px;cursor:pointer}
.dc{margin:0 26px 12px;border:1px solid #e7eef8;border-radius:14px;padding:14px 16px;background:#fafcff}
.dc-q{font-size:13px;font-weight:600;color:#0F2740;line-height:1.6;margin-bottom:11px}
.dc-opts{display:flex;flex-direction:column;gap:8px}
.dc-opt{text-align:left;border:1px solid #d8e2f0;background:#fff;border-radius:10px;padding:10px 13px;font-size:12.5px;color:#334155;cursor:pointer;transition:all .12s}
.dc-opt:hover{border-color:#1D6FE8}
.dc-opt.ok{border-color:#22C55E;background:#f0fdf4;color:#15803d;font-weight:600}
.dc-opt.wrong{border-color:#EF4444;background:#fef2f2;color:#b91c1c}
.dc-fb{margin-top:11px;font-size:12.5px;line-height:1.65;border-radius:10px;padding:11px 13px}
.dc-fb.ok{background:#f0fdf4;color:#166534}.dc-fb.wrong{background:#fffbeb;color:#92400e}
.score-card{margin:0 26px;border:1px solid #e7eef8;border-radius:14px;padding:14px 16px;background:#fafcff}
.score-row{display:flex;align-items:center;gap:10px;margin-bottom:9px;flex-wrap:wrap}
.score-ten{font-size:12.5px;font-weight:600;color:#0F2740;min-width:150px;flex-shrink:0}
.score-bar{flex:1;min-width:90px;height:8px;background:#eef2f7;border-radius:6px;overflow:hidden}
.score-fill{display:block;height:100%;background:linear-gradient(90deg,#0E9488,#1D6FE8);border-radius:6px}
.score-num{font-size:12px;font-weight:700;color:#0E9488;min-width:38px}
.score-nx{flex-basis:100%;font-size:11.5px;color:#7A96C8;padding-left:160px;line-height:1.45}
.score-overall{margin-top:6px;padding-top:10px;border-top:1px solid #eef3fa;font-size:13.5px;color:#0F2740}.score-overall b{color:#0E9488;font-size:16px}
.tb-group{display:inline-flex;align-items:center;gap:2px;background:#f1f5fb;border-radius:11px;padding:3px}
.tb-btn{display:inline-flex;align-items:center;gap:6px;border:none;background:none;color:#475569;font-size:12.5px;font-weight:600;padding:7px 11px;border-radius:8px;cursor:pointer}
.tb-btn:hover{background:#fff;color:#1D6FE8}
.tb-btn.danger:hover{color:#DC2626}
.pw-wrap{position:relative}
.pw-eye{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:4px;color:#7A96C8;display:flex}
.rec-inline-wrap{margin-top:14px;border:1px solid #dbe6f5;border-radius:14px;padding:13px 15px;background:linear-gradient(180deg,rgba(29,111,232,.045),rgba(14,148,136,.03))}
.rec-inline-h{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:#0F2740;margin-bottom:10px}
.rec-inline{display:flex;flex-direction:column}
.rec-inline-row{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.rec-attach{display:inline-flex;align-items:center;gap:6px;border:none;background:#0E9488;color:#fff;font-size:12.5px;font-weight:600;padding:9px 14px;border-radius:10px;cursor:pointer}
.rec-attach:hover{background:#0c7a70}
.up-logout{position:absolute;top:18px;right:20px;z-index:5;display:inline-flex;align-items:center;gap:6px;border:1px solid #e2e8f0;background:rgba(255,255,255,.9);color:#475569;font-size:12.5px;font-weight:600;padding:7px 13px;border-radius:10px;cursor:pointer;backdrop-filter:blur(4px)}
.up-logout:hover{border-color:#DC2626;color:#DC2626}
@media(max-width:620px){.disc-grid,.invite-grid{grid-template-columns:1fr}.ask-khoa{min-width:120px}.score-nx{padding-left:0}.risk-ten{min-width:120px}}
.login-inner2{position:relative;z-index:1;width:100%;max-width:1120px;display:flex;flex-direction:column;gap:20px}
.login-grid{display:grid;grid-template-columns:minmax(350px,410px) 1fr;gap:34px;align-items:stretch}
.login-col-form{display:flex}
.login-col-form .login-card{width:100%;max-width:none;margin:0}
.login-col-hero{display:flex;flex-direction:column;justify-content:center;color:#eaf2ff;padding:10px 4px}
.login-hero-tag{align-self:flex-start;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9fc6ff;background:rgba(125,200,255,.12);border:1px solid rgba(125,200,255,.25);padding:5px 12px;border-radius:20px;margin-bottom:16px}
.login-hero-title{font-size:30px;line-height:1.25;font-weight:800;color:#fff;margin:0 0 14px;letter-spacing:-.5px}
.login-hero-desc{font-size:14px;line-height:1.7;color:#bcd2f0;margin:0 0 20px;max-width:520px}
.login-feat{display:flex;flex-direction:column;gap:11px;margin-bottom:22px}
.login-feat-row{display:flex;align-items:center;gap:11px;font-size:13.5px;color:#dbe7fb;font-weight:500}
.login-feat-ic{width:32px;height:32px;border-radius:9px;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.login-stats{display:flex;gap:14px;flex-wrap:wrap}
.login-stat{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:13px 16px;min-width:118px}
.login-stat-v{font-size:21px;font-weight:800;color:#fff}
.login-stat-l{font-size:11.5px;color:#a8c4e8;line-height:1.4;margin-top:3px}
.login-logos .logo-bar{flex-wrap:nowrap;justify-content:space-around;align-items:flex-end;gap:16px 24px;max-width:none;overflow-x:auto;padding:18px 16px 14px}
.login-logos .logo-group{gap:9px}
.login-logos .logo-group-lbl{font-size:11px}
.login-logos .logo-group-imgs{gap:14px}
.login-logos .logo-slot{height:54px;min-width:62px}
.nav-right{gap:14px}
.tab-group{gap:3px}
.tb-group{gap:3px;padding:4px}
.tb-btn{padding:8px 12px;gap:7px}
@media(max-width:900px){.login-grid{grid-template-columns:1fr;max-width:430px;margin:0 auto}.login-col-hero{display:none}}
.mode-cd{position:relative}
.mode-cd-btn{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #d8e2f0;border-radius:11px;padding:8px 12px;font-size:13px;font-weight:600;color:#0F2740;cursor:pointer;transition:all .15s;min-width:176px}
.mode-cd-btn:hover{border-color:#1D6FE8;box-shadow:0 1px 8px rgba(29,111,232,.12)}
.mode-cd-btn.open{border-color:#1D6FE8;box-shadow:0 1px 8px rgba(29,111,232,.14)}
.mode-cd-dot{width:7px;height:7px;border-radius:50%;background:#1D6FE8;flex-shrink:0}
.mode-cd-chev{margin-left:auto;color:#7A96C8;transition:transform .18s}
.mode-cd-btn.open .mode-cd-chev{transform:rotate(180deg)}
.mode-cd-ov{position:fixed;inset:0;z-index:40}
.mode-cd-list{position:absolute;top:calc(100% + 6px);left:0;min-width:210px;background:#fff;border:1px solid #e7eef8;border-radius:12px;box-shadow:0 10px 30px rgba(15,39,64,.16);padding:5px;z-index:41;animation:fadeIn .14s ease}
.mode-cd-item{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:none;background:none;font-size:13px;font-weight:500;color:#334155;padding:9px 11px;border-radius:9px;cursor:pointer;transition:background .12s}
.mode-cd-item:hover{background:#f1f6fd;color:#1D6FE8}
.mode-cd-item.sel{background:rgba(29,111,232,.08);color:#1D6FE8;font-weight:600}
.mode-cd-item svg{margin-left:auto}
.nav-export{display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#1D6FE8,#0E9488);color:#fff;border:none;border-radius:11px;padding:9px 15px;font-size:13px;font-weight:600;cursor:pointer;transition:filter .15s;white-space:nowrap}
.nav-export:hover{filter:brightness(1.07)}
.nav-menu-wrap{position:relative}
.nav-burger{width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;background:#f1f5fb;border:1px solid #e2e8f0;border-radius:11px;cursor:pointer;transition:all .15s;padding:0}
.nav-burger:hover{background:#e7eef8;border-color:#1D6FE8}
.nav-menu-ov{position:fixed;inset:0;z-index:40}
.nav-menu{position:absolute;top:calc(100% + 8px);right:0;min-width:212px;background:#fff;border:1px solid #e7eef8;border-radius:13px;box-shadow:0 12px 34px rgba(15,39,64,.18);padding:6px;z-index:41;animation:fadeIn .14s ease}
.nav-menu button{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:none;background:none;font-size:13px;font-weight:500;color:#334155;padding:10px 12px;border-radius:9px;cursor:pointer;transition:background .12s}
.nav-menu button:hover{background:#f1f6fd}
.nav-menu button.danger{color:#DC2626}
.nav-menu button.danger:hover{background:#fef2f2}
.nav-menu-sec{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#9fb2cc;padding:9px 12px 4px}
.nav-menu-sec:first-child{padding-top:5px}
.nav-menu{max-height:calc(100vh - 86px);overflow-y:auto}
body.theme-dark .nav-menu-sec{color:#7689A8}
body.theme-dark .score-card,body.theme-dark .mdt-op,body.theme-dark .ask-ans,body.theme-dark .dc,body.theme-dark .prio{background:#161F33;border-color:#28364E}
.copy-btn.done{color:#059669;border-color:#a7f3d0;background:#ecfdf5}
body.theme-dark .copy-btn.done{color:#6EE7B7;background:#0c2a22;border-color:#1d5e4a}
.skel-wrap{max-width:440px;margin:8px auto 0;display:flex;flex-direction:column;gap:12px;padding:0 8px}
.skel-card{border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:9px;background:var(--glass)}
.skel-row{display:flex;gap:10px}
.skel-box{flex:1;height:46px;border-radius:10px;background:linear-gradient(100deg,#eef3f9 30%,#dfe8f3 50%,#eef3f9 70%);background-size:200% 100%;animation:skelsh 1.3s ease-in-out infinite}
.skel-line{height:10px;border-radius:6px;background:linear-gradient(100deg,#eef3f9 30%,#dfe8f3 50%,#eef3f9 70%);background-size:200% 100%;animation:skelsh 1.3s ease-in-out infinite}
.skel-line.w40{width:40%}.skel-line.w55{width:55%}.skel-line.w70{width:70%}.skel-line.w75{width:75%}.skel-line.w90{width:90%}.skel-line.w95{width:95%}
@keyframes skelsh{0%{background-position:200% 0}100%{background-position:-200% 0}}
.psnap{position:fixed;top:52px;left:0;right:0;z-index:45;background:rgba(255,255,255,0.96);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border);transform:translateY(-130%);transition:transform .26s ease;box-shadow:0 4px 16px rgba(16,41,66,.06)}
.psnap.show{transform:translateY(0)}
.psnap-inner{max-width:1120px;margin:0 auto;padding:8px 24px;display:flex;align-items:center;gap:12px;overflow:hidden}
.psnap-name{font-size:13px;font-weight:700;color:var(--navy);white-space:nowrap}
.psnap-meta{font-size:11.5px;color:var(--muted);white-space:nowrap}
.psnap-dx{font-size:12px;color:var(--navy3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:40px}
.psnap-chips{display:flex;gap:6px;flex-shrink:0;margin-left:auto}
.psnap-chip{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:20px;white-space:nowrap}
.psnap-chip.ef{background:#e0f2fe;color:#0369a1}
.psnap-chip.alert{background:#fee2e2;color:#dc2626}
.reveal{opacity:0;transform:translateY(14px);transition:opacity .5s ease,transform .5s ease,box-shadow .2s}
.reveal.in{opacity:1;transform:none}
.mode-cd-list{padding:6px;border-radius:14px;box-shadow:0 18px 44px rgba(15,39,64,.18);min-width:268px}
.mode-cd-item{border-radius:10px;padding:10px 11px;gap:10px;align-items:flex-start}
.mode-cd-item:hover{background:#f3f7fd}
.mode-cd-item.sel{background:#eaf2fe}
.mode-cd-item .mode-cd-dot{margin-top:4px}
.mode-cd-txt b{font-size:13px}
.mode-cd-txt span{font-size:11.5px;line-height:1.4}
.mode-cd-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;box-shadow:0 0 0 3px rgba(0,0,0,.04)}
body.theme-dark .mode-cd-item:hover{background:#1B2536}
body.theme-dark .mode-cd-item.sel{background:#15233b}
.mdt-step{cursor:pointer;user-select:none}
.mdt-step-chev{margin-left:auto;display:inline-flex;align-items:center}
.mdt-step.collapsed + div{display:none}
.sec-tools{display:inline-flex;align-items:center;gap:3px;margin-left:auto}
.mdt-step .mdt-step-chev{margin-left:6px}
.teach-sec-t .teach-sec-chev{margin-left:6px}
.teach-sec-t .sec-tools .copy-btn,.teach-sec-t .sec-tools .flag-btn,.mdt-step .sec-tools .copy-btn,.mdt-step .sec-tools .flag-btn{padding:3px}
.bm-ov{background:var(--page-bg);align-items:flex-start;justify-content:center;padding:0;overflow-y:auto}
.bm-panel{background:transparent;width:100%;max-width:780px;min-height:100vh;max-height:none;border-radius:0;box-shadow:none;padding:0 20px 48px}
.bm-head{position:sticky;top:0;background:var(--page-bg);font-size:17px;padding:22px 2px 14px;z-index:1}
.bm-body{padding:16px 0}
.bm-item{background:var(--glass);border:1px solid var(--border);margin-bottom:8px;border-radius:12px}
.bm-empty{margin-top:34px}
body.theme-dark .bm-panel{background:transparent}
body.theme-dark .bm-head{background:var(--page-bg)}
body.theme-dark .bm-item{background:#141D2F;border-color:#28364E}
.teach-sec-t{display:flex;align-items:center;gap:8px}
.teach-sec-chev{margin-left:auto;display:inline-flex;align-items:center}
body.theme-dark .psnap{background:rgba(12,20,34,0.96);border-color:#28364E}
body.theme-dark .psnap-name{color:#EAF1FB}
body.theme-dark .psnap-dx{color:#C7D4E6}
body.theme-dark .psnap-chip.ef{background:#0c2f44;color:#7dd3fc}
body.theme-dark .psnap-chip.alert{background:#3a1414;color:#fca5a5}
@media(max-width:860px){.psnap-inner{padding:8px 12px}.psnap-dx{display:none}}
body.theme-dark .skel-box,body.theme-dark .skel-line{background:linear-gradient(100deg,#1a2233 30%,#222d42 50%,#1a2233 70%);background-size:200% 100%}
.card:hover{box-shadow:var(--shadow-md)}
.sidebar-item.active{box-shadow:inset 3px 0 0 var(--blue)}
.btn-primary:active,.nav-export:active,.sn-send:active,.cfm-ok:active,.note-attach:active{transform:translateY(1px)}
::selection{background:rgba(29,111,232,.2)}
body.theme-dark ::selection{background:rgba(91,149,242,.32)}
.tb-btn,.nav-export,.theme-toggle,.nav-burger,.copy-btn,.flag-btn,.chip-tag{transition:all .15s ease}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
.note-text{width:100%;box-sizing:border-box;min-height:60px;border:1px solid #d8e2f0;border-radius:10px;padding:10px 12px;font-size:13px;font-family:inherit;resize:vertical;outline:none;margin-bottom:9px}
.note-text:focus{border-color:#1D6FE8}
.note-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.note-attach{display:inline-flex;align-items:center;gap:6px;border:none;background:#1D6FE8;color:#fff;font-size:12.5px;font-weight:600;padding:9px 14px;border-radius:10px;cursor:pointer}
.note-attach:hover{filter:brightness(1.06)}
.note-attach:disabled{opacity:.5;cursor:not-allowed}
.note-upload{display:inline-flex;align-items:center;gap:7px;border:1px solid #cfe0f5;background:#fff;color:#1D6FE8;font-size:12.5px;font-weight:600;padding:9px 14px;border-radius:10px;cursor:pointer}
.note-upload:hover{background:rgba(29,111,232,.06)}
.rec-divider{display:flex;align-items:center;gap:10px;margin:13px 0 11px;color:#9fb2cc;font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.rec-divider:before,.rec-divider:after{content:"";flex:1;height:1px;background:#e2eaf4}
.login-team{font-size:11.5px;font-weight:600;color:#a8c4e8;margin-bottom:14px;line-height:1.5}
.smart-note{border:1px solid #d8e2f0;border-radius:13px;background:#fff;overflow:hidden;transition:border-color .15s}
.smart-note:focus-within{border-color:#1D6FE8}
.smart-note.rec{border-color:#0E9488}
.smart-note-ta{display:block;width:100%;box-sizing:border-box;min-height:74px;border:none;outline:none;resize:vertical;padding:12px 13px;font-size:13.5px;font-family:inherit;color:#0F2740;background:transparent}
.smart-note-bar{display:flex;align-items:center;gap:9px;padding:8px 10px;border-top:1px solid #eef3fa;background:#fafcff}
.sn-mic{display:inline-flex;align-items:center;gap:7px;border:1px solid #d8e2f0;background:#fff;color:#475569;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:9px;cursor:pointer;transition:all .15s}
.sn-mic:hover{border-color:#0E9488;color:#0E9488}
.sn-mic.on{border-color:#0E9488;color:#0E9488;background:rgba(14,148,136,.08)}
.sn-mic:disabled{opacity:.5;cursor:not-allowed}
.sn-send{display:inline-flex;align-items:center;gap:7px;border:none;background:#1D6FE8;color:#fff;font-size:12.5px;font-weight:600;padding:8px 14px;border-radius:9px;cursor:pointer}
.sn-send:hover{filter:brightness(1.06)}
.sn-send:disabled{opacity:.45;cursor:not-allowed}
.stats-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.login-stats{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.login-stat{min-width:0}
.sn-count{font-size:11px;color:#9fb2cc;font-weight:500;white-space:nowrap}
.mode-cd-txt{display:flex;flex-direction:column;line-height:1.25;text-align:left}
.mode-cd-txt b{font-size:13px;font-weight:600}
.mode-cd-txt span{font-size:11px;color:#7A96C8;font-weight:400}
.mode-cd-list{min-width:236px}
.toast-host{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:200;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
.toast{display:inline-flex;align-items:center;gap:9px;background:#0F2740;color:#fff;font-size:13px;font-weight:500;padding:11px 16px;border-radius:12px;box-shadow:0 10px 30px rgba(15,39,64,.3);animation:toastIn .22s ease}
.toast.ok{background:linear-gradient(135deg,#0E9488,#1D6FE8)}
.toast.err{background:#B91C1C}
@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.cfm-ov{position:fixed;inset:0;z-index:210;background:rgba(15,39,64,.45);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px;animation:toastIn .15s ease}
.cfm{background:#fff;border-radius:16px;max-width:380px;width:100%;padding:22px;box-shadow:0 24px 60px rgba(15,39,64,.3)}
.cfm-t{font-size:16px;font-weight:800;color:#0F2740;margin-bottom:8px}
.cfm-m{font-size:13.5px;color:#5A748F;line-height:1.6;margin-bottom:20px}
.cfm-actions{display:flex;gap:10px;justify-content:flex-end}
.cfm-cancel{border:1px solid #d8e2f0;background:#fff;color:#475569;font-size:13px;font-weight:600;padding:9px 16px;border-radius:10px;cursor:pointer}
.cfm-cancel:hover{background:#f1f5fb}
.cfm-ok{border:none;background:#1D6FE8;color:#fff;font-size:13px;font-weight:600;padding:9px 18px;border-radius:10px;cursor:pointer}
.cfm-ok:hover{filter:brightness(1.06)}
.cfm-ok.danger{background:#DC2626}
.copy-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid #cfe0f5;background:#fff;color:#1D6FE8;font-size:11.5px;font-weight:600;padding:5px 10px;border-radius:8px;cursor:pointer;transition:all .12s}
.copy-btn:hover{background:rgba(29,111,232,.08)}
.summary-hd .copy-btn{border-color:rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff}
.summary-hd .copy-btn:hover{background:rgba(255,255,255,.22)}
.rpt-search{margin-left:auto;display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid #d8e2f0;border-radius:9px;padding:6px 10px;transition:border-color .15s}
.rpt-search:focus-within{border-color:#1D6FE8}
.rpt-search input{border:none;outline:none;font-size:12.5px;width:170px;background:transparent;color:#0F2740}
.rpt-search-x{border:none;background:none;cursor:pointer;display:flex;padding:0}
.search-hit{background:#fff3bf!important;border-radius:5px;box-shadow:0 0 0 3px #ffe066;transition:background .3s,box-shadow .3s}
@media(max-width:760px){.rpt-search{margin-left:0}.rpt-search input{width:120px}}

/* ── Thang điểm nguy cơ (CHA2DS2-VASc / HAS-BLED) ───────────────────────── */
.risk-disclaimer-top{font-size:12.5px;color:#64748B;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:9px 12px;margin-bottom:14px;line-height:1.5}
.risk-block{border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-bottom:14px;background:var(--glass)}
.risk-block-hd{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:14.5px;font-weight:700;color:#0F2740;margin-bottom:10px}
.risk-block-sub{font-size:12px;font-weight:500;color:#64748B}
.risk-gauge{margin-bottom:10px}
.risk-gauge-top{display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px}
.risk-gauge-lbl{color:#5A748F;font-weight:600}
.risk-gauge-val{font-weight:700;font-size:13.5px}
.risk-gauge-track{height:7px;border-radius:5px;background:#EEF2F7;overflow:hidden}
.risk-gauge-fill{height:100%;border-radius:5px;transition:width .4s ease}
.risk-context-alert{display:flex;gap:8px;align-items:flex-start;background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:9px 12px;font-size:12.5px;color:#7F1D1D;line-height:1.55;margin-bottom:10px}
.risk-context-note{font-size:12.5px;color:#64748B;line-height:1.55;margin-bottom:10px}
.risk-rows{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.risk-row{display:flex;gap:10px;align-items:flex-start;padding:7px 9px;border-radius:9px;background:#FAFCFE}
.risk-row.on{background:#FFF7F7}
.risk-row-chip{flex-shrink:0;font-size:11px;font-weight:700;border:1px solid;border-radius:7px;padding:2px 7px;min-width:28px;text-align:center}
.risk-row-body{flex:1;min-width:0}
.risk-row-name{font-size:12.5px;font-weight:600;color:#1E293B}
.risk-row-note{font-size:11.5px;color:#7689A8;margin-top:1px}
body.theme-dark .risk-disclaimer-top{background:#141E2C;border-color:#2A3A52;color:#9FB3CC}
body.theme-dark .risk-block{background:#101A2A;border-color:#2A3A52}
body.theme-dark .risk-block-hd{color:#EAF1FB}
body.theme-dark .risk-block-sub{color:#7689A8}
body.theme-dark .risk-gauge-track{background:#1A2536}
body.theme-dark .risk-context-alert{background:#3a1414;border-color:#5c2222;color:#fca5a5}
body.theme-dark .risk-context-note{color:#9FB3CC}
body.theme-dark .risk-row{background:#141E2C}
body.theme-dark .risk-row.on{background:#2a1616}
body.theme-dark .risk-row-name{color:#D6E2F2}
body.theme-dark .risk-row-note{color:#7689A8}
body.theme-dark .fmt-chip-soon{color:#64748B;background:#141E2C;border-color:#2A3A52}

/* ── EcgPanel: quét điện tâm đồ ──────────────────────────────────────────── */
.ecg-overlay{position:fixed;inset:0;background:rgba(10,22,40,.55);display:flex;align-items:center;justify-content:center;z-index:200;padding:20px}
.ecg-modal{background:var(--glass);border-radius:20px;max-width:920px;width:100%;max-height:88vh;overflow-y:auto;padding:22px 26px;box-shadow:0 30px 70px rgba(0,0,0,.35)}
.ecg-disclaimer{display:flex;gap:9px;align-items:flex-start;background:#FFFBEB;border:1px solid #FDE68A;border-radius:11px;padding:11px 14px;font-size:12.5px;color:#92400e;line-height:1.55;margin-bottom:16px}
.ecg-dropzone{border:2px dashed #BFD3EE;border-radius:16px;padding:40px 20px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s}
.ecg-dropzone:hover{border-color:#1D6FE8;background:rgba(29,111,232,.04)}
.ecg-workspace{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media(max-width:700px){.ecg-workspace{grid-template-columns:1fr}}
.ecg-col-label{font-size:12px;font-weight:700;color:#5A748F;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px}
.ecg-img{width:100%;border-radius:12px;border:1px solid var(--border);max-height:260px;object-fit:contain;background:#fff}
.ecg-actions{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}
.ecg-loading{font-size:13px;color:#5A748F;padding:20px 0;text-align:center}
.ecg-signal-svg{width:100%;height:140px;background:#fff;border:1px solid var(--border);border-radius:10px}
.ecg-hr-row{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}
.ecg-hr-box{flex:1;min-width:140px;background:#F8FAFC;border:1px solid var(--border);border-radius:12px;padding:11px 14px}
.ecg-hr-lbl{font-size:11px;color:#7689A8;font-weight:600;margin-bottom:4px}
.ecg-hr-val{font-size:20px;font-weight:700;color:#0F2740}
body.theme-dark .ecg-modal{background:#0F1A2C}
body.theme-dark .ecg-disclaimer{background:#2a2010;border-color:#5c4a1a;color:#fcd34d}
body.theme-dark .ecg-dropzone{border-color:#2A3A52}
body.theme-dark .ecg-dropzone:hover{background:rgba(29,111,232,.08)}
body.theme-dark .ecg-col-label{color:#7689A8}
body.theme-dark .ecg-img{background:#1A2536;border-color:#2A3A52}
body.theme-dark .ecg-signal-svg{background:#1A2536;border-color:#2A3A52}
body.theme-dark .ecg-hr-box{background:#141E2C;border-color:#2A3A52}
body.theme-dark .ecg-hr-lbl{color:#7689A8}
body.theme-dark .ecg-hr-val{color:#EAF1FB}
`

// ─── Toast + Confirm + Copy (UX dùng chung) ──────────────────────────────────
function mpToast(msg, kind="ok"){ if(typeof window!=="undefined") window.dispatchEvent(new CustomEvent("mp-toast",{ detail:{ msg, kind } })) }
function ToastHost(){
  const [items, setItems] = useState([])
  useEffect(() => {
    const h = (e) => {
      const id = Date.now() + Math.random()
      setItems(x => [...x, { id, ...e.detail }])
      setTimeout(() => setItems(x => x.filter(i => i.id !== id)), 2600)
    }
    window.addEventListener("mp-toast", h)
    return () => window.removeEventListener("mp-toast", h)
  }, [])
  return (
    <div className="toast-host">
      {items.map(i => (
        <div key={i.id} className={`toast ${i.kind}`}>
          {i.kind==="err" ? <Icon.Alert d={15} color="#fff"/> : <Icon.ShieldCheck d={15} color="#fff"/>}
          {i.msg}
        </div>
      ))}
    </div>
  )
}
let _mpConfirmFn = null
function mpConfirm(opts){ return new Promise(res => { if(_mpConfirmFn) _mpConfirmFn(opts, res); else res(true) }) }
function ConfirmHost(){
  const [st, setSt] = useState(null)
  useEffect(() => { _mpConfirmFn = (opts, res) => setSt({ ...opts, res }); return () => { _mpConfirmFn = null } }, [])
  if(!st) return null
  const done = (v) => { st.res(v); setSt(null) }
  return (
    <div className="cfm-ov" onClick={()=>done(false)}>
      <div className="cfm" onClick={e=>e.stopPropagation()}>
        <div className="cfm-t">{st.title}</div>
        <div className="cfm-m">{st.message}</div>
        <div className="cfm-actions">
          <button className="cfm-cancel" onClick={()=>done(false)}>{st.cancelText||"Hủy"}</button>
          <button className={`cfm-ok${st.danger?" danger":""}`} onClick={()=>done(true)}>{st.okText||"Đồng ý"}</button>
        </div>
      </div>
    </div>
  )
}
function CountUp({ value, decimals=0, suffix="" }){
  const target = typeof value === "number" ? value : parseFloat(value)
  const [d, setD] = useState(0)
  useEffect(() => {
    if(!isFinite(target)) return
    let reduce = false
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches } catch {}
    if(reduce){ setD(target); return }
    let raf, start
    const dur = 850
    const step = (ts) => {
      if(!start) start = ts
      const p = Math.min(1, (ts - start) / dur)
      const e = 1 - Math.pow(1 - p, 3)
      setD(target * e)
      if(p < 1) raf = requestAnimationFrame(step); else setD(target)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])
  if(!isFinite(target)) return <>{value}</>
  return <>{d.toFixed(decimals)}{suffix}</>
}
function CopyBtn({ text, label="" }){
  const [done, setDone] = useState(false)
  const copy = async () => {
    const v = typeof text === "function" ? text() : text
    try { await navigator.clipboard.writeText(v || ""); setDone(true); setTimeout(()=>setDone(false), 1200) }
    catch { mpToast("Trình duyệt không cho sao chép tự động", "err") }
  }
  return <button className={`copy-btn${done?" done":""}`} onClick={copy} title="Sao chép nội dung">{done
    ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}{done ? (label ? "Đã chép" : "") : label}</button>
}

function ThemeToggle(){
  const [dark, setDark] = useState(false)
  useEffect(() => {
    let v = false
    try { v = sessionStorage.getItem("mp_theme") === "dark" } catch {}
    document.body.classList.toggle("theme-dark", v)
    setDark(v)
  }, [])
  const toggle = () => {
    const v = !dark
    setDark(v)
    document.body.classList.toggle("theme-dark", v)
    try { sessionStorage.setItem("mp_theme", v ? "dark" : "light") } catch {}
    mpToast(v ? "Đã bật chế độ tối" : "Đã bật chế độ sáng")
  }
  return (
    <button className="theme-toggle" onClick={toggle} title={dark?"Chuyển chế độ sáng":"Chuyển chế độ tối"} aria-label="Đổi giao diện sáng/tối">
      {dark
        ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}
    </button>
  )
}

function FocusToggle(){
  const [on, setOn] = useState(false)
  const toggle = () => {
    const v = !on
    setOn(v)
    document.body.classList.toggle("focus-mode", v)
    mpToast(v ? "Đã bật chế độ trình chiếu" : "Đã tắt chế độ trình chiếu")
  }
  return (
    <button className="theme-toggle" onClick={toggle} title={on?"Thoát trình chiếu":"Chế độ trình chiếu (ẩn bớt khung viền)"} aria-label="Chế độ trình chiếu">
      {on
        ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>
        : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>}
    </button>
  )
}

function mpHelp(){ if(typeof window!=="undefined") window.dispatchEvent(new CustomEvent("mp-help")) }
function ShortcutHelp(){
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const h = () => setOpen(true)
    const esc = (e) => { if(e.key === "Escape") setOpen(false) }
    window.addEventListener("mp-help", h)
    window.addEventListener("keydown", esc)
    return () => { window.removeEventListener("mp-help", h); window.removeEventListener("keydown", esc) }
  }, [])
  if(!open) return null
  const ROWS = [
    { k:["1","2","3"], d:"Chuyển chế độ: Bác sĩ, Hội chẩn AI, Giảng dạy" },
    { k:["/"], d:"Tìm nhanh trong báo cáo" },
    { k:["Ctrl/Cmd","K"], d:"Mở trợ lý MedAmi (chatbot)" },
    { k:["Esc"], d:"Đóng bảng, menu hoặc popup đang mở" },
    { k:["?"], d:"Mở bảng phím tắt này" },
  ]
  return (
    <div className="sh-ov" onClick={()=>setOpen(false)}>
      <div className="sh-panel" onClick={e=>e.stopPropagation()}>
        <div className="sh-head"><Icon.Layers d={16} color="#1D6FE8"/><span>Phím tắt</span><button className="dn-x" onClick={()=>setOpen(false)} aria-label="Đóng"><Icon.Close d={14} color="#64748B"/></button></div>
        <div className="sh-body">
          {ROWS.map((r,i)=>(
            <div key={i} className="sh-row">
              <div className="sh-keys">{r.k.map((k,j)=><kbd key={j} className="sh-kbd">{k}</kbd>)}</div>
              <div className="sh-desc">{r.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(() => { try { return sessionStorage.getItem("mp_auth")==="1" } catch { return false } })
  const login = () => { try { sessionStorage.setItem("mp_auth","1") } catch {} setAuthed(true) }
  const logout = () => { try { sessionStorage.removeItem("mp_auth") } catch {} setAuthed(false); setState("upload"); setReport(null); setAnalysis(null); setChatMessages([]); setCurrentId(null); setShowHistory(false) }
  const [state, setState] = useState("upload")
  const [report, setReport] = useState(null)
  const [hoSoText, setHoSoText] = useState("")
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState("")
  const [lastFile, setLastFile] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const [chatMessages, setChatMessages] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [showEcg, setShowEcg] = useState(false)
  const [currentId, setCurrentId] = useState(null)

  useEffect(() => {
    document.title = "MedParcours AI"
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">'
      + '<defs><linearGradient id="f" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">'
      + '<stop stop-color="#1A56DB"/><stop offset="0.55" stop-color="#1D6FE8"/><stop offset="1" stop-color="#0E9488"/>'
      + '</linearGradient></defs>'
      + '<rect width="40" height="40" rx="9" fill="url(#f)"/>'
      + '<path d="M20 30.5 C20 30.5 8 23.2 8 15 C8 11.2 10.8 8.6 14.2 8.6 C16.6 8.6 18.7 10 20 12.2 C21.3 10 23.4 8.6 25.8 8.6 C29.2 8.6 32 11.2 32 15 C32 23.2 20 30.5 20 30.5 Z" fill="none" stroke="#fff" stroke-width="1.6" stroke-opacity="0.3"/>'
      + '<path d="M5.5 20.5 H13.5 L16 14.2 L20 27.2 L23 17.6 L25.5 20.5 H34.5" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="34.5" cy="20.5" r="2.6" fill="#7FE7F5"/></svg>'
    const href = "data:image/svg+xml," + encodeURIComponent(svg)
    let link = document.querySelector("link[rel~='icon']")
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link) }
    link.type = "image/svg+xml"
    link.href = href
  }, [])

  const initChat = useCallback((rpt) => {
    setChatMessages([{role:"assistant", content: modeGreeting("clinical", rpt.thong_tin_benh_nhan && rpt.thong_tin_benh_nhan.ho_ten)}])
  }, [])

  const handleUpload = async (file) => {
    // Không có file: dùng hồ sơ mẫu (nút "Xem demo")
    if (!file) {
      setReport(MOCK_REPORT); setHoSoText(JSON.stringify(MOCK_REPORT)); setAnalysis(null)
      initChat(MOCK_REPORT); setCurrentId("BN-A"); setState("report"); return
    }
    setLastFile(file)
    setLoading(true); setUploadError(null); setLoadingMsg("")
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 240000)  // 240s cho hồ sơ rất dày

    // Áp dụng kết quả trả về từ backend (dùng chung cho cả 2 đường).
    // LƯU Ý: lỗi từ FastAPI HTTPException nằm ở field "detail", còn lỗi tự
    // định nghĩa trong run_analysis_pipeline (hồ sơ quá ngắn...) nằm ở field
    // "error" — phải đọc cả 2, ưu tiên "detail" vì đó là message backend cố
    // ý viết rõ nguyên nhân (sai định dạng file, ảnh chưa hỗ trợ OCR...).
    const applyData = (data, status) => {
      if (!data || !data.success) {
        setUploadError((data && (data.detail || data.error)) || `Máy chủ trả lỗi (mã ${status}). Hãy thử lại.`)
        setLoading(false); return false
      }
      setReport(data.report)
      setHoSoText(data.ho_so_text || JSON.stringify(data.report))
      setAnalysis(data.analysis || null)
      initChat(data.report)
      setLoading(false); setState("report"); return true
    }

    const isPdf = (file.type === "application/pdf") || /\.pdf$/i.test(file.name || "")
    try {
      // ── Đường chính cho PDF: bóc chữ ở trình duyệt, chỉ gửi chữ (nhẹ) lên server ──
      if (isPdf) {
        try {
          const { text, pages } = await extractPdfText(file, (done, total) => {
            setLoadingMsg(`Đang đọc ${done}/${total} trang`)
          })
          setLoadingMsg(pages > 120 ? "Đang lọc trang quan trọng và phân tích..." : "AI đang đọc và tổng hợp dữ liệu")
          if (text && text.replace(/[^A-Za-zÀ-ỹ0-9]/g, "").length >= 100) {
            const res = await fetch(`${API_URL}/analyze_text`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ho_so_text: text, pages }),
              signal: ctrl.signal,
            })
            clearTimeout(timer)
            let data; try { data = await res.json() } catch { data = null }
            if (!data) {
              setUploadError(`Máy chủ phân tích gặp lỗi (mã ${res.status}). Hãy thử lại sau giây lát.`)
              setLoading(false); return
            }
            applyData(data, res.status); return
          }
          // text quá ít (PDF scan ảnh) -> rơi xuống gửi file để server xử lý/ báo lỗi rõ
        } catch (exErr) {
          // pdf.js không tải được hoặc PDF lỗi -> quay về gửi file
        }
      }

      // ── Đường dự phòng: gửi nguyên file (PDF nhỏ, ảnh, hoặc bóc chữ thất bại) ──
      const fd = new FormData(); fd.append("file", file)
      const res = await fetch(`${API_URL}/analyze`, { method:"POST", body:fd, signal:ctrl.signal })
      clearTimeout(timer)
      let data; try { data = await res.json() } catch { data = null }
      if (!data) {
        setUploadError(`Máy chủ phân tích gặp lỗi (mã ${res.status}). File có thể quá lớn để tải lên trực tiếp; nếu là PDF scan, hãy dùng bản PDF có chữ.`)
        setLoading(false); return
      }
      applyData(data, res.status)
    } catch (e) {
      clearTimeout(timer)
      if (e.name === "AbortError") {
        setUploadError("Quá thời gian xử lý (hơn 240 giây). Hồ sơ rất dày nên AI cần lâu hơn, hoặc máy chủ vừa khởi động lại. Hãy thử lại.")
      } else {
        setUploadError("Không kết nối được máy chủ phân tích. Máy chủ có thể đang khởi động lại (chờ rồi thử lại), hoặc trình duyệt chặn (CORS). Chatbot chạy được nghĩa là khóa API vẫn ổn.")
      }
      setLoading(false)
    }
  }

  const loadRecord = (rec) => {
    setReport(rec.data); setHoSoText(JSON.stringify(rec.data)); setAnalysis(null)
    initChat(rec.data); setCurrentId(rec.id); setShowHistory(false); setUploadError(null); setState("report")
  }

  if (!authed) {
    return (<><style>{CSS}</style><style>{EXTRA_CSS}</style><LoginPage onLogin={login}/><ToastHost/></>)
  }

  return (
    <>
      <style>{CSS}</style>
      <style>{EXTRA_CSS}</style>
      <ErrorBoundary>
        {state === "upload" && <UploadPage onUpload={handleUpload} isLoading={loading} loadingMsg={loadingMsg} error={uploadError} onDismissError={()=>setUploadError(null)} onRetry={()=>lastFile && handleUpload(lastFile)} onOpenHistory={()=>setShowHistory(true)} onOpenEcg={()=>setShowEcg(true)} onLogout={logout}/>}
        {state === "report" && report && (
          <ReportPage report={report} hoSoText={hoSoText} analysis={analysis}
            onReset={()=>{setState("upload");setReport(null);setAnalysis(null);setChatMessages([]);setCurrentId(null)}}
            chatMessages={chatMessages} setChatMessages={setChatMessages}
            onOpenHistory={()=>setShowHistory(true)} onLogout={logout}/>
        )}
        {showHistory && <HistoryPanel onClose={()=>setShowHistory(false)} onOpen={loadRecord} currentId={currentId}/>}
        {showEcg && <EcgPanel onClose={()=>setShowEcg(false)}/>}
        <ToastHost/>
        <ConfirmHost/>
        <ShortcutHelp/>
      </ErrorBoundary>
    </>
  )
}
