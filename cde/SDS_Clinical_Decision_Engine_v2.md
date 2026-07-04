# Software Design Specification — Clinical Decision Engine v2
**MedParcours AI — HackAIthon 2026**
Phiên bản: 1.0 (rút gọn, đủ để code, không lan man)
Dựa trên góp ý kiến trúc của anh Tấn (xem mục "Bối cảnh" cuối file)

---

## 1. Vấn đề của kiến trúc cũ

`clinical_rules.py` hiện tại là tập hợp ~15 hàm rời rạc. Mỗi hàm tự dò
keyword riêng để quyết định "bệnh nhân có X hay không" (ví dụ
`_is_mechanical_valve`), rồi áp thẳng ngưỡng cụ thể. Không có khái niệm
chung "bệnh nhân thuộc những nhóm bệnh cảnh nào" được tính một lần và
dùng lại cho mọi module. Hậu quả:

- Logic "nhận diện van cơ học" chỉ tồn tại bên trong `compute_cha2ds2_vasc`,
  không tái dùng được cho INR/TTR/care-gap dù cả 3 đều cần biết điều này.
- Thêm 1 bệnh cảnh mới (CAD, HF...) = viết thêm 1 hàm rời, không có khuôn
  chung → đúng như anh Tấn nói, sẽ tới hàng nghìn if/else.
- Frontend không biết "ẩn/hiện cái gì" theo nguyên tắc rõ ràng — đang suy
  ra từ `!= null`, không phải từ một cờ "applicable" tường minh.

## 2. Kiến trúc mới — 6 lớp

```
Patient JSON (từ Bước 1 - LLM extraction)
        │
        ▼
┌───────────────────┐
│ Layer 1            │  Patient Identification
│ Patient ID          │  tuổi, giới, chẩn đoán thô, ICD gợi ý, phẫu thuật
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Layer 2             │  Disease Classifier
│ Clinical Profiles    │  → trả về danh sách profile ĐANG KÍCH HOẠT
└───────────────────┘     (0..N profile cùng lúc, không chọn 1)
        │
        ▼
┌───────────────────┐
│ Layer 3             │  Applicable Indicators
│ (mỗi profile khai báo │  → mỗi profile active sẽ "mở khóa" đúng các
│  indicator của mình)  │     chỉ số/cảnh báo của nó, ẩn nếu không active
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Layer 4             │  Calculation Engine
│ Tính toán thuần      │  eGFR, TTR, CHA2DS2-VASc, HAS-BLED... (TÁI DÙNG
└───────────────────┘     nguyên các hàm cũ — chúng tính đúng, không cần
        │                 viết lại, chỉ cần BỌC lại theo profile)
        ▼
┌───────────────────┐
│ Layer 5             │  Clinical Rules
│ Ngưỡng → cảnh báo     │  So sánh kết quả Layer 4 với ngưỡng → tạo alert
└───────────────────┘     (mỗi rule gắn 1 profile + nguồn guideline)
        │
        ▼
┌───────────────────┐
│ Layer 6             │  Narrative Generator (LLM - Bước 3 cũ)
│ AI chỉ diễn đạt       │  Đọc JSON kết quả, KHÔNG tính toán, KHÔNG biết
└───────────────────┘     guideline. (đã đúng tinh thần này từ trước)
```

**Nguyên tắc bất biến giữ từ kiến trúc cũ (không đổi):**
- AI (LLM) không bao giờ tính toán/quyết định ngưỡng — giữ nguyên 100%.
- Mọi rule do Tấn/Ngân chốt trước khi code — giữ nguyên 100%.
- Layer 4 (Calculation) là code Python tất định, không qua LLM — giữ nguyên.

**Cái thay đổi:** thêm Layer 1-2-3 ở trước, để Layer 4-5 không còn tự dò
keyword riêng lẻ nữa mà NHẬN sẵn "profile nào đang active" từ Layer 2.

## 3. Data model

### 3.1. Clinical Profile (định nghĩa tĩnh, 1 file Python/JSON riêng mỗi profile)

