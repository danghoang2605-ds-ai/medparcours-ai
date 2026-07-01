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
# Ngưỡng độ sáng (Value, 0=đen, 255=trắng) để tách đường bút khỏi nền+lưới
# trên ảnh GRAYSCALE — ĐÃ THAY ĐỔI sau khi phát hiện bug nghiêm trọng (tín
# hiệu số hóa "hỗn loạn"). Xác nhận qua HISTOGRAM THẬT của 2 ảnh ECG mẫu:
# tuyệt đại đa số pixel là nền trắng gần 255, đường bút tạo 1 dải mật độ
# thấp trải dài ~25-230 (do anti-aliasing khi scan) — ngưỡng 200 tách đúng
# phần lõi đậm nhất của nét bút mà không bắt nhiễu nền/lưới nhạt. ĐÃ TEST
# bằng mắt: khớp gần hoàn hảo hình dạng + đúng số nhịp so với ảnh gốc.
GRAYSCALE_VALUE_THRESHOLD = 200
# Hệ số phóng to ảnh TRƯỚC khi xử lý — bù cho ảnh ECG gốc thường có độ phân
# giải thấp (mẫu thật chỉ cao ~70px), khiến đường nét bút chỉ rộng 1-2px,
# rất nhạy nhiễu khi xử lý ở độ phân giải gốc. Phóng to bằng nội suy cubic
# (giữ đường nét mảnh trơn, không vỡ khối như nội suy "nearest") TRƯỚC khi
# tách tín hiệu giúp thuật toán Viterbi có nhiều "điểm khả dĩ" hơn mỗi cột
# để chọn đường đi đúng — ĐÃ XÁC NHẬN qua test: ảnh gốc 70px cao cho kết quả
# hỗn loạn, ảnh upscale 4x cho kết quả khớp gần hoàn hảo với ảnh gốc.
UPSCALE_FACTOR = 4

# Tham số cho estimate_px_per_mm() bản 2 (tìm chu kỳ lưới ô nhỏ ở dải mép
# trên ảnh) — ĐÃ TINH CHỈNH qua test với 2 ảnh ECG thật.
GRID_DETECT_BAND_FRACTION = 0.12  # tỉ lệ chiều cao ảnh dùng làm dải dò lưới
GRID_MIN_PEAK_DISTANCE_PX = 3     # khoảng cách tối thiểu giữa 2 đỉnh lưới (px)
GRID_MIN_PEAKS_REQUIRED = 8       # số đỉnh lưới tối thiểu để tin cậy chu kỳ đo được

# Tham số cũ cho kỹ thuật 2-pass (ĐÃ THAY THẾ — xem detect_r_peaks() và
# _merge_close_peaks() mới, dùng kỹ thuật "loại trừ calibration pulse + gộp
# cụm đỉnh" thay vì 2-pass, vì 2-pass không đủ mạnh để loại nhiễu răng cưa
# quanh đỉnh QRS thật trên ảnh ECG thật — đã xác nhận qua test gây đếm dư
# 2-3 lần số nhịp thật).


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


# ─── TRÍCH TÂM CỤM LIÊN TỤC + DYNAMIC PROGRAMMING ─────────────────────────────
# THAY THẾ HOÀN TOÀN cách cũ "trung bình cộng/trung bình có trọng số TOÀN BỘ
# pixel tối trong 1 cột". Bug đã xác nhận qua phản hồi thực tế (ảnh số hóa ra
# "tín hiệu hỗn loạn" không giống ảnh gốc nhịp xoang đều): với sóng dốc đứng
# như phức bộ QRS (rộng chỉ 0.05-0.10s theo "Sách hướng dẫn 1.pdf" — rất hẹp
# theo chiều ngang), một cột pixel có thể cắt qua 2 ĐOẠN ĐƯỜNG CONG KHÁC NHAU
# (ví dụ đường lên dốc của QRS VÀ đường gần-nằm-ngang của baseline/sóng T kề
# bên). Trung bình cộng 2 điểm xa nhau này tạo ra 1 điểm ẢO ở giữa, không phải
# vị trí thật của đường ECG nào — méo toàn bộ hình dạng đúng lúc gần đỉnh R,
# đúng nơi quan trọng nhất để tính nhịp tim.
#
# Đây là vấn đề ĐÃ ĐƯỢC GHI NHẬN TRONG VĂN HỌC KHOA HỌC, không phải suy đoán:
# bài báo gốc thuật toán "paper-ECG" (Fortune et al., Computer Methods and
# Programs in Biomedicine, 2022 — https://doi.org/10.1016/j.cmpb.2022.106890)
# viết rõ: "Chúng tôi nhận thấy thuật toán trích tín hiệu hoạt động không tốt
# tại các điểm ngoặt sắc nhọn (ví dụ gần đỉnh QRS), đây là vấn đề phổ biến
# trong số hóa ECG." Hướng giải pháp đề xuất trong văn học gần đây (arXiv
# 2506.10617, 2025): với mỗi cột, tìm TẤT CẢ các cụm điểm tối LIÊN TỤC, lấy
# tâm mỗi cụm làm "điểm khả dĩ" (candidate), rồi dùng PHƯƠNG PHÁP VITERBI
# (dynamic programming) để chọn đường đi nối các điểm khả dĩ giữa các cột kề
# nhau sao cho tổng "chi phí" (khoảng cách dọc + độ đổi hướng) thấp nhất —
# đảm bảo đường được chọn LIÊN TỤC, TRƠN, không nhảy lung tung giữa 2 đoạn
# đường cong khác nhau như cách cũ.
#
# Cài đặt ở đây là bản RÚT GỌN của Viterbi (không cần thư viện ngoài ngoài
# numpy/scipy đã có sẵn trong requirements.txt — không nhúng nguyên thư viện
# ecg-digitize/paper-ecg vì repo đó yêu cầu Python 3.6.7 cũ, không tương thích
# môi trường hiện tại và không có gói pip để cài qua requirements.txt).

