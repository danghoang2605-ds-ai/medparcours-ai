"""
ecg_engine.py — Số hóa ảnh ECG (Mức 1: trích tín hiệu + vẽ lại)

ĐỊNH VỊ AN TOÀN (bắt buộc đọc trước khi mở rộng file này):
  - Đây là TRỰC QUAN HÓA HỖ TRỢ, KHÔNG phải máy chẩn đoán.
  - File này CHỈ trích xuất đường tín hiệu từ ảnh để vẽ lại rõ hơn cho bác sĩ
    xem — KHÔNG đưa ra bất kỳ kết luận lâm sàng nào (không "AFib", không "nhịp
    chậm", không gì tự gán nhãn bệnh).
  - Mọi output đều phải đi kèm nhãn "cần bác sĩ xác nhận" ở phía hiển thị (FE),
    không phải ở file này.

KIẾN TRÚC 3 MỨC (xem mục 10 file tóm tắt dự án):
  Mức 1 (FILE NÀY): đọc ảnh -> tách lưới -> trích cột pixel -> làm mượt -> signal[]
  Mức 2 (CHƯA LÀM): detect đỉnh R (scipy.signal.find_peaks) -> nhịp tim ước tính
  Mức 3 (CHƯA LÀM, rủi ro cao): cờ "nghi ngờ nhịp không đều, cần xác nhận"

TRẠNG THÁI: chưa có ảnh ECG thật (anh Tấn sẽ gửi mẫu). Để pipeline chạy được
ngay và FE có dữ liệu test, file này có thêm generate_synthetic_ecg() tự vẽ
một ảnh ECG giả (sóng PQRST gần đúng dạng + lưới hồng) bằng OpenCV. Khi có ảnh
thật, CHỈ cần tinh chỉnh các ngưỡng màu/biên độ trong digitize_ecg_image(),
không cần đổi kiến trúc.
"""
from typing import Optional
import base64

import numpy as np
import cv2
from scipy.signal import savgol_filter, find_peaks

# ─── HẰNG SỐ CHUẨN GIẤY ECG (nguồn: "Đọc Điện Tâm Đồ Dễ Hơn" - BS Nguyễn Tôn
# Kinh Thi). Tốc độ giấy 25mm/s là mặc định lâm sàng phổ biến nhất; có thể đổi
# 50mm/s khi cần độ phân giải cao hơn, nhưng KHÔNG tự suy luận được tốc độ
# thật từ ảnh nếu không có ghi chú trên ảnh — mặc định 25mm/s khi không rõ.
PAPER_SPEED_MM_PER_S = 25.0
SMALL_SQUARE_MM = 1.0   # 1 ô nhỏ = 1mm = 0.04s ở tốc độ chuẩn
LARGE_SQUARE_MM = 5.0   # 1 ô lớn = 5mm = 0.20s ở tốc độ chuẩn (5 ô nhỏ)
# Ngưỡng "nhịp xoang đều" theo sách: PP dài nhất - PP ngắn nhất < 0.16s. Đây
# là ngưỡng TUYỆT ĐỐI (giây), không phải %, nên ý nghĩa thay đổi theo nhịp tim
# nền — sách không cho ngưỡng tương đối (CV%) nào. KHÔNG tự suy ra ngưỡng CV%
# vì đó là kiến thức ngoài 2 tài liệu đã đọc, cần Tấn/Ngân xác nhận nếu muốn
# dùng CV% thay vì ngưỡng tuyệt đối này.
RR_IRREGULAR_THRESHOLD_S = 0.16


# ─── THAM SỐ NGƯỠNG (tinh chỉnh khi có ảnh thật) ──────────────────────────────
# Lưới ECG giấy thường có màu hồng/đỏ nhạt. Trong không gian HSV, lưới rơi vào
# khoảng Hue đỏ/hồng với Saturation thấp-trung bình. Đường tín hiệu thường đậm
# (Value thấp, gần đen) bất kể lưới màu gì.
GRID_HUE_RANGES = [(0, 25), (340, 360)]  # đỏ/hồng quanh 2 đầu vòng Hue (độ 0-360)
GRID_SAT_MAX = 140       # lưới nhạt -> saturation không quá cao
SIGNAL_VALUE_MAX = 110   # đường tín hiệu đậm -> Value (độ sáng) thấp
SMOOTH_WINDOW = 9        # cửa sổ Savitzky-Golay (phải là số lẻ)
SMOOTH_POLYORDER = 2