```python
{
  "profile_id": "valve_disease",
  "ten_hien_thi": "Bệnh van tim",
  "dieu_kien_kich_hoat": {
    # Disease Classifier dùng để quyết định active hay không.
    # Có thể là keyword, hoặc icd_hint, hoặc cả hai.
    "keywords": ["van co hoc", "thay van", "sua van", "hep van", "ho van", "on-x", "st jude"],
    "icd_hints": ["I05", "I06", "I07", "I08", "I34", "I35", "I36", "I37"],
  },
  "subtypes": {
    # Phân loại chi tiết hơn TRONG profile (đúng góp ý "phải biết van cơ
    # học khác van sinh học khác sửa van")
    "mechanical": {"keywords": ["van co hoc", "on-x", "on x", "st jude"]},
    "bioprosthetic": {"keywords": ["van sinh hoc", "bioprosthetic"]},
    "repair": {"keywords": ["sua van", "khau van", "tao hinh van"]},
    "native_disease": {"keywords": ["hep van", "ho van"], "default": True},
  },
  "indicators": ["inr_target", "valve_gradient", "prosthetic_dysfunction"],
  # ^ chỉ những indicator này được "mở khóa" khi profile active
}
```

### 3.2. Indicator (định nghĩa applicability — Layer 3)

```python
{
  "indicator_id": "inr_target",
  "requires_profile": "valve_disease",
  "requires_subtype": ["mechanical"],   # CHỈ áp dụng khi subtype = mechanical
                                          # (không áp dụng cho native_disease/repair)
  "reference_range_fn": "valve.inr_target_for_subtype",  # tên hàm Layer 4
  "ten_hien_thi": "INR mục tiêu (van cơ học)",
}
```

Frontend/Layer 5 hỏi `is_applicable(indicator_id, active_profiles)` —
KHÔNG còn việc nào tự suy ra "hiện hay ẩn" theo `!= null` nữa. Nếu
`is_applicable` trả `False`, indicator không xuất hiện trong output —
không hiện "-" gây hiểu lầm thiếu dữ liệu.

### 3.3. Output tổng (Layer 2 → Layer 6)

```python
{
  "active_profiles": [
    {"profile_id": "valve_disease", "subtype": "mechanical", "confidence": "keyword_match"},
    {"profile_id": "atrial_fibrillation", "subtype": None, "confidence": "keyword_match"},
    {"profile_id": "ckd", "subtype": "stage_3b", "confidence": "calculated"},
  ],
  "indicators": {
    # CHỈ chứa indicator nào is_applicable() = True
    "inr_target": {...kết quả Layer 4-5...},
    "cha2ds2_vasc": {...},
    "egfr": {...},
  }
}
```

## 4. Quy tắc kích hoạt profile (Layer 2 — Disease Classifier)

```
FOR mỗi profile đã định nghĩa:
    IF keyword khớp (qua _text_has_any_positive, GIỮ NGUYÊN hàm chống
       false-positive đã có) HOẶC icd_hint khớp:
        active_profiles.append(profile)
        xác định subtype (nếu có khai báo subtypes, default nếu không
        khớp subtype nào nhưng profile vẫn active)
# KHÔNG return sớm — chạy hết toàn bộ danh sách profile, 1 bệnh nhân có
# thể thuộc nhiều profile cùng lúc (đúng yêu cầu cốt lõi của anh Tấn)
```

Một số profile có thể tự kích hoạt từ **kết quả tính toán** thay vì
keyword (ví dụ CKD active khi `eGFR < 90`, không cần bệnh nhân có chữ
"suy thận" trong chẩn đoán) — đây là lý do Layer 2 chạy SAU một phần nhỏ
của Layer 4 (eGFR phải tính trước để Disease Classifier biết CKD có active
không). Thứ tự thực thi thật:

```
Layer 1 → Layer 4 (chỉ các phép tính độc lập: eGFR...)
        → Layer 2 (dùng cả keyword + kết quả Layer 4 sơ bộ)
        → Layer 3 (lọc applicable theo active_profiles)
        → Layer 4 (phần còn lại: CHA2DS2-VASc, TTR... CHỈ tính nếu profile
                    liên quan active — tiết kiệm, đúng, không tính TTR cho
                    bệnh nhân không hề dùng kháng vitamin K)
        → Layer 5 (alert)
        → Layer 6 (LLM diễn đạt)
```

## 5. Nguyên tắc mở rộng (thêm 1 bệnh cảnh mới — ví dụ CAD)

1. Tạo file `profiles/cad.py` — khai báo điều kiện kích hoạt + indicators
   (LDL, DAPT...). KHÔNG sửa file nào khác.