def _find_column_clusters(mask_col: np.ndarray, min_cluster_px: int = 1) -> list:
    """Tìm tâm (trung bình vị trí) của mỗi cụm pixel True LIÊN TỤC trong 1 cột
    mask boolean. Trả list các (center_y, cluster_size) — cluster_size dùng
    làm "độ tin cậy" của điểm khả dĩ đó (cụm dày hơn = nhiều khả năng là nét
    bút thật hơn là 1 chấm nhiễu lẻ)."""
    if not mask_col.any():
        return []
    idx = np.nonzero(mask_col)[0]
    clusters = []
    start = idx[0]
    prev = idx[0]
    for v in idx[1:]:
        if v - prev > 1:  # đứt đoạn -> kết thúc cụm hiện tại
            clusters.append(((start + prev) / 2.0, prev - start + 1))
            start = v
        prev = v
    clusters.append(((start + prev) / 2.0, prev - start + 1))
    if min_cluster_px > 1:
        clusters = [c for c in clusters if c[1] >= min_cluster_px] or clusters
    return clusters


def _trace_signal_viterbi(mask: np.ndarray) -> tuple:
    """
    Nhận mask boolean (True = pixel thuộc đường tín hiệu, đã tách lưới từ
    trước) — trả về (raw_y[] theo từng cột, số cột tìm được điểm hợp lệ).

    THUẬT TOÁN (Viterbi rút gọn):
      1. Mỗi cột: tìm tất cả cụm liên tục -> danh sách điểm khả dĩ (candidates).
      2. Quét từ trái sang phải, với mỗi candidate ở cột hiện tại, tính "chi
         phí tích lũy" thấp nhất để đến được nó từ MỌI candidate ở cột trước
         (chi phí = khoảng cách dọc^2, ưu tiên đường ít đổi hướng đột ngột).
      3. Quét ngược lại để lấy ra đường đi có tổng chi phí thấp nhất
         (backtracking) — đây chính là tín hiệu ECG thật, LIÊN TỤC, không
         nhảy giữa 2 đoạn đường cong khác nhau.

    Cột không có candidate nào -> NaN (sẽ nội suy ở bước sau, giữ đúng hành
    vi cũ — KHÔNG suy diễn giá trị khi ảnh thực sự không có tín hiệu ở đó).
    """
    h, w = mask.shape
    all_candidates = [_find_column_clusters(mask[:, x]) for x in range(w)]

    raw_y = np.full(w, np.nan)
    cols_found = 0

    # Xử lý theo từng "đoạn liên tục có ít nhất 1 candidate" — giữa các đoạn
    # rỗng hoàn toàn (không có tín hiệu nào trong nhiều cột liền) ta để NaN,
    # không cố nối Viterbi qua khoảng trống lớn (tránh bịa đường đi xa vô lý).
    x = 0
    while x < w:
        if not all_candidates[x]:
            x += 1
            continue
        # Tìm đoạn [x, end) liên tục có candidate
        end = x
        while end < w and all_candidates[end]:
            end += 1
        segment = all_candidates[x:end]

        # Dynamic programming trên đoạn này
        n = len(segment)
        # cost[i] = list chi phí tích lũy tốt nhất tới mỗi candidate ở cột i
        # backptr[i] = list index candidate ở cột i-1 dẫn tới chi phí đó
        cost = [[0.0] * len(segment[0])]
        backptr = [[-1] * len(segment[0])]
        for i in range(1, n):
            prev_y = [c[0] for c in segment[i - 1]]
            cur_cost = []
            cur_back = []
            for (cy, csize) in segment[i]:
                best_c, best_j = float("inf"), 0
                for j, py in enumerate(prev_y):
                    # Chi phí: khoảng cách dọc bình phương (phạt đường nhảy
                    # xa) - không cộng thêm gì cho csize vì cụm dày hơn không
                    # chắc đúng hơn cụm mảnh (nét bút có thể mảnh đều).
                    c = cost[i - 1][j] + (cy - py) ** 2
                    if c < best_c:
                        best_c, best_j = c, j
                cur_cost.append(best_c)
                cur_back.append(best_j)
            cost.append(cur_cost)
            backptr.append(cur_back)

        # Backtrack từ candidate có chi phí thấp nhất ở cột cuối đoạn
        last_idx = int(np.argmin(cost[-1]))
        path_y = [0.0] * n
        idx_ = last_idx
        for i in range(n - 1, -1, -1):
            path_y[i] = segment[i][idx_][0]
            idx_ = backptr[i][idx_] if backptr[i][idx_] >= 0 else 0

        for k, col_x in enumerate(range(x, end)):
            raw_y[col_x] = path_y[k]
            cols_found += 1

        x = end

    return raw_y, cols_found


