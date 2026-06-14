import { useState, useRef, useEffect, useCallback } from "react"

// API_URL: trỏ tới backend đã deploy trên Render. Đổi link dưới nếu backend đổi URL.
// (Có thể ghi đè bằng window.MEDIFLOW_API_URL trong index.html mà không cần sửa file này.)
const API_URL = (typeof window !== "undefined" && window.MEDIFLOW_API_URL) || "https://mediflow-ai-8zhx.onrender.com"

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
  .hero-wrap{position:relative;z-index:10;max-width:1100px;margin:0 auto;padding:40px 40px 28px;display:grid;grid-template-columns:3fr 2fr;gap:64px;align-items:center}
  .hero-tag{display:inline-flex;align-items:center;gap:6px;background:rgba(29,111,232,0.08);border:1px solid rgba(29,111,232,0.18);color:var(--blue);font-size:11px;font-weight:700;padding:5px 12px;border-radius:999px;margin-bottom:16px}
  .hero-h1{font-size:2.45rem;font-weight:700;line-height:1.14;letter-spacing:-.03em;color:var(--navy);margin-bottom:14px}
  .hero-h1 em{color:var(--blue);font-style:normal}
  .hero-desc{font-size:15px;color:var(--muted2);line-height:1.6;max-width:460px;margin-bottom:22px}
  .feat-list{display:flex;flex-direction:column;gap:9px;margin-bottom:24px}
  .feat-item{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--navy3)}
  .feat-icon{width:24px;height:24px;border-radius:8px;background:rgba(29,111,232,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .stats-row{display:flex;gap:12px}
  .stat-block{flex:1;padding:14px 16px;background:rgba(255,255,255,0.72);border:1px solid var(--border);border-radius:16px;backdrop-filter:blur(8px)}
  .stat-n{font-size:24px;font-weight:700;color:var(--blue);letter-spacing:-.03em;margin:4px 0 2px}
  .stat-label{font-size:12px;font-weight:700;color:var(--navy2)}
  .stat-sub{font-size:10px;color:var(--muted);margin-top:1px;line-height:1.4}
  .upload-zone{border-radius:28px;padding:40px 32px;text-align:center;cursor:pointer;transition:all .2s;border:2px dashed rgba(29,111,232,0.3);background:rgba(255,255,255,0.82);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 8px 40px rgba(30,80,200,0.1)}
  .upload-zone:hover{border-color:var(--blue);background:rgba(235,244,255,0.6)}
  .upload-zone.drag{border-color:var(--blue);background:rgba(235,244,255,0.7);transform:scale(1.012);box-shadow:0 0 0 6px rgba(29,111,232,0.08),0 12px 40px rgba(29,111,232,0.12)}
  .upload-icon{width:64px;height:64px;margin:0 auto 16px;border-radius:18px;background:linear-gradient(135deg,rgba(29,111,232,0.1),rgba(6,182,212,0.1));display:flex;align-items:center;justify-content:center}
  .upload-title{font-size:16px;font-weight:600;color:var(--navy);margin-bottom:6px}
  .upload-sub{font-size:13px;color:var(--muted);margin-bottom:20px}
  .btn-primary{display:inline-flex;align-items:center;gap:8px;padding:10px 24px;border-radius:12px;background:linear-gradient(135deg,var(--blue),var(--cyan));color:#fff;font-size:13px;font-weight:600;border:none;cursor:pointer;box-shadow:0 4px 14px rgba(29,111,232,0.3);transition:all .15s;font-family:inherit}
  .btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(29,111,232,0.35)}
  .upload-privacy{font-size:11px;color:#BDD0EE;margin-top:12px}
  .upload-err{background:rgba(254,242,242,0.95);border:1px solid #FECACA;border-radius:14px;padding:12px 14px;margin-bottom:14px;backdrop-filter:blur(8px)}
  .upload-err-row{display:flex;align-items:center;gap:8px}
  .upload-err-title{font-size:13px;font-weight:700;color:#B91C1C;flex:1}
  .upload-err-x{width:22px;height:22px;border-radius:6px;border:none;background:rgba(254,202,202,0.5);cursor:pointer;display:flex;align-items:center;justify-content:center}
  .upload-err-msg{font-size:12px;color:#7F1D1D;line-height:1.5;margin-top:6px}
  .fmt-row{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px;margin-top:16px}
  .fmt-lbl{font-size:11px;color:#94A3B8;margin-right:2px}
  .fmt-chip{font-size:10px;font-weight:700;padding:3px 9px;border-radius:999px}
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
  .logo-bar{display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;gap:24px 44px;max-width:1080px;margin:8px auto 0;padding:20px 18px 14px;border-top:1px solid rgba(200,220,255,0.5)}
  .logo-bar.compact{margin-top:22px;padding-top:20px;gap:24px 40px}
  .logo-group{display:flex;flex-direction:column;align-items:center;gap:13px}
  .logo-group-lbl{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--navy2);white-space:nowrap}
  .logo-group-imgs{display:flex;align-items:center;gap:20px}
  .logo-slot{position:relative;height:56px;min-width:84px;display:flex;align-items:center;justify-content:center}
  .logo-bar.compact .logo-slot{height:50px;min-width:76px}
  .partner-logo{max-height:100%;max-width:150px;object-fit:contain;position:relative;z-index:1}
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
  .patient-avatar{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#DBEAFE,#BFDBFE);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--blue)}
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
  .sidebar{width:144px;flex-shrink:0;position:sticky;top:108px;align-self:flex-start;max-height:calc(100vh - 124px);overflow-y:auto}
  .sidebar-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin-bottom:8px;padding-left:10px}
  .sidebar-item{display:flex;align-items:center;gap:7px;padding:7px 10px;border-radius:10px;font-size:11px;font-weight:500;color:var(--muted2);cursor:pointer;transition:all .15s;border:1px solid transparent;margin-bottom:3px;background:none;width:100%;text-align:left;font-family:inherit}
  .sidebar-item:hover{background:rgba(255,255,255,0.7);color:var(--navy2);border-color:var(--border)}
  .sidebar-item.active{background:rgba(255,255,255,0.9);color:var(--blue);border-color:rgba(29,111,232,0.2);font-weight:600}

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
  .echo-tbl{width:100%;border-collapse:collapse;font-size:12px;min-width:560px}
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
  .summary-phase-title{font-size:12px;font-weight:700;letter-spacing:.3px;text-transform:uppercase}
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
  .fc-avatar{width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center}
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
  .bot-avatar{width:28px;height:28px;border-radius:10px;background:linear-gradient(135deg,var(--blue),var(--cyan));display:flex;align-items:center;justify-content:center;flex-shrink:0}
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
          <stop stopColor="#1A56DB"/><stop offset="0.55" stopColor="#1D6FE8"/><stop offset="1" stopColor="#06B6D4"/>
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx={radius} fill={`url(#${id}g)`}/>
      <rect x="0.6" y="0.6" width="38.8" height="38.8" rx={radius-0.6} fill="none" stroke="#fff" strokeOpacity="0.18"/>
      {/* Pulse line (the 'Flow') */}
      <path d="M6 21 H13 L16 13 L20.5 27.5 L24 19 L26.5 21 H34"
        stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Dot nhịp đập */}
      <circle cx="20.5" cy="27.5" r="1.7" fill="#fff"/>
      <circle cx="34" cy="21" r="1.6" fill="#7FE7F5"/>
    </svg>
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
const BRAND_TO_GENERIC = {
  "vincerol":"acenocoumarol", "sintrom":"acenocoumarol", "coumadin":"warfarin",
  "medoxasol":"levofloxacin", "tavanic":"levofloxacin", "ciprobay":"ciprofloxacin",
  "forxiga":"dapagliflozin", "jardiance":"empagliflozin",
  "agifuros":"furosemid", "lasix":"furosemid", "takizd":"furosemid",
  "buflan":"cefoperazone", "pantoloc":"pantoprazole", "nexium":"esomeprazole",
  "betaloc zok":"metoprolol", "concor":"bisoprolol", "lipitor":"atorvastatin",
  "glucophage":"metformin", "aldactone":"spironolactone", "cordarone":"amiodarone",
}

// Hoạt chất -> nhóm dược lý (để tra tương tác theo nhóm)
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
  "cefoperazone":{ ten:"Cefoperazone", nhom:["cephalosporin"] },
  "metformin":{ ten:"Metformin", nhom:["biguanid"] },
  "spironolactone":{ ten:"Spironolacton", nhom:["loi_tieu_giu_kali"] },
  "metoprolol":{ ten:"Metoprolol", nhom:["chen_beta"] },
  "bisoprolol":{ ten:"Bisoprolol", nhom:["chen_beta"] },
  "atorvastatin":{ ten:"Atorvastatin", nhom:["statin"] },
  "amiodarone":{ ten:"Amiodarone", nhom:["chong_loan_nhip"] },
}

// Bảng tương tác theo nhóm dược lý (MVP: các cặp phổ biến + cặp có trong ca demo)
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
  { a:"loi_tieu_giu_kali", b:"acei", muc:"warning",
    hau_qua:"Tăng kali máu, nguy cơ rối loạn nhịp.", de_xuat:"Theo dõi kali máu và chức năng thận.",
    nguon:"Tương tác ACEI-lợi tiểu giữ kali" },
  { a:"statin", b:"macrolid", muc:"warning",
    hau_qua:"Tăng nồng độ statin, nguy cơ đau cơ và tiêu cơ vân.", de_xuat:"Tạm ngừng statin trong đợt kháng sinh.",
    nguon:"Tương tác statin-macrolid" },
  { a:"chen_beta", b:"chong_loan_nhip", muc:"warning",
    hau_qua:"Cộng gộp ức chế tim, nguy cơ nhịp chậm, block nhĩ thất.", de_xuat:"Theo dõi nhịp tim, ECG.",
    nguon:"Tương tác chẹn beta-chống loạn nhịp" },
]

// Luật chỉnh liều theo chức năng thận (eGFR)
const RENAL_RULES = [
  { generic:"metformin", egfr_lt:30, muc:"critical",
    note:"Chống chỉ định khi eGFR dưới 30 do nguy cơ nhiễm toan lactic.", nguon:"ADA 2025 / KDIGO" },
  { generic:"dapagliflozin", egfr_lt:25, muc:"warning",
    note:"Không khởi trị khi eGFR dưới 25.", nguon:"ESC / ADA 2025" },
  { generic:"levofloxacin", egfr_lt:50, muc:"warning",
    note:"Cần chỉnh liều khi độ thanh thải creatinin dưới 50 mL/phút.", nguon:"Hướng dẫn kê đơn fluoroquinolon" },
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

// Kiểm tra an toàn đơn thuốc: tương tác + chỉnh liều thận + thuốc phù hợp
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
  return { resolved, interactions, renalFlags, favorable }
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
function triggerPrint(r) {
  const p = r.thong_tin_benh_nhan
  const win = window.open("", "_blank", "width=900,height=700")
  win.document.write(`<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>Báo cáo: ${p.ho_ten}</title>
<style>body{font-family:'Times New Roman',serif;color:#000;font-size:11pt;line-height:1.55;background:#fff;margin:0}.page{padding:18mm 16mm;max-width:210mm;margin:0 auto}h1{font-size:13pt;text-transform:uppercase;margin:0 0 2pt}h2{font-size:10pt;font-weight:700;text-transform:uppercase;border-bottom:1.5px solid #000;padding-bottom:3pt;margin:14pt 0 7pt}.hdr{border-bottom:2.5px solid #000;padding-bottom:10pt;margin-bottom:8pt;display:flex;justify-content:space-between}.hdr-r{text-align:right;font-size:9pt;color:#444}.sub{font-size:9pt;color:#444;margin:2pt 0}.row{display:flex;gap:6pt;font-size:10pt;margin:3pt 0}.lbl{color:#555;min-width:110pt}table{width:100%;border-collapse:collapse;font-size:10pt;margin:6pt 0 12pt}th{background:#eee;font-weight:700;text-align:left;padding:4pt 7pt;border:1px solid #aaa;font-size:9pt;text-transform:uppercase}td{padding:4pt 7pt;border:1px solid #ccc;vertical-align:top}tr:nth-child(even) td{background:#f9f9f9}.alert{border:1.5px solid #000;border-left:4px solid #000;padding:6pt 10pt;margin:5pt 0}.al{font-size:9pt;font-weight:700;text-transform:uppercase;margin-bottom:2pt}.as{font-size:9pt;color:#555}.footer{border-top:1px solid #999;margin-top:20pt;padding-top:7pt;font-size:8pt;color:#666;display:flex;justify-content:space-between}.stamp{border:1.5px solid #999;width:100pt;height:60pt;display:inline-block;margin-top:8pt;text-align:center;font-size:8pt;padding:5pt;color:#999}@media print{@page{size:A4;margin:18mm 16mm}}</style>
</head><body><div class="page">
<div class="hdr"><div><div style="font-size:9pt;text-transform:uppercase;letter-spacing:.1em;color:#555;margin-bottom:4pt">MediFlow AI: Báo cáo lâm sàng tự động</div><h1>${p.ho_ten}</h1><div class="sub">Số bệnh án: ${p.so_benh_an} | ${p.tuoi} tuổi, ${p.gioi_tinh} | ${p.dia_chi}</div><div class="sub">Ngày sinh: ${p.ngay_sinh} | Vào viện: ${p.ngay_vao_vien} | Ra viện: ${p.ngay_ra_vien}</div></div><div class="hdr-r">In ngày: ${new Date().toLocaleDateString("vi-VN")}<br>MediFlow AI v1.2<br><span style="color:#c00;font-weight:700">Cần bác sĩ xác nhận</span></div></div>
<h2>I. Chẩn đoán</h2><div class="row"><span class="lbl">Chẩn đoán chính:</span><span>${r.chan_doan_chinh}</span></div><div class="row"><span class="lbl">Lý do nhập viện:</span><span>${r.ly_do_vao_vien}</span></div><div class="row"><span class="lbl">Tiền sử:</span><span>${r.tien_su_benh}</span></div>
<h2>II. Phẫu thuật</h2><table><tr><th>Ngày</th><th>Phương pháp</th><th>Kết quả</th></tr><tr><td>${r.phau_thuat.ngay}</td><td>${r.phau_thuat.phuong_phap}</td><td>${r.phau_thuat.ket_qua}</td></tr></table><div class="row"><span class="lbl">Phẫu thuật viên:</span><span>${r.phau_thuat.bac_si_phau_thuat}</span></div>
<h2>III. Xét nghiệm</h2><table><tr><th>Chỉ số</th><th>Kết quả</th><th>BT</th><th>Đánh giá</th></tr>${(r.xet_nghiem_key||r.xet_nghiem_meta||[]).map(m=>`<tr><td>${m.key} (${m.desc})</td><td>${m.val}</td><td>${m.normal}</td><td>${m.status==="high"?"Cao":m.status==="low"?"Thấp":"BT"}</td></tr>`).join("")}</table>
<h2>IV. Diễn biến</h2><table><tr><th style="width:80pt">Ngày</th><th style="width:70pt">Loại</th><th>Mô tả</th></tr>${r.dien_bien_lam_sang.map(ev=>`<tr><td>${ev.ngay}</td><td>${ev.loai==="canh_bao"?"Cảnh báo":ev.loai==="bat_thuong"?"Bất thường":"BT"}</td><td>${ev.mo_ta}</td></tr>`).join("")}</table>
<h2>V. Siêu âm tim (${(r.sieu_am_tim?.lan_kham||[]).length} lượt)</h2><table><tr><th>Ngày</th><th>EF</th><th>Chênh áp</th><th>Kết luận</th></tr>${(r.sieu_am_tim?.lan_kham||[]).map(s=>`<tr><td>${s.ngay}${s.latest?" (gần nhất)":""}</td><td>${s.ef!=null?s.ef+"%":"-"}</td><td>${s.grad_max!=null?s.grad_max+(s.grad_tb!=null?"/"+s.grad_tb:"")+" mmHg":"-"}</td><td>${s.ghi_chu||s.chan_doan||""}</td></tr>`).join("")}</table>
<h2>VI. Thuốc</h2><table><tr><th>Tên thuốc</th><th>Nhóm</th><th>Liều</th><th>Cách dùng</th></tr>${r.thuoc_cuoi_ky.map(t=>`<tr><td>${t.ten_thuoc}</td><td>${t.nhom}</td><td>${t.lieu}</td><td>${t.cach_dung}</td></tr>`).join("")}</table>
<h2>VII. Cảnh báo</h2>${r.canh_bao_nguy_co.map(c=>`<div class="alert"><div class="al">[${c.muc_do==="cao"?"ƯU TIÊN CAO":c.muc_do==="trung_binh"?"Trung bình":"Theo dõi"}] ${c.mo_ta}</div><div class="as">Căn cứ: ${c.can_cu}</div></div>`).join("")}
${(()=>{const{findings,egfr,ctx}=runPriorityScreens(r);const s=checkDrugSafety(r.thuoc_cuoi_ky,egfr,ctx);const act=findings.filter(f=>f.muc!=="stable").sort((a,b)=>TIER_ORDER[a.muc]-TIER_ORDER[b.muc]);let h="<h2>VIII. Phân tầng ưu tiên lâm sàng</h2>";h+=act.map(f=>`<div class="alert"><div class="al">[${TIER_META[f.muc].label}] ${f.ten}</div><div class="as">${f.ly_do} — Nguồn: ${f.nguon}</div></div>`).join("")||"<p>Không có cảnh báo cần xử trí ngay.</p>";h+=`<h2>IX. Kiểm tra an toàn đơn thuốc</h2><p>Chức năng thận: eGFR ${egfr} mL/phút/1.73m2 (CKD-EPI 2021).</p>`;if(s.interactions.length)h+="<table><tr><th>Cặp thuốc</th><th>Mức</th><th>Hậu quả</th><th>Đề xuất</th></tr>"+s.interactions.map(it=>`<tr><td>${it.thuoc_a} + ${it.thuoc_b}</td><td>${TIER_META[it.muc].label}</td><td>${it.hau_qua}</td><td>${it.de_xuat}</td></tr>`).join("")+"</table>";if(s.favorable.length)h+="<p>Phù hợp khuyến cáo: "+s.favorable.map(f=>`${f.thuoc} (${f.nguon})`).join("; ")+"</p>";return h})()}
<h2>X. Tóm tắt</h2><p>${r.tom_tat_toan_canh}</p>
<div style="display:flex;justify-content:space-between;margin-top:24pt"><div><div class="stamp">Xác nhận bác sĩ phụ trách</div></div><div><div class="stamp">Ký tên bác sĩ</div></div></div>
<div class="footer"><span>Báo cáo tạo tự động bởi MediFlow AI v1.2. Cần bác sĩ xem xét trước khi dùng cho mục đích lâm sàng.</span><span>HackAIthon 2026</span></div>
</div><script>window.onload=function(){window.print()}<\/script></body></html>`)
  win.document.close()
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────
function StatusBadge({ level }) {
  const map = { cao:["cao","Ưu tiên cao"], trung_binh:["medio","Trung bình"], thap:["low","Theo dõi"] }
  const [cls, label] = map[level] || map.thap
  return <span className={`badge ${cls}`}><span className="badge-dot" />{label}</span>
}

function Card({ id, title, icon, children, headRight, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  return (
    <div id={id} className={`card${collapsed ? " collapsed" : ""}`}>
      <div className="card-head">
        <span style={{ color:"#1D6FE8" }}>{icon}</span>
        <span className="card-head-title">{title}</span>
        <div className="card-head-right">
          {headRight}
          <button className="collapse-btn" onClick={() => setCollapsed(c => !c)} title={collapsed ? "Mở rộng" : "Thu gọn"}>
            {collapsed ? <Icon.ChevDown d={12} /> : <Icon.ChevUp d={12} />}
          </button>
        </div>
      </div>
      <div className="card-body">{children}</div>
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

  // EF trục trái 30-80, chênh áp trục phải 0-80
  const EF_MIN = 30, EF_MAX = 80, GR_MAX = 80
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
        {[30,40,50,60,70,80].map(v => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={efY(v)} y2={efY(v)} stroke="rgba(200,220,255,0.25)" strokeWidth="1" />
            {mode!=="grad" && <text x={PAD.l - 5} y={efY(v)} textAnchor="end" fontSize="8" fill="#1D6FE8" dominantBaseline="middle">{v}</text>}
          </g>
        ))}
        {/* Nhãn trục phải chênh áp */}
        {mode!=="ef" && [0,20,40,60,80].map(v => (
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
                  <td style={{ whiteSpace:"nowrap" }}>{s.hoc||"-"}</td>
                  <td style={{ fontSize:11, color:s.canh_bao?"#B91C1C":"#5A7BB8" }}>
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

function UploadPage({ onUpload, isLoading, error, onDismissError }) {
  const [dragging, setDragging] = useState(false)
  const [staged, setStaged] = useState([])
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
          <div><span className="logo-text">Medi<em>Flow</em></span> <span className="logo-sub">AI</span></div>
        </div>
        <div className="status-pill"><span className="status-dot" />Hệ thống hoạt động</div>
      </nav>
      <div className="hero-wrap">
        <div>
          <div className="hero-tag"><Icon.Heart d={12} color="#1D6FE8" />HackAIthon 2026, Bảng B Challenger, Đề tài 5: Y tế</div>
          <h1 className="hero-h1">Hồ sơ bệnh nhân<br /><em>phân tích trong 30 giây.</em></h1>
          <p className="hero-desc">Bác sĩ upload PDF xuất từ HIS. AI đọc toàn bộ hồ sơ, tổng hợp báo cáo có cấu trúc, phát hiện cảnh báo nguy cơ và sẵn sàng trả lời mọi câu hỏi lâm sàng.</p>
          <div className="feat-list">
            {[[<Icon.FileText d={14}/>,"Trích xuất văn bản tự động từ PDF hồ sơ HIS"],[<Icon.Pulse d={14}/>,"Tóm tắt diễn biến lâm sàng theo dòng thời gian"],[<Icon.Alert d={14}/>,"Phát hiện cảnh báo nguy cơ dựa trên hồ sơ"],[<Icon.Chat d={14}/>,"Chatbot hỏi đáp về bệnh nhân cụ thể"]].map(([ic,text],i)=>(
              <div key={i} className="feat-item"><span className="feat-icon" style={{color:"#1D6FE8"}}>{ic}</span>{text}</div>
            ))}
          </div>
          <div className="stats-row">
            {[["80%","Tiết kiệm","Thời gian đọc và phân tích hồ sơ",<Icon.Clock d={14} color="#1D6FE8"/>],["100%","Cảnh báo","Rủi ro lâm sàng và tương tác thuốc",<Icon.Shield d={14} color="#1D6FE8"/>],["1-click","Truy xuất","Minh bạch nguồn gốc dữ liệu",<Icon.Search d={14} color="#1D6FE8"/>]].map(([n,label,sub,ic])=>(
              <div key={label} className="stat-block">
                <div style={{display:"flex",alignItems:"center",gap:6}}>{ic}<div className="stat-n">{n}</div></div>
                <div className="stat-label">{label}</div>
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
            </div>
          )}
          {isLoading ? (
            <div className="upload-zone">
              <div style={{padding:"24px 0"}}>
                <div className="loading-spin"/>
                <p style={{fontSize:15,fontWeight:600,color:"#0A1628",marginBottom:4}}>Đang phân tích hồ sơ...</p>
                <p style={{fontSize:12,color:"#7A96C8"}}>AI đang đọc và tổng hợp dữ liệu</p>
                <div className="load-steps">
                  {["Trích xuất","Rule Engine","Diễn đạt"].map((s,i)=>(
                    <span key={i} style={{display:"flex",alignItems:"center",gap:6}}>
                      <span className="load-step">{s}</span>{i<2&&<span className="load-arr">▶</span>}
                    </span>
                  ))}
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
                <p className="upload-sub">Thêm PDF, ảnh, Word, Excel, PowerPoint</p>
                <button className="btn-primary" onClick={e=>{e.stopPropagation();inputRef.current.click()}}><Icon.Upload d={15} color="white"/>Chọn tài liệu</button>
                <div className="fmt-row">
                  <span className="fmt-lbl">Định dạng hỗ trợ:</span>
                  {["PDF","DOC","XLS","PPT","PNG","JPG"].map(t=>{
                    const k = FILE_KINDS[t.toLowerCase()] || kindOf("x."+t.toLowerCase())
                    return <span key={t} className="fmt-chip" style={{color:k.color,background:k.bg}}>{t}</span>
                  })}
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
          {!isLoading&&staged.length===0&&<div style={{textAlign:"center"}}><span className="demo-link" onClick={()=>onUpload(null)}>Xem demo: hồ sơ Nguyễn Văn A <span style={{fontSize:10}}>▶</span></span></div>}
        </div>
      </div>
      <LogoBar/>
    </div>
  )
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
const NAV_GROUPS = [
  { group:"Tổng quan", items:[
    {id:"sec-status",   label:"Bệnh nhân",          icon:<Icon.Stethoscope d={11}/>},
    {id:"sec-takeaway", label:"Kết luận nhanh",     icon:<Icon.ShieldCheck d={11}/>},
    {id:"sec-problems", label:"Trạng thái vấn đề",  icon:<Icon.Octagon d={11}/>},
    {id:"sec-actions",  label:"Hành động ưu tiên",  icon:<Icon.Layers d={11}/>},
  ]},
  { group:"3 giai đoạn", items:[
    {id:"sec-phase1", label:"Giai đoạn 1: Tiền phẫu", icon:<Icon.Dot color="#8B5CF6"/>},
    {id:"sec-phase2", label:"Giai đoạn 2: Hậu phẫu",  icon:<Icon.Dot color="#EF4444"/>},
    {id:"sec-phase3", label:"Giai đoạn 3: Ngoại trú", icon:<Icon.Dot color="#10B981"/>},
  ]},
  { group:"Phân tích", items:[
    {id:"sec-echo",      label:"Biểu đồ siêu âm", icon:<Icon.Ultrasound d={11}/>},
    {id:"sec-reasoning", label:"Lý luận lâm sàng",     icon:<Icon.Brain d={11}/>},
    {id:"sec-labs",      label:"Xét nghiệm",     icon:<Icon.Flask d={11}/>},
    {id:"sec-meds",      label:"Thuốc",          icon:<Icon.Pill d={11}/>},
    {id:"sec-drug",      label:"eGFR & An toàn thuốc", icon:<Icon.ShieldCheck d={11}/>},
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
function ReportPage({ report, hoSoText, analysis, onReset, chatMessages, setChatMessages }) {
  const [tab, setTab] = useState("report")
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
      setActiveSection(prev => prev === current ? prev : current)
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive:true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [tab])

  // Keyboard shortcut Ctrl+K to focus chat
  useEffect(() => {
    const handler = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault()
        setTab("chat")
        setTimeout(() => document.getElementById("chat-input-field")?.focus(), 100)
      }
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
              <span className="logo-text" style={{fontSize:14}}>Medi<em>Flow</em></span>
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
            <div className="tab-group">
              {[["report",<Icon.FileText d={13}/>,"Báo cáo"],["chat",<Icon.Chat d={13}/>,"Chatbot"]].map(([key,ic,label])=>(
                <button key={key} className={`tab-btn${tab===key?" active":""}`} onClick={()=>setTab(key)}>{ic} {label}</button>
              ))}
            </div>
            <button className="btn-action btn-print" onClick={()=>triggerPrint(report)}><Icon.Print d={13} color="#1D6FE8"/>Xuất báo cáo</button>
            <button className="btn-action btn-back" onClick={onReset}><Icon.Back d={12} color="#7A96C8"/>Báo cáo mới</button>
          </div>
        </div>
      </header>

      {/* Patient chip bar */}
      <div className="chip-bar">
        <div className="chip-bar-inner">
          <span className="chip-lbl">Nhắc nhở nhanh:</span>
          {chips.map(c=><span key={c.label} className={`chip-tag ${c.cls}`}>{c.label}</span>)}
        </div>
      </div>

      {tab === "report" ? (
        <div className="report-outer">
          <SidebarMinimap activeId={activeSection} onNavigate={navigateTo}/>
          <div className="report-main"><ReportTab report={report} analysis={analysis}/></div>
        </div>
      ) : (
        <div className="chat-page">
          <ChatTab report={report} hoSoText={hoSoText} messages={chatMessages} setMessages={setChatMessages}/>
        </div>
      )}
      {tab === "report" && (
        <FloatingChat report={report} hoSoText={hoSoText} messages={chatMessages} setMessages={setChatMessages}
          onExpand={()=>setTab("chat")}/>
      )}
      <ScrollToTop/>
    </div>
  )
}

// ─── REPORT TAB ───────────────────────────────────────────────────────────────
// ─── TRAJECTORY (đánh giá tiến triển tổng thể) ─────────────────────────────────
function TrajectoryCard({ assessment }) {
  const [collapsed, setCollapsed] = useState(false)
  const { verdict, evidence } = assessment
  const tm = TRAJECTORY_META[verdict]
  const TrendIcon = () => tm.icon === "up"
    ? <Svg d={20} color="#fff"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></Svg>
    : tm.icon === "down"
    ? <Svg d={20} color="#fff"><polyline points="3 7 9 13 13 9 21 17"/><polyline points="15 17 21 17 21 11"/></Svg>
    : <Svg d={20} color="#fff"><line x1="4" y1="12" x2="20" y2="12"/><polyline points="16 8 20 12 16 16"/></Svg>
  return (
    <div id="sec-trajectory" className="traj-card" style={{ background:tm.bg, borderColor:tm.border }}>
      <div className="traj-head">
        <div className="traj-badge" style={{ background:tm.color }}><TrendIcon/></div>
        <div>
          <div className="traj-lbl">Đánh giá tiến triển</div>
          <div className="traj-verdict" style={{ color:tm.color }}>{tm.label}</div>
        </div>
        <button className="banner-collapse dark" onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Mở":"Thu gọn"} style={{ marginLeft:"auto" }}>
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
  const [collapsed, setCollapsed] = useState(false)
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
  const [collapsed, setCollapsed] = useState(false)
  const toBullets = (body) => body.split(/(?<=\.)\s+/).map(s=>s.replace(/\.$/,"").trim()).filter(Boolean)
  // Tách theo marker "GIAI ĐOẠN ...:"
  const re = /GIAI ĐO[AẠ]N[^:]*:/gi
  const markers = [...text.matchAll(re)]
  let blocks = []
  if (markers.length) {
    markers.forEach((m, i) => {
      const start = m.index + m[0].length
      const end = i+1 < markers.length ? markers[i+1].index : text.length
      const rawTitle = m[0].replace(/:$/,"").replace(/GIAI ĐO[AẠ]N/i,"").trim()
      blocks.push({ phase: i+1, title: rawTitle, items: toBullets(text.slice(start, end)) })
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
            {toBullets(text).map((s,i)=><li key={i}>{expandAbbr(s)}</li>)}
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
  const [collapsed, setCollapsed] = useState(false)
  const m = PHASE_SECTION_META[phase]
  const fmt = (d) => d ? `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}` : ""
  let rangeTxt = ""
  if (phase === 1 && info.surg) rangeTxt = `Trước ${fmt(info.surg)}`
  else if (phase === 2 && info.surg) rangeTxt = `${fmt(info.surg)} - ${fmt(info.discharge)} (${info.discharge&&info.surg?Math.round((info.discharge-info.surg)/86400000):"-"} ngày)`
  else if (phase === 3 && info.discharge) rangeTxt = `Từ ${fmt(info.discharge)} đến nay (${info.daysPostDischarge} ngày)`

  // Tách mô tả dài thành bullet
  const toBullets = (txt) => String(txt).split(/(?<=\.)\s+/).map(s=>s.trim().replace(/\.$/,"")).filter(Boolean)

  return (
    <div id={`sec-phase${phase}`} className="phase-sec" style={{ borderColor:m.border }}>
      <div className="phase-sec-head">
        <span className="phase-sec-tag" style={{ background:m.color }}><i/>{m.name}</span>
        {rangeTxt && <span className="phase-sec-range">{rangeTxt}</span>}
        <button className="banner-collapse dark" onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Mở":"Thu gọn"} style={{ marginLeft:"auto" }}>
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
function ProblemStatus({ data }) {
  const [collapsed, setCollapsed] = useState(false)
  if (!data) return null
  return (
    <div id="sec-problems" className="ov-card">
      <div className="ov-head">
        <Icon.Octagon d={16} color="#1D6FE8"/><span>Trạng thái vấn đề lâm sàng</span>
        <button className="banner-collapse dark" onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Mở":"Thu gọn"} style={{ marginLeft:"auto" }}>
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

function ClinicalTakeaway({ items }) {
  const [collapsed, setCollapsed] = useState(false)
  if (!items || !items.length) return null
  return (
    <div id="sec-takeaway" className="takeaway-card">
      <div className="takeaway-hd"><Icon.Stethoscope d={15} color="#1D6FE8"/><span>Kết luận lâm sàng nhanh</span>
        <button className="banner-collapse dark" onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Mở":"Thu gọn"} style={{ marginLeft:"auto" }}>
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
  const [collapsed, setCollapsed] = useState(false)
  if (!items || !items.length) return null
  return (
    <div id="sec-actions" className="next-actions">
      <div className="next-hd"><Icon.ShieldCheck d={16} color="#B45309"/><span>Hành động ưu tiên ở lần tái khám tới</span>
        <button className="banner-collapse dark" onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Mở":"Thu gọn"} style={{ marginLeft:"auto" }}>
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
  const bullets = String(item.noi_dung).split(/(?<=\.)\s+/).map(s=>s.trim().replace(/\.$/,"")).filter(Boolean)
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
    <Card id="sec-reasoning" title="Lý luận lâm sàng theo giai đoạn" icon={<Icon.Brain d={16}/>}>
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
function LabPanel({ labs, note }) {
  const [filter, setFilter] = useState("all")
  const counts = { high:0, normal:0, low:0 }
  labs.forEach(m => counts[m.status]++)
  const shown = filter === "all" ? labs : labs.filter(m => m.status === filter)
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
                <span className="lab-key">{m.key}</span>
                <span className={`lab-status ${m.status}`}>{statusTxt}</span>
              </div>
              <div className="lab-val-row">
                <span className="lab-val">{m.val.split(" ")[0]}</span>
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
function PriorityBanner({ findings, onSource }) {
  const [collapsed, setCollapsed] = useState(false)
  const byTier = { critical:[], warning:[], stable:[] }
  findings.forEach(f => byTier[f.muc].push(f))

  return (
    <div id="sec-priority" className="prio-wrap">
      <div className="prio-head">
        <div className="prio-head-l"><Icon.Layers d={17} color="#fff"/><span>Phân tầng ưu tiên lâm sàng</span></div>
        <div className="prio-head-r">
          <div className="prio-counts">
            {["critical","warning","stable"].map(t => (
              <span key={t} className="prio-count" style={{ color:TIER_META[t].color }}>
                <i style={{ background:TIER_META[t].color }}/>{byTier[t].length} {TIER_META[t].label}
              </span>
            ))}
          </div>
          <button className="banner-collapse" onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Mở":"Thu gọn"}>
            {collapsed ? <Icon.ChevDown d={14} color="#fff"/> : <Icon.ChevUp d={14} color="#fff"/>}
          </button>
        </div>
      </div>
      {!collapsed && (
      <div className="prio-board">
        {["critical","warning","stable"].map(tier => {
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
  const { interactions, renalFlags, favorable } = safety
  const total = interactions.length + renalFlags.length
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
              <span className="drug-egfr-num">{egfr}</span>
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
    : <Svg d={18} color="#fff"><line x1="4" y1="12" x2="20" y2="12"/><polyline points="16 8 20 12 16 16"/></Svg>
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

function ReportTab({ report: r, analysis }) {
  const [tlFilter, setTlFilter] = useState("all")
  const [modalSource, setModalSource] = useState(null)
  const [alertsCollapsed, setAlertsCollapsed] = useState(false)
  const alertsHigh = (r.canh_bao_nguy_co || []).filter(c => c.muc_do === "cao")
  const filtered = (r.dien_bien_lam_sang || []).filter(ev => tlFilter === "all" || ev.loai === tlFilter)

  // Nguồn chân lý: rule engine backend (Bước 2) nếu có; nếu không (demo) thì tính client-side.
  let findings, egfr, safety, egfrDetail
  if (analysis) {
    findings = analysis.priority_findings || []
    egfr = analysis.egfr
    egfrDetail = analysis.egfr_detail || null
    const ds = analysis.drug_safety || {}
    safety = { interactions: ds.interactions || [], renalFlags: ds.renal_flags || [], favorable: ds.favorable || [] }
  } else {
    const s = runPriorityScreens(r)
    findings = s.findings; egfr = s.egfr
    safety = checkDrugSafety(r.thuoc_cuoi_ky || [], egfr, s.ctx)
    const creatLab = (r.xet_nghiem_key||r.xet_nghiem_meta||[]).find(l => /creatinin/i.test(l.key))
    egfrDetail = buildEgfrDetail(creatLab?.rawVal, r.thong_tin_benh_nhan?.tuoi, /nam/i.test(r.thong_tin_benh_nhan?.gioi_tinh||""))
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
    donutLegend = [["#22C55E","Đang hoạt động",segActive],["#F59E0B","Cần theo dõi",segMonitor],["#94A3B8","Đã hồi phục",segResolved]]
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

      {/* Banner trạng thái + Kết luận nhanh + Trạng thái vấn đề + Hành động */}
      <div id="sec-status"><ClinicalStatusBanner info={phaseInfo} report={r}/></div>
      {r.clinical_takeaway && <ClinicalTakeaway items={r.clinical_takeaway}/>}

      {r.problem_status && <ProblemStatus data={r.problem_status}/>}
      {r.hanh_dong_uu_tien && r.hanh_dong_uu_tien.length > 0 && <NextActions items={r.hanh_dong_uu_tien}/>}

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

      {/* PHÂN TÍCH: Biểu đồ siêu âm */}
      <Card id="sec-echo" title="Biểu đồ siêu âm tim qua 3 giai đoạn" icon={<Icon.Ultrasound d={16}/>}>
        <EchoTimeline sieu_am={r.sieu_am_tim} info={phaseInfo}/>
        <EchoSessionTable sieu_am={r.sieu_am_tim}/>
      </Card>

      {/* PHÂN TÍCH: Lý luận lâm sàng */}
      <ClinicalReasoning items={reasoningItems}/>

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

      {/* PHÂN TÍCH: eGFR + an toàn đơn thuốc */}
      <DrugSafetyCard safety={safety} egfr={egfr} egfrDetail={egfrDetail} onSource={setModalSource}/>

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
function FloatingChat({ report, hoSoText, messages, setMessages, onExpand }) {
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
        body:JSON.stringify({ question:q, ho_so_text:hoSoText||JSON.stringify(report), chat_history:messages.slice(-6) }) })
      const data = await res.json()
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
        <button className="fab-chat" onClick={()=>setOpen(true)} aria-label="Mở trợ lý">
          <Icon.Chat d={22} color="#fff"/>
          {unread > 0 && <span className="fab-badge">{unread}</span>}
        </button>
      )}
      {open && (
        <div className="fc-panel">
          <div className="fc-head">
            <div className="fc-head-l">
              <div className="fc-avatar"><Icon.Robot d={15} color="#fff"/></div>
              <div>
                <div className="fc-title">Trợ lý MediFlow</div>
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
                {m.role==="assistant"&&<div className="bot-avatar sm"><Icon.Robot d={11} color="white"/></div>}
                <div className={`bubble sm ${m.role==="user"?"user":"bot"}`}>{renderMd(m.content)}</div>
              </div>
            ))}
            {loading&&<div className="msg-row"><div className="bot-avatar sm"><Icon.Robot d={11} color="white"/></div><div className="bubble sm bot"><div className="typing"><span/><span/><span/></div></div></div>}
            <div ref={bottomRef}/>
          </div>
          <div className="fc-sug">
            {["Biến chứng sau mổ?","Thuốc chống đông?","Diễn biến CRP?"].map(s=>(
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

function ChatTab({ report, hoSoText, messages, setMessages }) {
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
        body:JSON.stringify({question:q, ho_so_text:hoSoText||JSON.stringify(report), chat_history:messages.slice(-6)})})
      const data = await res.json()
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
            {m.role==="assistant"&&<div className="bot-avatar"><Icon.Robot d={13} color="white"/></div>}
            <div className={`bubble ${m.role==="user"?"user":"bot"}`}>{renderMd(m.content)}</div>
          </div>
        ))}
        {loading&&<div className="msg-row"><div className="bot-avatar"><Icon.Robot d={13} color="white"/></div><div className="bubble bot"><div className="typing"><span/><span/><span/></div></div></div>}
        <div ref={bottomRef}/>
      </div>
      <div className="chat-suggestions">
        {["Bệnh nhân có biến chứng gì sau mổ?","Đang dùng thuốc chống đông loại nào?","Kết quả siêu âm tim sau mổ?","Diễn biến CRP theo thời gian?"].map(s=>(
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
export default function App() {
  const [state, setState] = useState("upload")
  const [report, setReport] = useState(null)
  const [hoSoText, setHoSoText] = useState("")
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [chatMessages, setChatMessages] = useState([])

  const initChat = useCallback((rpt) => {
    setChatMessages([{role:"assistant", content:`Xin chào! Tôi đã đọc toàn bộ hồ sơ của bệnh nhân **${rpt.thong_tin_benh_nhan?.ho_ten || ""}**. Bác sĩ muốn hỏi gì?`}])
  }, [])

  const handleUpload = async (file) => {
    // Không có file: dùng hồ sơ mẫu (nút "Xem demo")
    if (!file) {
      setReport(MOCK_REPORT); setHoSoText(JSON.stringify(MOCK_REPORT)); setAnalysis(null)
      initChat(MOCK_REPORT); setState("report"); return
    }
    // Upload thật: gọi backend, KHÔNG tự rơi về hồ sơ mẫu khi lỗi
    setLoading(true); setUploadError(null)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 170000)  // 170s: đủ cho hồ sơ dài + Render free khởi động
    try {
      const fd = new FormData(); fd.append("file", file)
      const res = await fetch(`${API_URL}/analyze`, { method:"POST", body:fd, signal:ctrl.signal })
      clearTimeout(timer)
      // Backend quá tải/timeout có thể trả 502/504 không phải JSON -> đọc an toàn
      let data
      try { data = await res.json() }
      catch {
        setUploadError(res.status >= 500
          ? `Máy chủ phân tích gặp lỗi (mã ${res.status}). Hồ sơ có thể quá lớn so với giới hạn bộ nhớ của Render gói miễn phí. Hãy thử file ít trang hơn, hoặc xem log trên Render.`
          : `Phản hồi không hợp lệ từ máy chủ (mã ${res.status}).`)
        setLoading(false); return
      }
      if (!res.ok || !data.success) {
        setUploadError(data.error || `Máy chủ trả lỗi (mã ${res.status}). Hãy thử lại hoặc dùng file ít trang hơn.`)
        setLoading(false); return
      }
      setReport(data.report)
      setHoSoText(data.ho_so_text || JSON.stringify(data.report))
      setAnalysis(data.analysis || null)
      initChat(data.report)
      setLoading(false); setState("report")
    } catch (e) {
      clearTimeout(timer)
      if (e.name === "AbortError") {
        setUploadError("Quá thời gian xử lý. Backend Render gói miễn phí có thể đang khởi động lại (thử lại sau 30 đến 60 giây), hoặc hồ sơ quá nhiều trang. Gợi ý: thử file ít trang hơn trước.")
      } else {
        setUploadError("Không kết nối được máy chủ phân tích. Có thể backend đang khởi động lại (chờ rồi thử lại), hoặc trình duyệt chặn (CORS). Chatbot chạy được nghĩa là khóa API vẫn ổn.")
      }
      setLoading(false)
    }
  }

  return (
    <>
      <style>{CSS}</style>
      {state === "upload" && <UploadPage onUpload={handleUpload} isLoading={loading} error={uploadError} onDismissError={()=>setUploadError(null)}/>}
      {state === "report" && report && (
        <ReportPage report={report} hoSoText={hoSoText} analysis={analysis}
          onReset={()=>{setState("upload");setReport(null);setAnalysis(null);setChatMessages([])}}
          chatMessages={chatMessages} setChatMessages={setChatMessages}/>
      )}
    </>
  )
}