2. Tạo file `indicators/cad_indicators.py` — khai báo applicability.
3. Viết hàm tính toán thuần trong `calculations/cad.py` (nếu cần công
   thức mới — ví dụ chưa có hàm tính thời gian DAPT còn lại).
4. Đăng ký profile mới vào `PROFILE_REGISTRY` (1 dòng).
5. KHÔNG đụng vào Valve/AF/CKD/profile khác — đây chính là điểm khác biệt
   với kiến trúc cũ (thêm bệnh cảnh mới không có nguy cơ vỡ logic cũ).

## 6. Phạm vi triển khai ngay (để có cái chạy được, không chỉ có giấy)

Vì deadline 14-15/07, KHÔNG làm hết 9+ profile như ví dụ minh họa của anh
Tấn ngay. Làm trước 3 profile có sẵn dữ liệu/logic migrate từ code cũ,
rủi ro thấp nhất:

| Profile | Nguồn migrate | Trạng thái |
|---|---|---|
| `valve_disease` | `_is_mechanical_valve`, phần "mechanical_valve" trong CHA2DS2-VASc, TTR (đang gắn cứng cho van) | **Xong — ngưỡng INR đầy đủ theo ESC/EACTS 2021 + AHA/ACC 2020** |
| `atrial_fibrillation` | `compute_cha2ds2_vasc`, `compute_has_bled` | Code ngay |
| `ckd` | `compute_egfr`, phần renal_flags trong `check_drug_safety` | Code ngay |

**Cập nhật (sau khi anh Tấn gửi bảng ngưỡng INR cụ thể):** module
`anticoagulation_targets.py` đã thay placeholder cũ, encode đầy đủ:
- Ngưỡng đơn giản cho sửa van / van sinh học / không liên quan van (đều
  2.0-3.0, 3 tháng đầu — trừ trường hợp không liên quan van thì suốt đời
  nếu có chỉ định, ưu tiên DOAC theo ESC 2024/AHA 2023).
- Van cơ học: phân tầng đầy đủ theo VỊ TRÍ van (ĐMC/hai lá/ba lá) × THẾ HỆ
  van (nguy cơ thấp/trung bình, nhận diện qua tên van) × YẾU TỐ NGUY CƠ
  (rung nhĩ, tiền sử thuyên tắc, LVEF<35%, hẹp hai lá kèm theo) — trả về
  CẢ 2 khuyến cáo ESC/EACTS và AHA/ACC song song (có ngoại lệ On-X riêng
  của AHA/ACC), không ép 1 khuyến cáo duy nhất.
- DOAC vs VKA: ẩn hoàn toàn INR/TTR khi bệnh nhân dùng DOAC, thay bằng
  thông báo trạng thái + nhắc theo dõi eGFR/CrCl.
- **Nguyên tắc minh bạch**: khi guideline chỉ ghi 1 điểm mục tiêu (không
  khoảng dao động — ví dụ van nguy cơ thấp không yếu tố nguy cơ = "2.5"),
  hệ thống KHÔNG tự suy diễn khoảng để tính TTR, báo rõ cần xác nhận thêm.
- **Bug nghiêm trọng đã phát hiện và sửa qua viết test**: toàn bộ hàm nhận
  diện văn bản dùng `.lower()` thay vì hàm bỏ dấu `_strip_accents()` có
  sẵn — khiến mọi văn bản tiếng Việt CÓ DẤU ("động mạch chủ", "rung nhĩ")
  không bao giờ khớp được. Đã sửa, có test hồi quy riêng
  (`test_anticoagulation_targets.py`, 18 test).

Các profile khác (CAD, HF, DM, HTN...) — **chưa code**, anh Tấn đã gửi
danh sách chỉ số/cảnh báo cho 4 nhóm bệnh (Valve/CAD/Arrhythmia/HF) trong
tài liệu riêng cho Vấn đề 2 — sẽ làm ở vòng sau.

`check_drug_safety` (tương tác thuốc, trùng nhóm) giữ là **cross-cutting
module riêng**, không gắn vào 1 profile — vì tương tác thuốc xảy ra giữa
thuốc của các profile khác nhau (ví dụ kháng vitamin K của Valve + NSAID
không thuộc profile nào cụ thể).