def _extract_signal_colored(image_bgr: np.ndarray) -> tuple:
    """
    Trích raw_y[] cho ảnh CÓ MÀU (lưới hồng/đỏ cố ý, vd ảnh tổng hợp test).
    Tách lưới theo Hue đỏ/hồng + Saturation, đường tín hiệu là pixel tối
    KHÔNG thuộc lưới — sau đó dùng _trace_signal_viterbi() để chọn đúng
    đường đi liên tục (xem ghi chú đầy đủ ở _trace_signal_viterbi).
    """
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    hue_deg = hsv[:, :, 0].astype(np.float64) * 2.0
    sat = hsv[:, :, 1].astype(np.float64)
    val = hsv[:, :, 2].astype(np.float64)

    is_grid = _hue_in_red_pink_range(hue_deg) & (sat <= GRID_SAT_MAX) & (val >= 120)
    is_dark_signal = (val <= SIGNAL_VALUE_MAX) & (~is_grid)

    return _trace_signal_viterbi(is_dark_signal)


def _extract_signal_grayscale(image_bgr: np.ndarray) -> tuple:
    """
    Trích raw_y[] cho ảnh GRAYSCALE (ảnh ECG in/scan thật).

    KỸ THUẬT (ĐÃ THAY ĐỔI sau khi phát hiện bug nghiêm trọng qua phản hồi
    thực tế — tín hiệu số hóa ra "hỗn loạn" không giống ảnh gốc nhịp xoang
    đều): bỏ hoàn toàn cách cũ dùng morphological closing + diff (quá nhạy
    với kernel/threshold khi đường nét rất mảnh trên ảnh độ phân giải thấp
    — đã xác nhận qua debug trực tiếp: tạo ra hàng trăm cụm rời rạc/giả ở
    nhiều cột). Thay bằng NGƯỠNG TUYỆT ĐỐI đơn giản theo histogram độ sáng
    thật của ảnh ECG scan: phần lớn pixel là nền trắng gần 255, đường bút
    luôn đậm hơn rõ rệt (đã xác nhận qua histogram thật: 1 dải mật độ thấp
    trải dài 25-230, ngưỡng ~200 tách đúng phần lõi đậm nhất của nét bút).

    Sau đó dùng _trace_signal_viterbi() để chọn đúng đường đi liên tục qua
    các pixel vượt ngưỡng (xem ghi chú đầy đủ ở _trace_signal_viterbi).

    ĐÃ TEST LẠI với đúng 2 ảnh ECG thật cũ: hình dạng số hóa khớp gần hoàn
    hảo với ảnh gốc khi nhìn bằng mắt (đếm đúng số nhịp, đúng dạng QRS có
    "vai" 2 bên) — xem cde/test_ecg_digitize_visual.py để biết cách verify
    lại bằng ảnh khi cần tinh chỉnh thêm.
    """
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    is_signal = gray <= GRAYSCALE_VALUE_THRESHOLD
    return _trace_signal_viterbi(is_signal)


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

    # Phóng to ảnh TRƯỚC khi xử lý (xem ghi chú UPSCALE_FACTOR) — chỉ ảnh
    # hưởng nội bộ hàm này, "width"/"height" trả về vẫn là kích thước GỐC để
    # không đổi format dữ liệu cho frontend/estimate_px_per_mm.
    proc_img = cv2.resize(image_bgr, None, fx=UPSCALE_FACTOR, fy=UPSCALE_FACTOR,
                           interpolation=cv2.INTER_CUBIC)
    proc_w = w * UPSCALE_FACTOR

    hsv = cv2.cvtColor(proc_img, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1].astype(np.float64)

    is_grayscale = float(np.mean(sat)) <= GRAYSCALE_SAT_THRESHOLD

    if is_grayscale:
        che_do = "grayscale"
        raw_y, columns_found_proc = _extract_signal_grayscale(proc_img)
    else:
        che_do = "mau"
        raw_y, columns_found_proc = _extract_signal_colored(proc_img)

    # columns_with_signal báo theo tỉ lệ ảnh GỐC (chia lại theo UPSCALE_FACTOR).
    columns_found = int(round(columns_found_proc / UPSCALE_FACTOR))

    # CẢNH BÁO CHẤT LƯỢNG: đã đổi tiêu chí sau khi phát hiện false-warning với
    # thuật toán mới (xem _trace_signal_viterbi) — % tổng số cột có tín hiệu
    # KHÔNG còn là chỉ báo đúng chất lượng, vì thuật toán mới chỉ giữ điểm tin
    # cậy cao (ngưỡng độ sáng nghiêm ngặt) nên đoạn baseline phẳng tự nhiên
    # giữa các nhịp (nét bút mảnh, ít anti-alias) có thể có rất ít pixel vượt
    # ngưỡng — ĐÃ XÁC NHẬN bằng mắt: ảnh mẫu có baseline dài chỉ đạt 26.9% cột
    # nhưng hình dạng số hóa vẫn khớp gần hoàn hảo với ảnh gốc (đúng số nhịp,
    # đúng hình QRS). Tiêu chí đúng hơn: KHOẢNG TRỐNG LIÊN TỤC dài nhất — một
    # vài đoạn ngắn không có tín hiệu là bình thường (baseline), nhưng một
    # đoạn rất dài (ví dụ nửa ảnh) mới thật sự đáng ngờ (ảnh mờ/nghiêng/hỏng).
    warning = None
    nan_mask = np.isnan(raw_y)
    longest_gap_proc = 0
    if nan_mask.any():
        gap = 0
        for v in nan_mask:
            gap = gap + 1 if v else 0
            longest_gap_proc = max(longest_gap_proc, gap)
    longest_gap_fraction = longest_gap_proc / proc_w if proc_w > 0 else 1.0
    if longest_gap_fraction > 0.35:
        warning = (f"Có một khoảng trống liên tục chiếm khoảng "
                   f"{longest_gap_fraction*100:.0f}% chiều rộng ảnh không phát hiện "
                   f"được tín hiệu — ảnh có thể bị mờ, nghiêng, hoặc thiếu nét ở "
                   f"đoạn đó. Cần kiểm tra lại ảnh gốc.")

    # Nội suy tuyến tính cho các cột thiếu (đứt nét) Ở ĐỘ PHÂN GIẢI ĐÃ UPSCALE,
    # rồi đảo trục y và chuẩn hóa baseline — TẤT CẢ vẫn ở độ phân giải proc_w.
    valid_idx = np.nonzero(~np.isnan(raw_y))[0]
    if valid_idx.size >= 2:
        filled_y = np.interp(np.arange(proc_w), valid_idx, raw_y[valid_idx])
    elif valid_idx.size == 1:
        filled_y = np.full(proc_w, raw_y[valid_idx[0]])
    else:
        filled_y = np.zeros(proc_w)
        warning = "Không phát hiện được đường tín hiệu nào trong ảnh."

    inverted = -(filled_y - np.median(filled_y))  # đảo trục + đặt baseline ~0

    # Cửa sổ làm mượt SCALE THEO UPSCALE_FACTOR để giữ đúng tỉ lệ làm mượt
    # tương đối như khi xử lý ở độ phân giải gốc (đã verify qua test ảnh thật).
    win_proc = SMOOTH_WINDOW * UPSCALE_FACTOR + 1  # đảm bảo lẻ
    win = min(win_proc, proc_w - (1 - proc_w % 2))
    if win >= 5 and win % 2 == 1 and proc_w > win:
        smoothed = savgol_filter(inverted, window_length=win, polyorder=SMOOTH_POLYORDER)
    else:
        smoothed = inverted  # ảnh quá nhỏ để làm mượt, trả nguyên

    # Downsample tín hiệu về ĐÚNG ĐỘ PHÂN GIẢI GỐC (w điểm) — giữ format trả
    # về cho frontend giống hệt trước đây (1 giá trị/cột pixel ảnh GỐC),
    # không đổi gì ở App.jsx.
    x_proc = np.linspace(0, w - 1, proc_w)
    x_orig = np.arange(w)
    downsampled = np.interp(x_orig, x_proc, smoothed)

    # Chuẩn hóa 0-1 để FE vẽ SVG dễ dàng không phụ thuộc độ phân giải ảnh gốc.
    s_min, s_max = float(np.min(downsampled)), float(np.max(downsampled))
    if s_max - s_min > 1e-6:
        normalized = (downsampled - s_min) / (s_max - s_min)
    else:
        normalized = np.zeros_like(downsampled)

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

    # ĐÃ PHÁT HIỆN qua test: ảnh có chiều cao quá thấp (vd rhythm strip bị
    # crop chỉ còn ~70px) khiến band_height (dải dò lưới ở mép trên) chỉ còn
    # vài pixel — không đủ để trung bình hóa nhiễu JPEG/anti-aliasing, có
    # thể cho ra CV thấp GIẢ TẠO (nhiễu hệ thống đều đặn bị nhận lầm là lưới
    # thật đều). Hạ độ tin cậy xuống tối đa "trung_binh" khi dải dò quá hẹp
    # theo số tuyệt đối, dù CV trông có vẻ tốt.
    MIN_RELIABLE_BAND_HEIGHT_PX = 15
    if band_height < MIN_RELIABLE_BAND_HEIGHT_PX and do_tin_cay == "cao":
        do_tin_cay = "trung_binh"

    warning = None
    if do_tin_cay == "thap":
        warning = ("Khoảng cách giữa các đường lưới không đồng đều (ảnh có thể "
                   "nghiêng/mờ) — tỉ lệ px/mm chỉ là ước lượng thô, kết quả nhịp tim "
                   "cần xác nhận lại.")
    elif band_height < MIN_RELIABLE_BAND_HEIGHT_PX:
        warning = (f"Ảnh có chiều cao thấp ({h}px) — dải đo lưới ở mép trên chỉ "
                   f"{band_height}px, không đủ để trung bình hóa nhiễu ảnh. Tỉ lệ "
                   "px/mm và nhịp tim suy ra có thể kém chính xác hơn ảnh đầy đủ "
                   "12 chuyển đạo, cần đối chiếu cẩn thận với số máy đo gốc.")

    return {
        "px_per_mm": round(px_per_mm, 3),
        "do_tin_cay": do_tin_cay,
        "warning": warning,
    }