# Ngưỡng phân loại ảnh CÓ MÀU vs GRAYSCALE (đo Saturation trung bình toàn
# ảnh). ĐÃ XÁC NHẬN qua ảnh ECG thật: Saturation = 0.0 tuyệt đối mọi nơi (ảnh
# in/scan đen-trắng), trong khi ảnh tổng hợp tự vẽ (lưới hồng cố ý) có
# Saturation trung bình cao hơn rõ rệt -> ngưỡng nhỏ (5) đủ phân biệt 2 loại.
GRAYSCALE_SAT_THRESHOLD = 5.0
# Tham số cho _extract_signal_grayscale() — ĐÃ TINH CHỈNH qua test với 2 ảnh
# ECG thật (xem docstring hàm đó để biết chi tiết kỹ thuật). Kernel càng lớn
# thì "lấp" được lưới có khoảng cách ô lớn hơn, nhưng cũng dễ làm mất chi
# tiết tín hiệu nhỏ — 13 là điểm cân bằng tìm được qua thử nghiệm thực tế,
# CÓ THỂ cần tinh chỉnh lại khi gặp ảnh có lưới thưa/dày khác biệt rõ.
GRAYSCALE_MORPH_KERNEL = 13
GRAYSCALE_DIFF_THRESHOLD = 20

# Tham số cho estimate_px_per_mm() bản 2 (tìm chu kỳ lưới ô nhỏ ở dải mép
# trên ảnh) — ĐÃ TINH CHỈNH qua test với 2 ảnh ECG thật.
GRID_DETECT_BAND_FRACTION = 0.12  # tỉ lệ chiều cao ảnh dùng làm dải dò lưới
GRID_MIN_PEAK_DISTANCE_PX = 3     # khoảng cách tối thiểu giữa 2 đỉnh lưới (px)
GRID_MIN_PEAKS_REQUIRED = 8       # số đỉnh lưới tối thiểu để tin cậy chu kỳ đo được

# Tham số cho detect_r_peaks() kỹ thuật 2-pass — ĐÃ TINH CHỈNH qua test với 2
# ảnh ECG thật có nhịp tim khác nhau (82bpm và 155bpm).
PASS1_HEIGHT_THRESHOLD = 0.6   # ngưỡng biên độ cao ở lượt thô, chỉ bắt đỉnh rõ nhất
PASS1_MIN_DISTANCE_PX = 8      # khoảng cách tối thiểu rất nhỏ ở lượt thô (an toàn cho nhịp rất nhanh)
PASS2_DISTANCE_RATIO = 0.6     # lượt 2 dùng 60% khoảng cách trung vị ước lượng từ lượt 1
OUTLIER_GAP_RATIO = 1.3        # gap >= 1.3x trung vị mới được coi là khoảng R-R thật (không phải đỉnh phụ)