## 7. Việc KHÔNG đổi (để giảm rủi ro vỡ hệ thống đang chạy)

- Schema JSON output cuối (`evaluate()` trả gì cho `main.py`) — giữ
  tương thích ngược tối đa, chỉ THÊM field mới, không xóa field cũ.
  `App.jsx` (frontend) chưa cần sửa trong vòng này.
- `REPORT_SYSTEM` prompt (Bước 1, LLM extraction) — không đổi.
- Tất cả hàm tính toán thuần (`compute_egfr`, `compute_cha2ds2_vasc`,
  `compute_has_bled`, `compute_ttr`, `_text_has_any_positive`,
  `NEGATION_PHRASES`...) — giữ nguyên 100% logic, chỉ đổi NƠI chúng được
  gọi (từ gọi trực tiếp → gọi qua profile wrapper).
- 3 profile cũ (`valve_disease`, `atrial_fibrillation`, `ckd`) trong
  `disease_classifier.py` — giữ nguyên, dùng riêng cho logic ngưỡng INR
  (Vấn đề 1). `icd_groups.py` (Vấn đề 2) là lớp phân loại RỘNG HƠN, chạy
  song song, không thay thế 3 profile này.

## 8. VẤN ĐỀ 2 — Khung phân loại 10 nhóm ICD-10 + chỉ số chung + ưu tiên đa thuốc