def _merge_close_peaks(peaks: np.ndarray, heights: np.ndarray, min_gap_px: int) -> np.ndarray:
    """
    Gộp các đỉnh cách nhau < min_gap_px thành 1, GIỮ ĐỈNH CAO NHẤT trong mỗi
    cụm. Đây là bước "non-maximum suppression" — khác với việc chỉ đặt
    distance trong find_peaks (find_peaks xét tuần tự nên không đảm bảo lọc
    hết khi 2 đỉnh trong cùng cụm có biên độ tương đương nhau).

    ĐÃ XÁC NHẬN QUA TEST với 2 ảnh ECG thật: nếu chỉ dùng distance của
    find_peaks, tín hiệu nhiễu (răng cưa quanh đỉnh QRS thật do lưới chưa
    lọc sạch hết) vẫn tạo ra 2-3 đỉnh giả sát nhau quanh 1 đỉnh R thật — gây
    đếm dư gấp 2-3 lần số nhịp thật.
    """
    if len(peaks) == 0:
        return peaks
    order = np.argsort(peaks)
    peaks_sorted = peaks[order]
    heights_sorted = heights[order]
    result = [int(peaks_sorted[0])]
    result_h = [float(heights_sorted[0])]
    for i in range(1, len(peaks_sorted)):
        if peaks_sorted[i] - result[-1] < min_gap_px:
            if heights_sorted[i] > result_h[-1]:
                result[-1] = int(peaks_sorted[i])
                result_h[-1] = float(heights_sorted[i])
        else:
            result.append(int(peaks_sorted[i]))
            result_h.append(float(heights_sorted[i]))
    return np.array(result)