def generate_synthetic_ecg(width: int = 1200, height: int = 400,
                            heart_rate_bpm: Optional[float] = 75.0,
                            n_beats: Optional[int] = None, noise: float = 0.0,
                            seed: Optional[int] = 42) -> np.ndarray:
    """
    Tự vẽ một ảnh ECG giả (nền trắng, lưới hồng, đường tín hiệu đen) để test
    pipeline số hóa khi CHƯA CÓ ảnh thật từ anh Tấn. Sóng PQRST là xấp xỉ hình
    học đơn giản (không phải mô phỏng sinh lý chính xác) — chỉ đủ để có hình
    dạng "giống ECG" cho việc kiểm tra trích xuất tín hiệu VÀ kiểm tra pipeline
    tính nhịp tim Mức 2 (estimate_px_per_mm + detect_r_peaks + compute_heart_rate).

    heart_rate_bpm: nếu được set (mặc định 75 — nhịp xoang bình thường), số
    nhịp và khoảng cách giữa các nhịp được TÍNH NGƯỢC từ công thức vật lý
    thật (lưới ô lớn 25px=5mm, tốc độ giấy chuẩn 25mm/s) để ảnh test ra ĐÚNG
    nhịp tim này khi chạy qua Mức 2 — dùng cho test hồi quy. Nếu set n_beats
    trực tiếp (không None), heart_rate_bpm bị bỏ qua, dùng cách cũ (số nhịp
    cố định, không khớp nhịp tim thật nào) — chỉ nên dùng cho test Mức 1.

    Trả về ảnh BGR (numpy array) để dùng trực tiếp với cv2 hoặc lưu file.
    """
    rng = np.random.default_rng(seed)
    img = np.full((height, width, 3), 255, dtype=np.uint8)

    if n_beats is None:
        # Tính ngược: bpm -> giây/nhịp -> mm/nhịp (tốc độ 25mm/s) -> px/nhịp
        # (lưới ô lớn 25px=5mm -> 5px/mm) -> số nhịp vừa khít trong width.
        seconds_per_beat = 60.0 / heart_rate_bpm
        mm_per_beat = seconds_per_beat * PAPER_SPEED_MM_PER_S
        px_per_beat = mm_per_beat * 5.0  # 5px/mm vì lưới ô lớn 25px=5mm
        n_beats = max(2, round(width / px_per_beat))

    # Lưới: ô lớn hồng đậm hơn mỗi 25px, ô nhỏ hồng nhạt mỗi 5px
    # LƯU Ý: OpenCV dùng thứ tự màu BGR (không phải RGB). Hồng nhạt thật ~
    # RGB(255,200,220) -> BGR(220,200,255). Viết nhầm thứ tự sẽ ra xanh-tím.
    grid_minor = (220, 200, 255)   # BGR cho hồng nhạt (RGB 255,200,220)
    grid_major = (190, 160, 255)   # BGR cho hồng đậm hơn (RGB 255,160,190)
    for x in range(0, width, 5):
        color = grid_major if x % 25 == 0 else grid_minor
        cv2.line(img, (x, 0), (x, height), color, 1)
    for y in range(0, height, 5):
        color = grid_major if y % 25 == 0 else grid_minor
        cv2.line(img, (0, y), (width, y), color, 1)

    # Đường tín hiệu PQRST xấp xỉ: tổng hợp các "gai" Gauss cho P, Q, R, S, T
    baseline = height // 2
    t = np.linspace(0, width, width)
    signal = np.zeros(width, dtype=np.float64)
    beat_spacing = width / n_beats

    def gauss_bump(center, amp, sigma):
        return amp * np.exp(-((t - center) ** 2) / (2 * sigma ** 2))

    for i in range(n_beats):
        c = beat_spacing * i + beat_spacing * 0.5
        signal += gauss_bump(c - 28, 8, 6)     # P wave (nhỏ, trước QRS)
        signal += gauss_bump(c - 6, -10, 3)    # Q (âm nhỏ)
        signal += gauss_bump(c, 70, 4)         # R (đỉnh cao, nhọn)
        signal += gauss_bump(c + 6, -18, 3)    # S (âm)
        signal += gauss_bump(c + 30, 14, 9)    # T wave (sau QRS, bo tròn)

    if noise > 0:
        signal += rng.normal(0, noise, size=signal.shape)

    y_coords = (baseline - signal).astype(int)
    y_coords = np.clip(y_coords, 5, height - 5)

    pts = np.column_stack([t.astype(int), y_coords])
    for i in range(len(pts) - 1):
        cv2.line(img, tuple(pts[i]), tuple(pts[i + 1]), (20, 20, 20), 2)

    return img


def _hue_in_red_pink_range(hue_deg: np.ndarray) -> np.ndarray:
    """Mask True tại các pixel có Hue rơi vào dải đỏ/hồng (quanh 0 độ và 360 độ)."""
    mask = np.zeros(hue_deg.shape, dtype=bool)
    for lo, hi in GRID_HUE_RANGES:
        mask |= (hue_deg >= lo) & (hue_deg <= hi)
    return mask


def _extract_signal_colored(image_bgr: np.ndarray) -> tuple:
    """
    Trích raw_y[] cho ảnh CÓ MÀU (lưới hồng/đỏ cố ý, vd ảnh tổng hợp test).
    Tách lưới theo Hue đỏ/hồng + Saturation, đường tín hiệu là pixel tối
    KHÔNG thuộc lưới. Đây là cách làm GỐC, dùng khi ảnh không phải grayscale.
    """
    h, w = image_bgr.shape[:2]
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    hue_deg = hsv[:, :, 0].astype(np.float64) * 2.0
    sat = hsv[:, :, 1].astype(np.float64)
    val = hsv[:, :, 2].astype(np.float64)

    is_grid = _hue_in_red_pink_range(hue_deg) & (sat <= GRID_SAT_MAX) & (val >= 120)
    is_dark_signal = (val <= SIGNAL_VALUE_MAX) & (~is_grid)

    raw_y = np.full(w, np.nan)
    for x in range(w):
        ys = np.nonzero(is_dark_signal[:, x])[0]
        if ys.size > 0:
            raw_y[x] = ys.mean()
    return raw_y, int(np.count_nonzero(~np.isnan(raw_y)))


