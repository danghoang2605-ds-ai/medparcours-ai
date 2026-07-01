"""
test_ecg_engine.py — Test cho ecg_engine.py, đặc biệt thuật toán detect_r_peaks
mới (đã thay thế kỹ thuật 2-pass cũ).

BỐI CẢNH SỬA: kỹ thuật 2-pass cũ cho kết quả SAI NẶNG khi test với 2 ảnh ECG
thật (bpm tính ra 296 và 168 so với máy đo thật 82 và 155 — sai lệch 2-3.6
lần). Nguyên nhân: tín hiệu trích xuất có nhiễu răng cưa quanh mỗi đỉnh QRS
thật, 2-pass không đủ mạnh để gộp các đỉnh giả này lại. Thuật toán mới dùng:
  1. Loại trừ vùng đầu tín hiệu (vạch chuẩn biên độ máy ECG)
  2. Gộp cụm đỉnh gần nhau, giữ đỉnh cao nhất (non-maximum suppression)

Sau khi sửa: ảnh ecg1 (7 nhịp thật theo đếm bằng mắt) cho đúng 7 đỉnh, đúng
vị trí khi đối chiếu trực quan với ảnh gốc — xem ghi chú đầy đủ trong
ecg_engine.py.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import cv2
import ecg_engine as ecg


def _make_signal_with_calibration_pulse_and_noisy_qrs():
    """
    Mô phỏng đúng vấn đề đã phát hiện qua ảnh ECG thật: 1 vạch calibration
    hẹp ở đầu, sau đó các đỉnh QRS có "vai" nhiễu (2-3 đỉnh nhỏ sát nhau)
    quanh mỗi đỉnh thật — đúng dạng tín hiệu đã quan sát.
    """
    n = 540
    signal = np.full(n, 0.5)
    # Vạch calibration ở x~50-55 (trong vùng 13% đầu của 540 = ~70px)
    signal[50:53] = 0.9
    # 7 đỉnh QRS thật, mỗi đỉnh có 2 đỉnh nhiễu nhỏ sát cạnh (mô phỏng răng cưa)
    true_peak_positions = [114, 196, 249, 300, 381, 445, 499]
    for p in true_peak_positions:
        signal[p] = 1.0
        signal[p - 3] = 0.82  # nhiễu trước
        signal[p + 3] = 0.80  # nhiễu sau
    return signal.tolist(), true_peak_positions


def test_calibration_pulse_bi_loai_tru():
    """Vạch calibration ở đầu tín hiệu KHÔNG được tính là 1 đỉnh R."""
    signal, true_peaks = _make_signal_with_calibration_pulse_and_noisy_qrs()
    result = ecg.detect_r_peaks(signal, px_per_mm=5.0)
    # Vạch calib ở x=50-53, nằm trong vùng loại trừ 13% đầu (~70px của 540)
    assert all(p >= 70 for p in result["peaks"]), \
        f"Có đỉnh trong vùng calibration: {result['peaks']}"


def test_dem_dung_so_dinh_khong_bi_dem_du_do_nhieu_rang_cua():
    """Test hồi quy trực tiếp cho bug đã phát hiện: nhiễu răng cưa quanh mỗi
    đỉnh QRS không được đếm thành nhiều đỉnh riêng — phải gộp lại đúng 1."""
    signal, true_peaks = _make_signal_with_calibration_pulse_and_noisy_qrs()
    result = ecg.detect_r_peaks(signal, px_per_mm=5.0)
    assert len(result["peaks"]) == len(true_peaks), \
        f"Đếm dư/thiếu đỉnh: tìm {len(result['peaks'])}, thật có {len(true_peaks)}"


def test_vi_tri_dinh_dung_voi_sai_so_nho():
    """Đỉnh tìm được phải khớp đúng vị trí đỉnh thật (cho phép sai số nhỏ do
    làm mượt)."""
    signal, true_peaks = _make_signal_with_calibration_pulse_and_noisy_qrs()
    result = ecg.detect_r_peaks(signal, px_per_mm=5.0)
    found = sorted(result["peaks"])
    assert len(found) == len(true_peaks)
    for f, t in zip(found, true_peaks):
        assert abs(f - t) <= 5, f"Đỉnh {f} lệch quá xa vị trí thật {t}"


def test_tin_hieu_qua_ngan_tra_warning_ro():
    result = ecg.detect_r_peaks([0.5, 0.5])
    assert result["peaks"] == []
    assert "ngắn" in result["warning"]


def test_khong_du_hai_dinh_tra_warning():
    signal = [0.5] * 100
    signal[50] = 1.0
    result = ecg.detect_r_peaks(signal)
    assert len(result["rr_intervals_px"]) == 0
    assert result["warning"] is not None


# ─── Test estimate_px_per_mm: cảnh báo minh bạch khi ảnh quá thấp ────────────
def test_anh_qua_thap_ha_do_tin_cay():
    """Ảnh có chiều cao thấp (dải đo lưới mép trên < 15px tuyệt đối) phải
    không được báo độ tin cậy 'cao' dù gap đều — tránh CV thấp giả tạo do
    nhiễu hệ thống trên dải quá hẹp."""
    # Tạo ảnh giả 70px cao (giống ảnh ECG thật đã test) với lưới đều ở mép trên
    img = np.full((70, 300, 3), 255, dtype=np.uint8)
    for x in range(0, 300, 5):
        img[0:8, x] = 200  # lưới đều mỗi 5px trong dải mép trên 8px
    result = ecg.estimate_px_per_mm(img)
    assert result["do_tin_cay"] != "cao"
    assert result["warning"] is not None
    assert "thấp" in result["warning"].lower() or "70px" in result["warning"]


def test_anh_rong_tra_khong_xac_dinh():
    result = ecg.estimate_px_per_mm(np.array([]))
    assert result["px_per_mm"] is None
    assert result["do_tin_cay"] == "thap"


# ─── Test ảnh tổng hợp (generate_synthetic_ecg) vẫn chạy đúng pipeline đủ ────
def test_pipeline_day_du_voi_anh_tong_hop():
    """Test end-to-end: ảnh tổng hợp với nhịp tim BIẾT TRƯỚC phải cho ra bpm
    gần đúng (ảnh tổng hợp sạch, không nhiễu như ảnh thật, nên kỳ vọng sai số
    nhỏ hơn nhiều so với ảnh thật)."""
    img = ecg.generate_synthetic_ecg(width=1200, height=400, heart_rate_bpm=75.0, noise=0.0)
    digi = ecg.digitize_ecg_image(img)
    calib = ecg.estimate_px_per_mm(img)
    peaks = ecg.detect_r_peaks(digi["signal"], px_per_mm=calib["px_per_mm"])
    hr = ecg.compute_heart_rate(peaks["rr_intervals_px"], calib["px_per_mm"])
    assert hr["bpm_avg"] is not None
    # Ảnh tổng hợp sạch -> sai số nên dưới 15% so với 75bpm đặt trước
    assert abs(hr["bpm_avg"] - 75.0) / 75.0 < 0.15, \
        f"Sai số quá lớn trên ảnh tổng hợp sạch: {hr['bpm_avg']} vs 75"


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])


# ═══════════════════════════════════════════════════════════════════════════
# TEST HỒI QUY: thuật toán trích xuất tín hiệu mới (Viterbi + upscale +
# threshold tuyệt đối) — sửa bug nghiêm trọng phát hiện qua phản hồi thực tế:
# tín hiệu số hóa ra "hỗn loạn", không giống ảnh gốc nhịp xoang đều.
#
# NGUYÊN NHÂN GỐC (đã xác nhận, không phải suy đoán): cách cũ lấy trung bình
# cộng/trung bình có trọng số của TẤT CẢ pixel tối trong 1 cột để tìm vị trí
# tín hiệu. Với sóng dốc đứng như QRS (rất hẹp theo "Sách hướng dẫn 1.pdf"),
# một cột có thể cắt qua 2 đoạn đường cong khác nhau cùng lúc -> trung bình
# tạo điểm ảo. Đây là vấn đề ĐÃ ĐƯỢC GHI NHẬN trong văn học khoa học (bài báo
# gốc thuật toán "paper-ECG", Fortune et al. 2022, DOI 10.1016/j.cmpb.2022.
# 106890: "thuật toán hoạt động không tốt tại các điểm ngoặt sắc nhọn gần
# đỉnh QRS, đây là vấn đề phổ biến trong số hóa ECG").
# ═══════════════════════════════════════════════════════════════════════════

def _make_steep_qrs_image(width=200, height=70):
    """Mô phỏng ĐÚNG tình huống gây bug: 1 cột cắt qua 2 đoạn đường cong khác
    nhau cùng lúc (đường QRS dốc đứng VÀ đường baseline gần ngang sát đó)."""
    img = np.full((height, width, 3), 255, dtype=np.uint8)
    # Baseline ngang ở y=50 suốt chiều rộng
    cv2.line(img, (0, 50), (width - 1, 50), (30, 30, 30), 1)
    # 1 đỉnh QRS dốc đứng ở x=100, từ y=50 vọt lên y=10 rồi xuống lại y=50 —
    # TRÙNG CỘT với baseline ở các cột lân cận (x=98-102 có CẢ hai đường)
    pts = np.array([[97, 50], [99, 50], [100, 10], [101, 50], [103, 50]], dtype=np.int32)
    cv2.polylines(img, [pts], False, (30, 30, 30), 1)
    return img


def test_trich_tin_hieu_khong_tao_diem_ao_o_dinh_qrs_doc_dung():
    """Test hồi quy trực tiếp cho bug đã phát hiện: tại các cột gần đỉnh QRS
    dốc đứng (nơi 1 cột có thể cắt qua cả đường baseline VÀ đường QRS), kết
    quả KHÔNG được nằm ở vị trí "lưng chừng" vô lý giữa 2 đường — phải bám
    theo 1 trong 2 đường thật (baseline HOẶC đỉnh QRS), không phải điểm ảo
    do trung bình cộng.

    Gọi qua digitize_ecg_image() (pipeline ĐẦY ĐỦ, có bước upscale) thay vì
    gọi trực tiếp _extract_signal_grayscale() — vì upscale là một phần thiết
    yếu của giải pháp (đường nét 1px ở ảnh gốc quá mảnh để bất kỳ thuật toán
    cụm-liên-tục nào hoạt động ổn định, xem UPSCALE_FACTOR)."""
    img = _make_steep_qrs_image()
    result = ecg.digitize_ecg_image(img)
    sig = result["signal"]  # đã chuẩn hóa 0-1, đảo trục (1.0 = đỉnh cao nhất)
    # Đỉnh QRS ở x=100 phải là giá trị CAO trong tín hiệu đã chuẩn hóa (gần 1.0,
    # vì đây là điểm cao nhất sau khi đảo trục) — KHÔNG phải giá trị "lưng
    # chừng" (~0.4-0.6) do bị kéo về điểm ảo giữa baseline và đỉnh.
    assert sig[100] > 0.7, f"Đỉnh QRS bị kéo lệch xuống điểm ảo: giá trị chuẩn hóa={sig[100]} (kỳ vọng >0.7, gần đỉnh)"
    # Baseline ở 2 đầu ảnh (xa đỉnh QRS) phải là giá trị THẤP, tương phản rõ
    # với đỉnh — xác nhận đường đi không bị "phẳng hóa" mất hình dạng thật.
    assert sig[10] < 0.4, f"Baseline bị kéo lệch lên cao bất thường: {sig[10]}"


def test_threshold_tuyet_doi_tach_dung_net_but_tren_anh_that():
    """Test với đúng đặc điểm histogram đã xác nhận từ ảnh ECG thật: nền
    trắng chiếm đa số, đường bút tạo dải mật độ thấp 25-230 — ngưỡng 200
    phải tách được đường bút (gray<=200) mà không bắt nhầm nền trắng thuần
    (gray>=242 theo histogram thật đã đo)."""
    img = np.full((50, 50, 3), 250, dtype=np.uint8)  # nền gần trắng tuyệt đối
    img[20:22, 10:40] = 100  # 1 đoạn "nét bút" rõ ràng đậm
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    is_signal = gray <= ecg.GRAYSCALE_VALUE_THRESHOLD
    assert is_signal[20:22, 10:40].all(), "Không bắt được nét bút đậm rõ ràng"
    assert not is_signal[0:10, 0:10].any(), "Bắt nhầm nền trắng thành tín hiệu"


def test_upscale_giu_dung_kich_thuoc_tra_ve_cho_frontend():
    """Output width/height PHẢI là kích thước ẢNH GỐC (không phải đã upscale)
    — đảm bảo không đổi format dữ liệu cho App.jsx/estimate_px_per_mm dù nội
    bộ có phóng to ảnh để xử lý chính xác hơn."""
    img = ecg.generate_synthetic_ecg(width=300, height=120, heart_rate_bpm=75.0, noise=0.0)
    result = ecg.digitize_ecg_image(img)
    assert result["width"] == 300
    assert result["height"] == 120
    assert len(result["signal"]) == 300  # đúng 1 giá trị/cột ảnh GỐC


def test_canh_bao_dua_tren_khoang_trong_lien_tuc_khong_phai_tong_phan_tram():
    """Test hồi quy cho false-warning đã phát hiện: ảnh có baseline phẳng dài
    tự nhiên (ít pixel vượt ngưỡng nghiêm ngặt ở đó) nhưng KHÔNG có khoảng
    trống liên tục lớn -> KHÔNG được báo warning, dù tổng % cột thấp."""
    # Mô phỏng: nhiều đoạn baseline ngắn rải rác (tổng cộng nhiều cột không
    # tín hiệu) nhưng không đoạn nào liên tục dài quá 35% chiều rộng.
    img = np.full((70, 400, 3), 255, dtype=np.uint8)
    for start in range(0, 400, 40):
        cv2.line(img, (start, 35), (start + 5, 10), (20, 20, 20), 1)  # đoạn dốc ngắn
        # để trống 35px giữa các đoạn (baseline rải rác, không liên tục quá dài)
    result = ecg.digitize_ecg_image(img)
    assert result["warning"] is None, f"Báo warning sai dù không có khoảng trống dài: {result['warning']}"


def test_canh_bao_dung_khi_co_khoang_trong_lien_tuc_that_su_dai():
    """Ảnh có 1 đoạn dài liên tục KHÔNG có tín hiệu nào (vd nửa ảnh bị mờ
    hoàn toàn) PHẢI được báo warning đúng."""
    img = ecg.generate_synthetic_ecg(width=400, height=120, heart_rate_bpm=75.0, noise=0.0)
    img[:, 200:] = 255  # xóa trắng hoàn toàn nửa sau -> khoảng trống dài thật
    result = ecg.digitize_ecg_image(img)
    assert result["warning"] is not None
    assert "khoảng trống" in result["warning"].lower()


def test_nguong_tu_thich_nghi_khong_dem_0_dinh_khi_calibration_lan_at():
    """Test hồi quy trực tiếp cho bug nghiêm trọng đã phát hiện qua endpoint
    /ecg thật: ngưỡng tuyệt đối cố định 0.6 cũ khiến find_peaks() trả về 0
    đỉnh khi vạch calibration pulse (rất hẹp, rất đậm) chiếm vị trí max=1.0
    sau chuẩn hóa toàn cục, kéo biên độ tương đối của các đỉnh QRS thật
    xuống dưới 0.6 (quan sát thực tế: chỉ đạt 0.25-0.49) dù tín hiệu số hóa
    hoàn toàn đúng khi nhìn bằng mắt. Ngưỡng tự thích nghi (median + 60%
    biên độ dao động, tính SAU khi loại trừ calibration) phải bắt được ít
    nhất vài đỉnh thật trong tình huống này."""
    n = 540
    signal = np.full(n, 0.05)  # baseline thấp đều
    signal[50:53] = 1.0  # vạch calibration RẤT cao, chiếm vị trí max toàn cục
    # 5 đỉnh QRS thật, mỗi đỉnh rộng vài điểm (giống hình tam giác/cung nhọn
    # thật trên ảnh — KHÔNG phải 1 điểm rời rạc, vì savgol_filter làm mượt
    # sẽ giảm mạnh biên độ của đỉnh quá hẹp, không đại diện đúng tín hiệu
    # thật). Biên độ đỉnh ~0.45, thấp hơn ngưỡng cố định 0.6 cũ — đúng tình
    # huống quan sát thực tế từ ảnh ECG thật.
    qrs_positions = [120, 200, 280, 360, 440]
    for p in qrs_positions:
        signal[p - 1] = 0.30
        signal[p] = 0.45
        signal[p + 1] = 0.30
    result = ecg.detect_r_peaks(signal.tolist(), px_per_mm=5.0)
    assert result["warning"] is None, f"Vẫn đếm 0 đỉnh dù có QRS thật rõ ràng: {result['warning']}"
    assert len(result["peaks"]) >= 4, f"Bỏ sót quá nhiều đỉnh QRS thật: chỉ tìm {len(result['peaks'])}/5"


# ─── MỨC 3: LUẬT CỨNG AN TOÀN LÂM SÀNG (apply_ecg_safety_rules) ───────────
class TestEcgSafetyRules:
    """Test luật cứng theo yêu cầu cố vấn y khoa: không kết luận ST-T/trục khi
    < 12 chuyển đạo, ghi đè toàn bộ khi có điện cực tuột."""

    def test_electrode_detached_overrides_everything(self):
        """Điện cực tuột -> chặn TẤT CẢ findings (kể cả không thuộc ST-T/trục),
        trả về đúng câu ghi đè cố định yêu cầu."""
        r = ecg.apply_ecg_safety_rules(
            n_leads=1,
            redflags=["Điện cực tuột (Electrode Detached)"],
            findings=["Bloc nhĩ-thất độ 1", "Nhịp xoang bình thường"],
        )
        assert r["findings_hien_thi"] == []
        assert len(r["bi_chan"]) == 2
        assert r["ghi_de_toan_bo"] == ecg.ECG_ELECTRODE_DETACHED_OVERRIDE
        assert r["confidence_level"] == "Thấp"

    def test_single_lead_blocks_stt_and_axis_only(self):
        """< 12 chuyển đạo: chặn đúng câu ST-T/trục, GIỮ LẠI câu không thuộc
        2 danh mục này (vd cảnh báo nhiễu kỹ thuật thuần túy)."""
        r = ecg.apply_ecg_safety_rules(
            n_leads=1,
            redflags=["ARTIFACT PRESENT"],
            findings=[
                "Bất thường sóng T, nghi thiếu máu cơ tim thành dưới",
                "Lệch trục trái mức độ vừa",
                "Có nhiễu tín hiệu khi đo (ARTIFACT PRESENT)",
            ],
        )
        assert r["ghi_de_toan_bo"] is None
        assert r["findings_hien_thi"] == ["Có nhiễu tín hiệu khi đo (ARTIFACT PRESENT)"]
        assert len(r["bi_chan"]) == 2
        assert r["confidence_level"] == "Thấp"

    def test_no_redflag_single_lead_no_stt_findings_medium_confidence(self):
        """< 12 chuyển đạo nhưng không có redflag và không có finding ST-T/trục
        nào bị chặn -> độ tin cậy Trung bình (không phải Thấp, không phải Cao)."""
        r = ecg.apply_ecg_safety_rules(n_leads=1, redflags=[], findings=["Nhịp xoang đều"])
        assert r["findings_hien_thi"] == ["Nhịp xoang đều"]
        assert r["bi_chan"] == []
        assert r["confidence_level"] == "Trung bình"

    def test_twelve_leads_no_blocking(self):
        """Đủ 12 chuyển đạo (kịch bản tương lai): không chặn gì, độ tin cậy Cao
        nếu không có redflag."""
        r = ecg.apply_ecg_safety_rules(n_leads=12, redflags=[], findings=["Lệch trục trái"])
        assert r["findings_hien_thi"] == ["Lệch trục trái"]
        assert r["bi_chan"] == []
        assert r["ghi_de_toan_bo"] is None
        assert r["confidence_level"] == "Cao"

    def test_empty_findings_and_redflags(self):
        """Không có gì để chặn, không crash trên input rỗng."""
        r = ecg.apply_ecg_safety_rules(n_leads=1, redflags=[], findings=[])
        assert r["findings_hien_thi"] == []
        assert r["ghi_de_toan_bo"] is None