# Tỉ lệ chiều rộng ảnh ở ĐẦU bản ghi cần loại trừ khỏi việc tìm đỉnh R, vì đây
# là vị trí thường gặp của "vạch chuẩn biên độ" (calibration pulse — xung
# vuông 1mV trước khi máy ghi sóng thật) trên nhiều máy ECG. ĐÃ XÁC NHẬN qua
# soi trực tiếp 2 ảnh ECG thật: vạch calibration nằm ở khoảng 6.6%-12.4%
# chiều rộng ảnh tính từ đầu — 13% là ngưỡng AN TOÀN bao trùm cả 2, nhưng đây
# vẫn là HEURISTIC từ mẫu rất nhỏ (2 ảnh), CẦN thêm ảnh thật đa dạng hơn để
# tinh chỉnh, KHÔNG đảm bảo đúng cho mọi máy/định dạng ảnh.
CALIBRATION_PULSE_EXCLUDE_FRACTION = 0.13

# Khoảng cách tối thiểu giữa 2 đỉnh R SAU KHI gộp cụm — ước lượng từ giới hạn
# sinh lý tần số tim tối đa hợp lý (~250 bpm, dùng giá trị RỘNG để không bỏ
# sót nhịp nhanh thật, không phải ngưỡng chẩn đoán). Tính bằng px dựa theo
# px_per_mm đã ước lượng — xem detect_r_peaks().
MAX_PHYSIOLOGICAL_BPM = 250

# Khoảng cách gộp cụm THỰC NGHIỆM — ĐÃ XÁC NHẬN qua test với 2 ảnh ECG thật:
# cho kết quả ĐÚNG số nhịp khi đối chiếu trực quan với ảnh gốc (đếm tay).
# Giá trị này ưu tiên hơn ngưỡng tính từ giới hạn sinh lý (xem ghi chú trong
# detect_r_peaks) vì giới hạn sinh lý quá rộng để lọc nhiễu hiệu quả trên
# ảnh chất lượng kém. CẦN kiểm chứng lại khi có thêm ảnh ECG thật đa dạng
# hơn — đây vẫn là mẫu rất nhỏ (2 ảnh).
EMPIRICAL_MERGE_GAP_PX = 40