def _extract_signal_grayscale(image_bgr: np.ndarray) -> tuple:
    """
    Trích raw_y[] cho ảnh GRAYSCALE (ảnh ECG in/scan thật — ĐÃ XÁC NHẬN qua
    test với 2 ảnh ECG thật khác nhau, từ 2 bệnh nhân, 2 thời điểm khác nhau).

    KỸ THUẬT: morphological closing để ước lượng "nền cục bộ" (gồm cả lưới +
    vùng sáng quanh đường tín hiệu), rồi TRỪ ảnh gốc khỏi nền đó -> những chỗ
    tối hơn nền rõ rệt (đường bút mảnh) sẽ nổi lên thành giá trị dương cao
    trong "diff", còn lưới (vốn đã được closing "lấp" vào nền do kernel lớn
    hơn khoảng cách giữa các ô lưới) gần như biến mất.

    Sau đó với mỗi cột, lấy vị trí y bằng TRUNG BÌNH CÓ TRỌNG SỐ theo độ lớn
    diff (không phải trung bình đơn giản của mọi pixel vượt ngưỡng) — vì nếu
    còn sót vài pixel lưới yếu trong cùng cột, trọng số thấp của chúng sẽ
    không kéo lệch vị trí trung tâm của đường tín hiệu thật (trọng số cao).

    ĐÃ TEST: hoạt động tốt trên ảnh có lưới nhạt (94% cột, hình dạng rất sạch)
    và ảnh có lưới đậm hơn (66% cột, đỉnh R vẫn đúng vị trí dù baseline còn
    nhiễu nhẹ). CHƯA test trên ảnh nghiêng, mờ, hoặc độ phân giải thấp hơn
    nhiều — các tham số (kernel=13, threshold=20) có thể cần tinh chỉnh thêm
    khi gặp ảnh khác biệt rõ về đặc điểm.
    """
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                        (GRAYSCALE_MORPH_KERNEL, GRAYSCALE_MORPH_KERNEL))
    background = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel)
    diff = cv2.subtract(background, gray).astype(np.float64)

    raw_y = np.full(w, np.nan)
    y_coords = np.arange(h)
    for x in range(w):
        col_diff = diff[:, x]
        if col_diff.max() < GRAYSCALE_DIFF_THRESHOLD:
            continue  # cột này không có gì vượt ngưỡng -> không có tín hiệu
        weights = np.maximum(col_diff - (GRAYSCALE_DIFF_THRESHOLD - 1), 0)
        if weights.sum() > 0:
            raw_y[x] = np.average(y_coords, weights=weights)

    return raw_y, int(np.count_nonzero(~np.isnan(raw_y)))