Sau khi anh Tấn gửi khung phân loại bệnh cảnh tim mạch (dựa trên ICD-10 Bộ
Y tế VN: https://icd.kcb.vn/icd-10-tt06/icd10-tt06), đã mở rộng kiến trúc
thêm 3 module mới, KHÔNG đụng tới 3 profile cũ (valve/AF/CKD vẫn giữ
nguyên, dùng cho ngưỡng INR đã code ở Vấn đề 1):

### 8.1. `icd_groups.py` — 10 nhóm ICD-10 (I00 → I95)
Thay vì hard-code "ca van tim", giờ mọi hồ sơ được phân vào 0..N trong 10
nhóm bệnh hệ tuần hoàn (I00 thấp tim, I05 tim mạn do thấp, I10 THA, I20
mạch vành, I26 tim do phổi, I30 thể khác — gồm subtypes suy tim/rung
nhĩ/viêm nội tâm mạc/viêm màng ngoài tim/van tim không do thấp, I60 mạch
máu não, I70 động mạch, I80 tĩnh mạch, I95 rối loạn khác). Mỗi nhóm mang
đúng danh sách thang điểm đặc trưng riêng (GRACE/TIMI cho I20, NIHSS/mRS
cho I60, CEAP/VCSS cho I80...) — CHƯA tự tính các thang điểm này (cần dữ
liệu lâm sàng chi tiết hơn schema hiện có), chỉ mới phân loại đúng nhóm và
liệt kê thang điểm cần dùng.

**2 bug nghiêm trọng phát hiện qua viết test cho module này:**
- Keyword viết tắt `"tha"` (THA) khớp nhầm substring của "**THA**y van" —
  giả dương I10 cho MỌI bệnh nhân có chữ "thay van". Đã bỏ viết tắt ngắn
  nguy hiểm này (<4 ký tự luôn rủi ro cao với tiếng Việt không dấu).
- Subtype vừa có `default=True` vừa có `keywords` riêng (như
  `valve_disease_non_rheumatic`) bị `continue` ngay khi thấy default,
  KHÔNG BAO GIỜ kiểm tra keyword thật của chính nó — sửa lại thứ tự: luôn
  kiểm tra keyword trước, default chỉ là phương án cuối khi không gì khớp.

### 8.2. `universal_indicators.py` — chỉ số chung mọi bệnh nhân
5 nhóm theo đúng bảng anh Tấn: sinh hiệu-huyết động (phân loại HA theo ESC
2024: non-elevated/elevated/hypertension), yếu tố nguy cơ (hút thuốc, ĐTĐ,
THA, lipid, CKD, béo phì, tiền sử gia đình/ASCVD), ECG (khung field, chưa
tự tính — cần tích hợp sâu hơn ecg_engine.py), xét nghiệm nền (đối chiếu
nhóm xét nghiệm có/thiếu), SCORE2/SCORE2-OP (CHỈ kiểm tra đủ dữ liệu để
tính, KHÔNG tự tính công thức thật — cần Tấn/Ngân xác nhận hệ số hồi quy
phù hợp dân số VN trước khi code phần tính điểm).

### 8.3. `antithrombotic_priority.py` — ưu tiên đa thuốc (mục 10 anh Tấn)
Module cross-cutting (không gắn 1 profile cụ thể) encode nguyên tắc: KHÔNG
ưu tiên theo nhóm ICD, ưu tiên theo chỉ định cụ thể. Van cơ học = chỉ định
bắt buộc VKA suốt đời, KHÔNG được thay bằng DOAC/antiplatelet đơn độc.
Phối hợp VKA+1 antiplatelet = dual (warning nếu có PCI/ACS hợp lý hóa,
critical nếu không); VKA+2 antiplatelet = triple (luôn critical, kèm
danh sách 6 chỉ số cần theo dõi ưu tiên: INR, TTR, Hb, Hct, tiểu cầu, dấu
hiệu xuất huyết).

**1 bug nghiêm trọng phát hiện qua viết test:** `clinical_rules.resolve_generic()`
thiếu bước kiểm tra "tên thuốc đã viết generic trực tiếp" (ví dụ "Aspirin
81mg" không qua brand/ngoặc) — trả `None`, khiến MỌI rule tương tác/ưu tiên
liên quan các thuốc viết kiểu này (Aspirin, Clopidogrel viết trực tiếp)
không hoạt động từ trước tới giờ, không chỉ ảnh hưởng module mới. Đã sửa
ngay trong `clinical_rules.py`.

### 8.4. Phạm vi CHƯA làm (rõ ràng, không giả vờ đã xong)
- Thang điểm đặc trưng từng nhóm (Jones Criteria, Wilkins score, GRACE/TIMI,
  NIHSS, CEAP...) — đã liệt kê đúng trong `thang_diem_dac_trung` của từng
  nhóm ICD, nhưng CHƯA viết hàm tính toán thật (cần schema hồ sơ chi tiết
  hơn — ví dụ GRACE cần nhiều biến số chưa có field riêng).
- ECG universal fields — chưa tích hợp sâu với `ecg_engine.py` (Mức 3 vẫn
  đang chờ Tấn/Ngân xác nhận ngưỡng phân loại nhịp).
- SCORE2 — chỉ kiểm tra applicability, chưa tính điểm thật.
- App.jsx — CHƯA hiển thị field mới (`active_icd_groups`, `vital_signs`,
  `risk_factors`, `baseline_labs`, `score2_applicability`,
  `antithrombotic_priority`) — đây là việc frontend riêng, vòng sau.

- Schema JSON output cuối (`evaluate()` trả gì cho `main.py`) — giữ
  tương thích ngược tối đa, chỉ THÊM field `active_profiles`, không xóa
  field cũ ngay. `App.jsx` (frontend) chưa cần sửa trong vòng này.
- `REPORT_SYSTEM` prompt (Bước 1, LLM extraction) — không đổi.
- Tất cả hàm tính toán thuần (`compute_egfr`, `compute_cha2ds2_vasc`,
  `compute_has_bled`, `compute_ttr`, `_text_has_any_positive`,
  `NEGATION_PHRASES`...) — giữ nguyên 100% logic, chỉ đổi NƠI chúng được
  gọi (từ gọi trực tiếp → gọi qua profile wrapper).

---

## Bối cảnh — góp ý gốc của anh Tấn (tóm tắt)

> Đây không phải lỗi AI hay lỗi prompt, mà là lỗi Clinical Knowledge
> Architecture: team đang encode một CA BỆNH cụ thể thay vì encode KIẾN
> THỨC Y KHOA tổng quát. Cần Disease Classifier → Clinical Profiles →
> Applicable Indicators → Calculation Engine → Clinical Rules → Narrative
> Generator. Một bệnh nhân thuộc nhiều profile cùng lúc, mỗi profile chỉ
> quản kiến thức của riêng nó. Guideline không được viết trong Prompt.

Tài liệu này hiện thực hóa góp ý trên ở mức tối thiểu khả thi cho deadline
14-15/07, ưu tiên đúng kiến trúc hơn đúng tốc độ, nhưng giới hạn phạm vi
(3 profile, không phải 9+) để có sản phẩm chạy được kịp thi.