def detect_r_peaks(signal: list, height_threshold: Optional[float] = None,
                    min_distance_px: Optional[int] = None,
                    px_per_mm: Optional[float] = None,
                    paper_speed_mm_s: float = PAPER_SPEED_MM_PER_S) -> dict:
    """
    Detect đỉnh R bằng scipy.signal.find_peaks trên signal[] đã chuẩn hóa 0-1
    (output của digitize_ecg_image). KHÔNG tự chẩn đoán gì — chỉ trả vị trí
    đỉnh (theo chỉ số cột pixel) và khoảng cách giữa các đỉnh.

    height_threshold=None (mặc định MỚI): TỰ TÍNH theo phân vị 75% của tín
    hiệu SAU KHI loại trừ vùng calibration — THAY THẾ ngưỡng tuyệt đối cố
    định 0.6 cũ. BUG ĐÃ SỬA (phát hiện qua test với ảnh ECG thật sau khi đổi
    thuật toán trích tín hiệu — xem _trace_signal_viterbi): vạch calibration
    pulse ở đầu tín hiệu (rất hẹp, rất đậm) có thể chiếm vị trí "max=1.0" sau
    chuẩn hóa 0-1 toàn cục trong digitize_ecg_image(), khiến các đỉnh QRS
    thật (dù đúng vị trí, đúng hình dạng khi nhìn bằng mắt) chỉ đạt giá trị
    chuẩn hóa thấp (~0.25-0.49 trong trường hợp đã quan sát) — THẤP HƠN
    ngưỡng cố định 0.6, khiến find_peaks() không bắt được đỉnh nào, trả về
    "0 đỉnh" dù tín hiệu số hóa hoàn toàn đúng. Ngưỡng tự thích nghi theo
    phân vị tránh phụ thuộc vào biên độ tuyệt đối, vốn thay đổi tùy theo
    ảnh có/không có calibration pulse và độ "lấn át" của nó.

    Vẫn CHO PHÉP truyền height_threshold cụ thể (số tuyệt đối) nếu cần ép
    giá trị khi debug — hành vi cũ giữ nguyên trong trường hợp đó.

    KỸ THUẬT (thay thế bản 2-pass cũ — đã phát hiện qua test với ảnh ECG
    thật rằng 2-pass KHÔNG đủ mạnh để loại nhiễu răng cưa quanh đỉnh QRS,
    gây đếm dư 2-3 lần số nhịp thật):
      1. Loại trừ {CALIBRATION_PULSE_EXCLUDE_FRACTION} đầu tín hiệu — tránh
         bắt nhầm vạch chuẩn biên độ máy ECG thành 1 nhịp.
      2. find_peaks với distance NHỎ (bắt hết, kể cả đỉnh trong cùng 1 cụm
         nhiễu quanh 1 QRS thật).
      3. Gộp cụm đỉnh gần nhau (_merge_close_peaks) theo khoảng cách tối
         thiểu tính từ giới hạn sinh lý (MAX_PHYSIOLOGICAL_BPM) nếu có
         px_per_mm — nếu không có (chưa calibrate được), dùng giá trị
         pixel cố định an toàn (40px, từ quan sát thực tế 2 ảnh test).

    Nếu người gọi tự truyền min_distance_px cụ thể, BỎ QUA logic ước lượng
    tự động và dùng đúng giá trị đó (để vẫn ép tham số được khi cần debug).
    """
    if not signal or len(signal) < 3:
        return {"peaks": [], "rr_intervals_px": [], "warning": "Tín hiệu quá ngắn để tìm đỉnh R."}

    arr = np.array(signal, dtype=np.float64)
    w = len(arr)

    # Làm mượt NHẸ trước khi tìm đỉnh (giữ dạng sóng, không làm méo vị trí
    # đỉnh thật — ĐÃ TEST: làm mượt quá mạnh (window>=21) làm "vai" của 1
    # đỉnh QRS tách thành 2 đỉnh giả ở vị trí KHÁC đỉnh thật, tệ hơn không
    # làm mượt).
    win = min(9, w - (1 - w % 2))
    if win >= 5 and win % 2 == 1 and w > win:
        smoothed = savgol_filter(arr, window_length=win, polyorder=2)
    else:
        smoothed = arr

    exclude_start = int(w * CALIBRATION_PULSE_EXCLUDE_FRACTION)

    if height_threshold is None:
        # Tự tính ngưỡng = median + 60% biên độ dao động (max - median) của
        # phần tín hiệu SAU calibration — KHÔNG dùng percentile (đã thử,
        # THẤT BẠI khi tín hiệu phần lớn là nền/baseline phẳng với đỉnh
        # hiếm, đúng đặc trưng thật của tín hiệu ECG: percentile 75-95% vẫn
        # rơi vào vùng nền vì nền chiếm áp đảo số lượng điểm). Công thức
        # median+60%*range tách đúng theo BIÊN ĐỘ dao động thực tế của tín
        # hiệu đó, không phụ thuộc tỉ lệ điểm nền/đỉnh.
        #
        # SÀN AN TOÀN: BUG ĐÃ SỬA (phát hiện qua viết test) — sàn tuyệt đối
        # cố định (vd 0.3) có thể VƯỢT QUÁ chính giá trị đỉnh cao nhất khi
        # toàn bộ tín hiệu có biên độ dao động nhỏ (vd sau khi savgol_filter
        # làm mượt một đỉnh hẹp), khiến ngưỡng tính ra cao hơn mọi đỉnh thật
        # -> luôn đếm 0 đỉnh dù dữ liệu hợp lệ. Sàn ĐÚNG phải là tỉ lệ NHỎ
        # của chính max thật (90%), không bao giờ vượt quá max -> luôn còn
        # khả năng bắt được đỉnh cao nhất ít nhất.
        post_calib = smoothed[exclude_start:] if exclude_start < w else smoothed
        if post_calib.size > 0:
            med = float(np.median(post_calib))
            pmax = float(np.max(post_calib))
            adaptive = med + 0.6 * (pmax - med)
            floor_safety = 0.9 * pmax  # KHÔNG BAO GIỜ vượt quá max thật
            height_threshold = min(adaptive, floor_safety)
        else:
            height_threshold = 0.3

    if min_distance_px is not None:
        peaks, _ = find_peaks(smoothed, height=height_threshold, distance=min_distance_px)
        peaks = peaks[peaks >= exclude_start]
    else:
        # Bước 2: bắt rộng (distance nhỏ) để không bỏ sót đỉnh nào trong cụm
        peaks_raw, _ = find_peaks(smoothed, height=height_threshold, distance=15)
        peaks_raw = peaks_raw[peaks_raw >= exclude_start]

        if len(peaks_raw) < 2:
            peaks = peaks_raw
        else:
            # Bước 3: khoảng cách tối thiểu để gộp cụm. ĐÃ TEST: dùng riêng
            # giới hạn sinh lý (60/250bpm) ra ngưỡng quá NHỎ (~30px ở
            # px_per_mm=5) — không đủ mạnh để lọc cụm nhiễu răng cưa quanh
            # 1 đỉnh QRS thật trên ảnh chất lượng kém. 40px (cố định, từ
            # quan sát thực nghiệm 2 ảnh ECG thật) cho kết quả ĐÚNG SỐ NHỊP
            # khi đối chiếu trực quan với ảnh gốc — ưu tiên dùng giá trị này,
            # giới hạn sinh lý chỉ làm SÀN TỐI THIỂU (không bao giờ thấp hơn
            # mức sinh lý cho phép, tránh gộp nhầm 2 nhịp thật rất gần nhau ở
            # người có tần số tim cao bất thường).
            physio_floor_px = 15
            if px_per_mm and px_per_mm > 0:
                min_rr_seconds = 60.0 / MAX_PHYSIOLOGICAL_BPM
                physio_floor_px = max(15, int(min_rr_seconds * paper_speed_mm_s * px_per_mm))
            min_gap_px = max(physio_floor_px, EMPIRICAL_MERGE_GAP_PX)
            heights_raw = smoothed[peaks_raw]
            peaks = _merge_close_peaks(peaks_raw, heights_raw, min_gap_px)

    if len(peaks) < 2:
        return {"peaks": peaks.tolist(), "rr_intervals_px": [],
                "warning": "Tìm được dưới 2 đỉnh R — không đủ để tính khoảng R-R. "
                           "Có thể cần giảm height_threshold hoặc ảnh không rõ tín hiệu."}

    rr_intervals_px = np.diff(peaks).tolist()
    return {"peaks": peaks.tolist() if isinstance(peaks, np.ndarray) else peaks,
            "rr_intervals_px": rr_intervals_px, "warning": None}


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