def digitize_ecg_image(image_bgr: np.ndarray) -> dict:
    """
    MỨC 1: đọc ảnh ECG -> tách lưới -> trích cột pixel tối nhất mỗi cột
    -> làm mượt -> trả signal[] (đã chuẩn hóa 0-1, đảo trục y cho đúng chiều).

    TỰ NHẬN DIỆN 2 LOẠI ẢNH (đã phát hiện qua test với ảnh ECG thật — ảnh
    máy in/scan thường HOÀN TOÀN ĐEN-TRẮNG, Saturation=0 mọi nơi, khác hẳn
    ảnh tổng hợp tự vẽ có lưới màu hồng):
      - Ảnh CÓ MÀU (Saturation trung bình > ngưỡng nhỏ): dùng cách cũ — lọc
        lưới theo Hue đỏ/hồng, đường tín hiệu là pixel tối KHÔNG thuộc lưới.
      - Ảnh GRAYSCALE (Saturation ~0 mọi nơi): không thể phân biệt lưới/tín
        hiệu bằng màu — CHUYỂN sang ngưỡng Value ĐỘNG theo percentile của
        ảnh đó. Đường tín hiệu luôn là phần TỐI NHẤT và HIẾM NHẤT (đã xác
        nhận qua đo thật: chỉ chiếm 1-3% diện tích, giá trị rất thấp so với
        nền+lưới chiếm >90% ở vùng sáng) — percentile thấp (mặc định 2%)
        bắt đúng đường tín hiệu mà không cần biết trước độ đậm cụ thể của
        từng máy scan/in khác nhau.

    Trả về:
      {
        "signal": list[float],       # giá trị tín hiệu theo từng cột x, đã làm mượt
        "width": int, "height": int,
        "columns_with_signal": int,   # số cột tìm được điểm tín hiệu hợp lệ
        "che_do_phat_hien": "mau" | "grayscale",  # cách nhận diện đã dùng
        "warning": str | None,        # cảnh báo nếu chất lượng ảnh kém
      }
    KHÔNG trả bất kỳ kết luận lâm sàng nào — chỉ số liệu hình học thuần.
    """
    if image_bgr is None or image_bgr.size == 0:
        return {"signal": [], "width": 0, "height": 0, "columns_with_signal": 0,
                "che_do_phat_hien": None, "warning": "Ảnh rỗng hoặc không đọc được."}

    h, w = image_bgr.shape[:2]
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1].astype(np.float64)

    is_grayscale = float(np.mean(sat)) <= GRAYSCALE_SAT_THRESHOLD

    if is_grayscale:
        che_do = "grayscale"
        raw_y, columns_found = _extract_signal_grayscale(image_bgr)
    else:
        che_do = "mau"
        raw_y, columns_found = _extract_signal_colored(image_bgr)

    warning = None
    if columns_found < w * 0.5:
        warning = ("Chỉ phát hiện được tín hiệu ở dưới 50% chiều rộng ảnh — "
                    "ảnh có thể bị mờ, nghiêng, hoặc ngưỡng tách tín hiệu chưa "
                    "phù hợp với ảnh này. Cần kiểm tra lại ảnh gốc hoặc tinh chỉnh ngưỡng.")

    # Nội suy tuyến tính cho các cột thiếu (đứt nét), rồi đảo trục y (ảnh: y
    # tăng xuống dưới; tín hiệu: giá trị tăng đi lên) và chuẩn hóa về baseline 0.
    valid_idx = np.nonzero(~np.isnan(raw_y))[0]
    if valid_idx.size >= 2:
        filled_y = np.interp(np.arange(w), valid_idx, raw_y[valid_idx])
    elif valid_idx.size == 1:
        filled_y = np.full(w, raw_y[valid_idx[0]])
    else:
        filled_y = np.zeros(w)
        warning = "Không phát hiện được đường tín hiệu nào trong ảnh."

    inverted = -(filled_y - np.median(filled_y))  # đảo trục + đặt baseline ~0

    win = min(SMOOTH_WINDOW, w - (1 - w % 2))  # đảm bảo lẻ và <= độ dài mảng
    if win >= 5 and win % 2 == 1 and w > win:
        smoothed = savgol_filter(inverted, window_length=win, polyorder=SMOOTH_POLYORDER)
    else:
        smoothed = inverted  # ảnh quá nhỏ để làm mượt, trả nguyên

    # Chuẩn hóa 0-1 để FE vẽ SVG dễ dàng không phụ thuộc độ phân giải ảnh gốc.
    s_min, s_max = float(np.min(smoothed)), float(np.max(smoothed))
    if s_max - s_min > 1e-6:
        normalized = (smoothed - s_min) / (s_max - s_min)
    else:
        normalized = np.zeros_like(smoothed)

    return {
        "signal": [round(float(v), 4) for v in normalized],
        "width": w,
        "height": h,
        "columns_with_signal": columns_found,
        "che_do_phat_hien": che_do,
        "warning": warning,
    }


# ═══════════════════════════════════════════════════════════════════════════
# MỨC 2: Đo R-R + nhịp tim (nguồn công thức/ngưỡng: sách "Đọc Điện Tâm Đồ Dễ
# Hơn" - BS Nguyễn Tôn Kinh Thi)
# ═══════════════════════════════════════════════════════════════════════════
# VẤN ĐỀ CALIBRATION (đã biết từ mục 10 file tóm tắt dự án): để quy đổi
# khoảng cách PIXEL giữa 2 đỉnh R thành THỜI GIAN (giây) rồi ra NHỊP TIM, cần
# biết bao nhiêu pixel = 1mm trên ảnh. Không có thước chuẩn trên ảnh thì
# không thể tính chính xác tuyệt đối — đây là hạn chế vật lý, không phải lỗi
# code. Giải pháp: ước lượng px/mm bằng cách đo khoảng cách giữa các đường
# LƯỚI Ô LỚN liên tiếp (đã biết = 5mm theo sách) — tự động, không cần người
# dùng nhập tay, nhưng vẫn là ƯỚC LƯỢNG (độ chính xác phụ thuộc ảnh có lưới
# rõ ràng, thẳng, không nghiêng).