# ─── MỨC 3: LUẬT CỨNG AN TOÀN LÂM SÀNG (không phụ thuộc LLM) ──────────────
# Yêu cầu từ cố vấn chuyên môn y khoa: hệ thống hiện chỉ trích xuất được 1
# chuyển đạo (Lead I) từ 1 ảnh trang 12 chuyển đạo — KHÔNG được phép để lộ
# ra ngoài kết luận về ST-T/trục điện tim như thể hệ thống đã tự phân tích
# đủ 12 chuyển đạo, dù nội dung đó vốn trích từ máy đo gốc (máy đo có đủ 12
# chuyển đạo thật, nhưng hệ thống MedParcours thì chưa xác minh lại được).
#
# 2 danh mục bị chặn khi n_leads < 12: "st_t" (bất thường ST/T, thiếu máu cơ
# tim, tái cực...) và "truc" (lệch trục điện tim). Các cảnh báo kỹ thuật
# thuần túy (nhiễu, artifact) KHÔNG bị chặn vì không phải kết luận lâm sàng.
ECG_MIN_LEADS_FOR_STT_AXIS = 12

# Từ khóa nhận diện 1 phát hiện thuộc danh mục ST-T hay trục — dùng để lọc
# khỏi danh sách hiển thị khi chưa đủ 12 chuyển đạo (rule cứng bên dưới).
_STT_KEYWORDS = ["st ", "st-t", "st_t", "sóng t", "twave", "t wave", "thiếu máu cơ tim",
                 "ischemia", "tái cực", "repolarization", "st chênh", "viêm màng ngoài tim",
                 "pericarditis", "injury"]