def estimate_px_per_mm(image_bgr: np.ndarray) -> dict:
    """
    Ước lượng số pixel/mm bằng cách tìm CHU KỲ LƯỚI Ô NHỎ (1mm theo chuẩn
    giấy ECG) trong một dải hẹp ở SÁT MÉP TRÊN ảnh — vùng này thường chỉ có
    lưới, ít chạm vào đường tín hiệu (đường tín hiệu thường nằm giữa/dưới).

    THIẾT KẾ NÀY THAY ĐỔI SO VỚI BẢN ĐẦU (đo lưới Ô LỚN bằng Saturation):
    ĐÃ PHÁT HIỆN qua test với 2 ảnh ECG thật rằng ảnh scan/in thật KHÔNG phân
    biệt được ô lớn/ô nhỏ bằng độ đậm (khác ảnh tổng hợp tự vẽ cố ý 2 màu).
    Thay vào đó, đo CHU KỲ LẶP LẠI của lưới (dùng find_peaks trên độ đậm theo
    cột) — chu kỳ ngắn nhất/phổ biến nhất chính là ô NHỎ (1mm), vì ô nhỏ lặp
    dày đặc và đều hơn ô lớn nên áp đảo số lượng đỉnh tìm được. ĐÃ XÁC NHẬN
    qua đo thật: cả 2 ảnh ECG khác nhau đều cho gap trung vị ~5px — ổn định,
    đáng tin hơn cách cũ (vốn luôn fail trên ảnh grayscale).

    Trả {"px_per_mm": float | None, "do_tin_cay": "cao"|"trung_binh"|"thap",
    "warning": str | None}.
    """
    if image_bgr is None or image_bgr.size == 0:
        return {"px_per_mm": None, "do_tin_cay": "thap", "warning": "Ảnh rỗng."}

    h, w = image_bgr.shape[:2]
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)

    # Dải hẹp sát mép trên — đủ cao để hầu như chắc chắn không chạm đường tín
    # hiệu (đường tín hiệu thường có biên độ đủ lớn để không nằm sát mép),
    # nhưng đủ rộng (vài dòng) để trung bình hóa nhiễu ảnh JPEG.
    band_height = max(3, int(h * GRID_DETECT_BAND_FRACTION))
    band = gray[0:band_height, :].astype(np.float64)
    col_intensity = 255.0 - band.mean(axis=0)  # đảo ngược: lưới đậm hơn nền -> giá trị cao hơn

    if col_intensity.max() - col_intensity.min() < 2.0:
        return {"px_per_mm": None, "do_tin_cay": "thap",
                "warning": "Dải mép trên ảnh quá đồng nhất (không thấy lưới rõ) — "
                           "không ước lượng được tỉ lệ px/mm. Có thể ảnh đã bị cắt "
                           "sát đường tín hiệu, không còn margin chứa lưới sạch."}

    peaks, _ = find_peaks(col_intensity, distance=GRID_MIN_PEAK_DISTANCE_PX)

    if len(peaks) < GRID_MIN_PEAKS_REQUIRED:
        return {"px_per_mm": None, "do_tin_cay": "thap",
                "warning": f"Chỉ tìm được {len(peaks)} đường lưới trong dải mép trên "
                           f"(cần tối thiểu {GRID_MIN_PEAKS_REQUIRED}) — ảnh có thể bị "
                           "nghiêng, mờ, hoặc không có lưới rõ ràng ở vùng này."}

    gaps = np.diff(peaks)
    median_gap_px = float(np.median(gaps))
    px_per_mm = median_gap_px / SMALL_SQUARE_MM  # ô nhỏ = 1mm

    cv = float(np.std(gaps) / np.mean(gaps)) if np.mean(gaps) > 0 else 1.0
    do_tin_cay = "cao" if cv < 0.15 else "trung_binh" if cv < 0.30 else "thap"

    return {
        "px_per_mm": round(px_per_mm, 3),
        "do_tin_cay": do_tin_cay,
        "warning": None if do_tin_cay != "thap" else
                   "Khoảng cách giữa các đường lưới không đồng đều (ảnh có thể "
                   "nghiêng/mờ) — tỉ lệ px/mm chỉ là ước lượng thô, kết quả nhịp tim "
                   "cần xác nhận lại.",
    }


def detect_r_peaks(signal: list, height_threshold: float = 0.5,
                    min_distance_px: Optional[int] = None) -> dict:
    """
    Detect đỉnh R bằng scipy.signal.find_peaks trên signal[] đã chuẩn hóa 0-1
    (output của digitize_ecg_image). KHÔNG tự chẩn đoán gì — chỉ trả vị trí
    đỉnh (theo chỉ số cột pixel) và khoảng cách giữa các đỉnh.

    KỸ THUẬT 2-PASS (đã sửa sau khi phát hiện: khoảng cách tối thiểu CỐ ĐỊNH
    không phù hợp cho cả nhịp chậm và nhịp nhanh — vd ảnh nhịp 155bpm cần
    distance nhỏ ~20px, nhưng ảnh nhịp 82bpm cần distance lớn hơn để không
    bắt nhầm sóng T/nhiễu phụ thành đỉnh R):
      Lượt 1 (thô): distance rất nhỏ (PASS1_MIN_DISTANCE_PX), height cao
        (PASS1_HEIGHT_THRESHOLD) — chỉ bắt được các đỉnh RÕ NHẤT, có thể vẫn
        lẫn vài đỉnh phụ/nhiễu, nhưng đủ để ước lượng khoảng cách trung vị
        giữa các nhịp THẬT.
      Lượt 2 (lọc lại): dùng distance = PASS2_DISTANCE_RATIO × khoảng cách
        trung vị của lượt 1 — đủ lớn để loại các đỉnh phụ gần nhau (nhiễu,
        sóng T cao bất thường) mà không bỏ sót 2 nhịp R thật sự gần nhau.

    Nếu Đăng/người gọi tự truyền min_distance_px cụ thể, BỎ QUA 2-pass và
    dùng đúng giá trị đó (để vẫn có thể ép tham số khi cần debug/test).
    """
    if not signal or len(signal) < 3:
        return {"peaks": [], "rr_intervals_px": [], "warning": "Tín hiệu quá ngắn để tìm đỉnh R."}

    arr = np.array(signal, dtype=np.float64)

    if min_distance_px is not None:
        peaks, _ = find_peaks(arr, height=height_threshold, distance=min_distance_px)
    else:
        # Lượt 1: thô, distance rất nhỏ -> bắt được CẢ đỉnh R thật VÀ một số
        # đỉnh phụ (sóng S/T cao bất thường, răng cưa nhiễu) — không tránh
        # được ở bước này vì chưa biết nhịp tim thật để đặt distance đúng.
        peaks_pass1, _ = find_peaks(arr, height=PASS1_HEIGHT_THRESHOLD,
                                     distance=PASS1_MIN_DISTANCE_PX)
        if len(peaks_pass1) < 2:
            peaks = peaks_pass1
        else:
            gaps_pass1 = np.diff(peaks_pass1).astype(np.float64)
            overall_median = float(np.median(gaps_pass1))
            # Lọc bỏ gap NHỎ HƠN HẲN trung vị chung (đây là khoảng cách giữa
            # 1 đỉnh R thật và 1 đỉnh phụ ngay cạnh nó, không phải khoảng R-R
            # thật) — ĐÃ XÁC NHẬN qua test: gap giữa đỉnh phụ/R thật rõ rệt
            # nhỏ hơn (vd 17-28px) so với gap R-R thật (vd 44-46px) trên ảnh
            # ECG thật, chênh nhau >30%, nên ngưỡng OUTLIER_GAP_RATIO=1.3 tách
            # được 2 nhóm mà không cần biết trước nhịp tim.
            large_gaps = gaps_pass1[gaps_pass1 >= overall_median * OUTLIER_GAP_RATIO]
            if len(large_gaps) >= 2:
                median_gap = float(np.median(large_gaps))
            else:
                median_gap = overall_median  # không tách được rõ -> dùng trung vị thô
            refined_distance = max(PASS1_MIN_DISTANCE_PX, int(median_gap * PASS2_DISTANCE_RATIO))
            peaks, _ = find_peaks(arr, height=height_threshold, distance=refined_distance)

    if len(peaks) < 2:
        return {"peaks": peaks.tolist(), "rr_intervals_px": [],
                "warning": "Tìm được dưới 2 đỉnh R — không đủ để tính khoảng R-R. "
                           "Có thể cần giảm height_threshold hoặc ảnh không rõ tín hiệu."}

    rr_intervals_px = np.diff(peaks).tolist()
    return {"peaks": peaks.tolist(), "rr_intervals_px": rr_intervals_px, "warning": None}