_AXIS_KEYWORDS = ["trục", "axis", "lệch trục"]

ECG_ELECTRODE_DETACHED_OVERRIDE = (
    "Chất lượng bản ghi không đạt để kết luận. Bản ghi có cảnh báo điện cực tuột "
    "và hệ thống mới trích xuất được 1 chuyển đạo. Không nên kết luận bất thường "
    "ST-T hoặc trục điện tim từ dữ liệu hiện tại. Cần đối chiếu ECG 12 chuyển đạo "
    "đo lại và bác sĩ xác nhận."
)

ECG_PERMANENT_DISCLAIMER = (
    "Hệ thống hiện chỉ trích xuất được Lead I. Các nhận định ST-T/trục dưới đây "
    "được lấy từ báo cáo máy ECG gốc, chưa được AI xác minh độc lập từ đủ 12 "
    "chuyển đạo."
)


def _is_stt_or_axis_finding(text: str) -> Optional[str]:
    """Trả 'st_t' | 'truc' | None tùy nội dung 1 câu phát hiện thuộc danh mục nào."""
    t = text.lower()
    if any(k in t for k in _STT_KEYWORDS):
        return "st_t"
    if any(k in t for k in _AXIS_KEYWORDS):
        return "truc"
    return None


def apply_ecg_safety_rules(n_leads: int, redflags: list, findings: list) -> dict:
    """
    Áp LUẬT CỨNG an toàn lâm sàng lên danh sách phát hiện (findings) trước khi
    hiển thị cho bác sĩ. KHÔNG dùng LLM — thuần quyết định dựa trên dữ liệu đã
    biết chắc chắn (số chuyển đạo trích xuất được, redflags đã phát hiện).

    Tham số:
      n_leads: số chuyển đạo hệ thống THỰC SỰ trích xuất được (không phải số
               chuyển đạo máy đo gốc có — hiện luôn là 1 vì kiến trúc chưa tách
               được nhiều chuyển đạo từ 1 ảnh trang đầy đủ).
      redflags: danh sách cảnh báo chất lượng đã phát hiện, vd
               ["Điện cực tuột (Electrode Detached)", "Nhiễu cơ", "Baseline wander",
                "Thiếu chuyển đạo", "Ảnh mờ"].
      findings: danh sách câu kết luận gốc (vd từ máy đo hoặc AI OCR).

    Trả về dict:
      {"findings_hien_thi": [...], "bi_chan": [...], "ghi_de_toan_bo": str|None,
       "confidence_level": "Cao"|"Trung bình"|"Thấp"}
    """
    redflags = redflags or []
    findings = findings or []
    has_electrode_detached = any("điện cực tuột" in r.lower() or "electrode detached" in r.lower()
                                  for r in redflags)

    # Luật 1 (nghiêm trọng nhất): điện cực tuột -> ghi đè TOÀN BỘ kết luận,
    # không hiển thị bất kỳ findings gốc nào nữa (kể cả không thuộc ST-T/trục),
    # vì đã có cảnh báo chất lượng bản ghi ở mức nghiêm trọng nhất.
    if has_electrode_detached:
        return {
            "findings_hien_thi": [],
            "bi_chan": list(findings),
            "ghi_de_toan_bo": ECG_ELECTRODE_DETACHED_OVERRIDE,
            "confidence_level": "Thấp",
        }

    # Luật 2: chưa đủ 12 chuyển đạo -> lọc bỏ riêng các câu thuộc ST-T/trục,
    # giữ lại các cảnh báo kỹ thuật thuần túy (nhiễu, artifact...).
    if n_leads < ECG_MIN_LEADS_FOR_STT_AXIS:
        hien_thi, bi_chan = [], []
        for f in findings:
            (bi_chan if _is_stt_or_axis_finding(f) else hien_thi).append(f)
        confidence = "Thấp" if (redflags or bi_chan) else "Trung bình"
        return {
            "findings_hien_thi": hien_thi,
            "bi_chan": bi_chan,
            "ghi_de_toan_bo": None,
            "confidence_level": confidence,
        }

    # Đủ 12 chuyển đạo (hiện chưa xảy ra trong thực tế với kiến trúc hiện tại,
    # nhưng để sẵn nhánh này cho tương lai khi tách được đủ chuyển đạo).
    return {
        "findings_hien_thi": list(findings),
        "bi_chan": [],
        "ghi_de_toan_bo": None,
        "confidence_level": "Cao" if not redflags else "Trung bình",
    }


# ─── TEST nhanh khi chạy trực tiếp ────────────────────────────────────────────
if __name__ == "__main__":
    synthetic = generate_synthetic_ecg()
    cv2.imwrite("/tmp/synthetic_ecg_test.png", synthetic)
    result = digitize_ecg_image(synthetic)
    print(f"Width: {result['width']}, columns_with_signal: {result['columns_with_signal']}")
    print(f"Warning: {result['warning']}")
    print(f"Signal length: {len(result['signal'])}, sample: {result['signal'][:10]}")