def compute_heart_rate(rr_intervals_px: list, px_per_mm: Optional[float],
                        paper_speed_mm_s: float = PAPER_SPEED_MM_PER_S) -> dict:
    """
    Quy đổi khoảng R-R (pixel) -> giây -> nhịp tim (lần/phút), dùng công thức
    60/RR(giây) — công thức "chính xác nhất" theo sách (so với 2 công thức
    khác dựa vào đếm ô lưới, vốn chỉ là cách làm tay trên giấy thật).

    NẾU px_per_mm là None (không ước lượng được tỉ lệ từ lưới ảnh): trả về
    None cho mọi giá trị bpm, kèm warning rõ — TUYỆT ĐỐI không tự đoán đại
    một tỉ lệ để vẫn ra số, vì số sai sẽ trông giống số đúng và gây hiểu lầm
    lâm sàng nguy hiểm hơn là không có số.

    Khi rr_intervals_px có NHIỀU giá trị khác nhau (nhịp không đều): theo
    sách, dùng "trung bình cộng các khoảng RR" cho công thức tính tần số đại
    diện — sách không cho công thức trung bình cụ thể hơn (vd trung bình
    có trọng số), nên ở đây dùng trung bình cộng đơn giản (mean).
    """
    if not rr_intervals_px:
        return {"bpm_avg": None, "bpm_per_beat": [], "rr_seconds": [],
                "uoc_luong": True, "warning": "Không có khoảng R-R nào để tính nhịp tim."}

    if px_per_mm is None or px_per_mm <= 0:
        return {"bpm_avg": None, "bpm_per_beat": [], "rr_seconds": [],
                "uoc_luong": True,
                "warning": "Không ước lượng được tỉ lệ pixel/mm từ lưới ảnh — "
                           "KHÔNG thể tính nhịp tim chính xác. Cần ảnh có lưới rõ "
                           "hơn, hoặc nhập tay tốc độ giấy/tỉ lệ nếu biết."}

    mm_per_px = 1.0 / px_per_mm
    rr_seconds = [rr_px * mm_per_px / paper_speed_mm_s for rr_px in rr_intervals_px]
    bpm_per_beat = [round(60.0 / s, 1) if s > 0 else None for s in rr_seconds]

    valid_bpms = [b for b in bpm_per_beat if b is not None]
    bpm_avg = round(float(np.mean(valid_bpms)), 1) if valid_bpms else None

    # Ngưỡng "nhịp xoang đều" theo sách (PP dài nhất - PP ngắn nhất < 0.16s) —
    # mượn áp dụng tương tự cho R-R (cùng bản chất khoảng giữa 2 nhịp liên
    # tiếp). Đây là ngưỡng TUYỆT ĐỐI giây, ý nghĩa % sẽ khác nhau tùy nhịp tim
    # nền — sách không cho ngưỡng CV% nào khác để dùng thay.
    rr_range = max(rr_seconds) - min(rr_seconds) if len(rr_seconds) >= 2 else 0.0
    nhip_deu_theo_nguong_sach = rr_range < RR_IRREGULAR_THRESHOLD_S if len(rr_seconds) >= 2 else None

    return {
        "bpm_avg": bpm_avg,
        "bpm_per_beat": bpm_per_beat,
        "rr_seconds": [round(s, 3) for s in rr_seconds],
        "rr_range_seconds": round(rr_range, 3) if len(rr_seconds) >= 2 else None,
        "nhip_deu_theo_nguong_sach": nhip_deu_theo_nguong_sach,
        "nguong_ap_dung": f"Chênh lệch R-R lớn nhất/nhỏ nhất < {RR_IRREGULAR_THRESHOLD_S}s "
                           f"(mượn ngưỡng PP của nhịp xoang đều theo sách lý thuyết — "
                           f"CHƯA xác nhận bởi Tấn/Ngân cho mục đích R-R)",
        "uoc_luong": True,  # LUÔN True - calibration từ lưới ảnh luôn là ước lượng
        "warning": None,
    }


def decode_base64_image(b64_str: str) -> Optional[np.ndarray]:
    """Giải mã ảnh từ base64 (FE gửi lên qua /ecg) thành ảnh BGR cho OpenCV."""
    try:
        if "," in b64_str and b64_str.strip().startswith("data:"):
            b64_str = b64_str.split(",", 1)[1]
        raw = base64.b64decode(b64_str)
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return img
    except Exception:
        return None


def encode_image_to_base64_png(image_bgr: np.ndarray) -> Optional[str]:
    """Mã hóa ảnh BGR thành chuỗi base64 PNG (kèm data URI prefix) để trả qua API."""
    ok, buf = cv2.imencode(".png", image_bgr)
    if not ok:
        return None
    return f"data:image/png;base64,{base64.b64encode(buf.tobytes()).decode()}"


# ─── TEST nhanh khi chạy trực tiếp ────────────────────────────────────────────
if __name__ == "__main__":
    synthetic = generate_synthetic_ecg()
    cv2.imwrite("/tmp/synthetic_ecg_test.png", synthetic)
    result = digitize_ecg_image(synthetic)
    print(f"Width: {result['width']}, columns_with_signal: {result['columns_with_signal']}")
    print(f"Warning: {result['warning']}")
    print(f"Signal length: {len(result['signal'])}, sample: {result['signal'][:10]}")
