# Thiết kế lại UI/UX — Cấu hình Universal Input (trang `/eng/inputs`)

**Mã:** UX-INPUT-REDESIGN-002
**Ngày:** 2026-08-14
**Trạng thái:** **Approved** — PM/CTO duyệt 2026-08-14, cho phép code Phase 1 ngay (xem §7 để có quyết định 3 câu hỏi mở, và §12 Nhật ký triển khai Phase 1)
**Nguồn dữ liệu:** đọc trực tiếp source tại thời điểm viết (nhánh `agent/programming-asbuilt-gap-report`), cộng ba tài liệu đã có:
[`REV-UI-CFG-GAP-2026-08-14`](../07_records/reviews/UI_UNIVERSAL_INPUT_FE_GAP_REPORT_2026-08-14.md) (gap 12 UC),
[`UX-INPUT-001`](UX_REDESIGN_INPUT_BRIEF_2026-08-08.md) (hồ sơ đầu vào UX toàn hệ thống),
[`CONFIG_SCHEMA_MK-DDC-24_VI.md`](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) §3 (schema `io_config.conf` — authority).

---

## 0. Đọc gì trước — 4 ràng buộc cứng, đừng vẽ ngược

1. **16 kênh cố định `UI-01..UI-16`, không thêm/bớt được.** Không thiết kế "add channel"/"remove channel".
2. **`PT100`/`PT1000` KHÔNG được thêm control chọn**, dù backend contract chấp nhận hai giá trị này (`configapi.go:508`). Đây là quyết định phần cứng đã chốt: mạch RTD 2-wire mux không đạt độ chính xác industrial, **không lắp trên Rev A** (`ADR-010`, `FR-011`, `HW-RISK-UI-16CH.md` mục `UI-R008`). Sensor Profile của Rev A chỉ có **NTC10k / NTC20k**. Nếu chọn hiện `PT100/PT1000` như "sắp có/Rev B" thì phải hỏi PM/CTO trước — mặc định thiết kế này **ẩn hẳn**, không hiện dạng disabled.
3. **Dry contact là chế độ phụ trợ không cách ly của một chân UI, không phải DI công nghiệp riêng** (`ADR-010`). Copy phải nói rõ điều này, không được vẽ như một DI an toàn/cách ly.
4. **D-07 — không bịa dữ liệu.** Quality chỉ có 5 giá trị thật (`good|uncertain|bad|stale|offline`); không tự suy ra "đứt dây"/"chập dây" khi backend không cấp thông tin đó. Thiếu dữ liệu → hiện `—`/"không rõ", không hiện 0 hay "OK".

Ba role thật: `viewer < operator < admin`. Route `/eng/inputs` hiện yêu cầu `admin` (as-built, `roles.ts:51-69`) — thiết kế này **giữ nguyên gate đó**; nới quyền là quyết định khác, nêu ở §11 chứ không tự quyết ở đây.

---

## 1. Mục tiêu và KHÔNG mục tiêu

### Đạt được bằng sửa FE thuần (không đổi API/Go/Core) — Phase 1

Vì `configapi.go` đã validate `type` 12 giá trị và `scale_lo`/`scale_hi` tuỳ ý (xem gap report Rev 1.1), các mục sau đóng được **chỉ bằng FE**:

- **UC-UI-02** — tách "Electrical Mode" khỏi "Sensor Profile" thành hai control riêng thay vì một enum `signalType` gộp.
- **UC-UI-03** — chọn được `NTC10k` / `NTC20k` (không phải chỉ "NTC" chung chung).
- **UC-UI-04** — làm rõ scaling hai điểm (raw → engineering) đã có sẵn (`scale_lo/scale_hi`) nhưng đang bị đặt tên mù mờ ("Display Min/Max").
- **UC-UI-06** — đổi nhãn tiếp điểm sang NO/NC quen thuộc, thêm cảnh báo "không cách ly".
- **UC-UI-10 (một phần)** — liên kết thẳng từ kênh UI sang Alarm Settings đã lọc theo kênh đó, thay vì phải tự đi tìm ở trang khác.
- **UC-UI-12 (một phần)** — làm rõ quality/badge trên panel chẩn đoán, đúng D-07.
- Vá bug tương thích ngược: giữ nguyên `unit`/`type` lạ mà FE chưa có control (đã vá trong code — xem CHANGELOG cùng ngày) và **hiển thị minh bạch** giá trị đó thay vì âm thầm nuốt.

### KHÔNG đạt được nếu chỉ sửa FE — cần Phase 2/3, cần PM/CTO + có thể HW

- **UC-UI-07 (debounce/min-on/min-off riêng cho dry contact)** — backend chỉ có `filter_samples` dùng chung; cần field mới + hành vi firmware mới.
- **UC-UI-08 (calibration gain/2-point, audit trail, reset factory)** — backend chỉ có `sensor_cal` offset đơn; cần schema mới.
- **UC-UI-09 (fault detection per-channel: open/short circuit, ngưỡng)** — Core chỉ có cờ over-range **gộp cả 16 kênh** (`IOP_FAULT_UI_OV`) + ADC comm fault; không có per-channel; phần này cần FW + Core + Go + FE, không chỉ FE.
- **UC-UI-10 (mở khoá alarm type 2/4/5/6/7)** — thuộc phạm vi Alarm runtime (Core), không thuộc trang Inputs; chỉ tham chiếu, không lên kế hoạch ở tài liệu này.
- **UC-UI-11 (COV threshold cho historian)** — backend chỉ log theo chu kỳ.

Không được để bản mockup/redesign ngụ ý các mục này "đã có" — mỗi tab dưới đây ghi rõ mục nào là Phase 1 (làm được ngay) và mục nào là placeholder Phase 2/3 (hiện dạng "Sắp có" trung thực, giống cách Alarm Settings đang làm với alarm type deferred).

---

## 2. Mô hình dữ liệu đích (không đổi API — chỉ đổi cách FE trình bày)

```text
AiInputConfig (FE, apps/web-ui/src/shared/types.ts)
├── channel, tag (immutable), label, enabled, note      → Header
├── signalType (0-8) ─┬─ hiện thành "Electrical Mode"    → Tab Điện & Cảm biến
│                     └─ khi signalType===3: thêm dropdown
│                        "Sensor Profile" đọc/ghi qua
│                        field MỚI ioType (NTC10k|NTC20k)
├── analogCurrent      → sub-toggle V/mA khi Electrical Mode = 2-10V/4-20mA
├── displayMin/Max     → hiện thành "Điểm cuối kỹ thuật" (đã là scale_lo/scale_hi)
├── rangeMultiplier    → gộp vào Tab Scaling, mặc định thu gọn (Advanced)
├── unit + ioUnit(MỚI) → dropdown 5 lựa chọn + chip "giá trị gốc" khi ioUnit
│                        không khớp lựa chọn nào (đã vá round-trip)
├── filterSamples      → Tab Xử lý tín hiệu, đổi label trung thực
├── sensorCal          → Tab Hiệu chuẩn, thêm helper tính offset
└── mathFunction        → Tab Xử lý tín hiệu, thêm danh sách kênh cùng nhóm
```

`ioType`/`ioUnit` đã thêm vào `AiInputConfig` trong bản vá bug cùng ngày
(`apps/web-ui/src/shared/types.ts`); Phase 1 chỉ cần **dùng** hai field này để
hiển thị Sensor Profile thật và unit gốc, không cần đổi lại data layer.

---

## 3. IA mới — bỏ 3 mode (Summary/Wizard/Advanced) tách rời, gộp thành Header cố định + 6 tab

Lý do đổi: 3 mode hiện tại tách biệt hoàn toàn (Summary có Live Data, Advanced có
bảng `u0..u7`, Wizard có 8 bước không liên quan tên field) khiến người dùng phải nhớ
cùng một khái niệm nằm ở 2-3 chỗ khác nhau. Cấu trúc mới dùng đúng ngôn ngữ của
báo cáo gap — mỗi tab tương ứng một layer:

```text
┌─────────────────────────────────────────────────────────────┐
│ UI-05 · Return Air Temp                      ● GOOD  [Lưu]  │  ← Header cố định
│ Raw: 6.42 kΩ   Value: 22.4 °C   Cập nhật: 2 giây trước       │  ← luôn hiển thị
├─────────────────────────────────────────────────────────────┤
│ [Điện & Cảm biến] [Scaling & Đơn vị] [Xử lý tín hiệu]        │  ← tab bar
│ [Hiệu chuẩn] [Cảnh báo & Lưu trữ] [Chẩn đoán]                │
├─────────────────────────────────────────────────────────────┤
│                     (nội dung tab đang chọn)                 │
└─────────────────────────────────────────────────────────────┘
```

**Wizard không bị xoá** — giữ làm luồng hướng dẫn tuỳ chọn ("Thiết lập nhanh") đi
qua đúng 6 tab theo thứ tự, dùng cho kênh mới `enabled=false` chưa cấu hình gì
(phát hiện qua `signalType===0`). Nút "Thiết lập nhanh" chỉ hiện khi kênh đang ở
trạng thái mặc định trống.

Bảng `u0..u7` không bị xoá — vẫn có giá trị cho kỹ thuật viên quen tài liệu
EasySet/thanh ghi cũ (`SW_ARCH_SPEC` gọi field theo đúng tên này) — thu gọn thành
một khối `<details>` "Xem theo thanh ghi (u0-u7)" ở cuối trang, read-only, không
còn là bề mặt sửa chính.

---

## 4. Đặc tả từng tab

### 4.1 Điện & Cảm biến (thay Advanced row `u0`/Wizard bước `signal`)

```text
Electrical Mode
● Không dùng   ○ Điện áp 0-10V   ○ Điện áp/dòng (2-10V hoặc 4-20mA)
○ Điện trở     ○ Tiếp điểm khô   ○ Biến trở   ○ Ánh sáng/chuyển động   ○ Đếm xung

[nếu = Điện áp/dòng]
  Chế độ tín hiệu    ● Volt (2-10V)   ○ Dòng (4-20mA)

[nếu = Điện trở]
  Sensor Profile      ● NTC10k   ○ NTC20k
  ⓘ PT100/PT1000 chưa lắp trên Rev A (ADR-010) — không chọn được ở đây.

[nếu = Tiếp điểm khô]
  Kiểu tiếp điểm      ● NO — Thường hở (Open contact direct)
                       ○ NC — Thường đóng (Open contact reversed)
  ⚠ Đây là chế độ phụ trợ KHÔNG cách ly của một chân UI, không phải DI công
    nghiệp an toàn. Không dùng cho tín hiệu an toàn/interlock quan trọng.
```

Validate: giữ nguyên rule cũ (`signalType===0` khoá `unit`/`mathFunction` về 0).
Chuyển `signalType` + `ioType` (Sensor Profile) cùng lúc khi submit; nếu người
dùng đổi Electrical Mode sang nhóm khác, `ioType` cũ bị bỏ (đúng hành vi
`signalTypeToIoType` đã vá — chỉ giữ `ioType` khi vẫn cùng nhóm resistance).

### 4.2 Scaling & Đơn vị (thay Wizard bước `min/max/range/unit`)

```text
Dải điện/tín hiệu vào        0 V ─────────────────── 10 V     (read-only, suy
                                                                 từ Electrical Mode)
Quy đổi sang kỹ thuật
  0 V  =  [   0  ]  ┐
 10 V  =  [ 500  ]  ┘  Pa                                     (scale_lo/scale_hi)

▸ Nâng cao: Hệ số dải (Range Multiplier)                       (thu gọn mặc định)
  ● x1 (-50..205)  ○ x10  ○ x100  ○ Căn bậc hai (cảm biến DP→lưu lượng) ...

Đơn vị kỹ thuật     [ Pa ▾ ]   (Không hiển thị / % / °C-°F / Pa / ppm)
  ⓘ Thiết bị đang lưu unit gốc "kPa" — chưa có trong danh sách trên. Chọn một
    giá trị ở trên sẽ THAY chuỗi này; để nguyên nếu không muốn đổi.
    (chỉ hiện khi ioUnit ≠ giá trị đang chọn — đúng phần vừa vá)
```

Đây là chỗ **quan trọng nhất để không lặp lại bug vừa vá**: nếu người dùng không
đụng vào Unit, submit phải giữ nguyên `ioUnit` gốc (logic đã có ở `client.ts`,
tab này chỉ cần KHÔNG tự ý set lại `unit` khi user không thao tác).

### 4.3 Xử lý tín hiệu (thay Wizard bước `filter`/`math`)

```text
Số mẫu lọc trung bình động   [ 5 ]  (0-100 mẫu)
  ⓘ Dùng chung cho cả tín hiệu số và tương tự. Chưa có debounce/thời gian tối
    thiểu ON-OFF riêng cho tiếp điểm — xem mục "Sắp có" cuối trang.

Hàm toán liên kênh    [ Không hoạt động ▾ ]  (Avg / Min / Max)
  Các kênh khác đang dùng cùng hàm: UI-03, UI-07
```

Dòng "các kênh khác đang dùng cùng hàm" tính từ state 16 kênh đã tải sẵn trong
trang — không cần API mới.

### 4.4 Hiệu chuẩn

```text
Offset hiện tại     [ +0.18 ]  °C   (-12.7..12.8)

Trợ giúp tính offset (chỉ tính tại FE, không tự ghi):
  Giá trị đang đọc     22.40  °C
  Giá trị chuẩn đo được [        ]  °C
  [ Tính offset ]  →  điền lại ô "Offset hiện tại" ở trên, người dùng tự bấm Lưu

ⓘ Chỉ hỗ trợ hiệu chuẩn 1 điểm (offset). Chưa có gain/2-point, chưa lưu ngày/
  người hiệu chuẩn, chưa có nút khôi phục mặc định — cần mở rộng backend
  (xem Phase 2 trong plan implement).
```

### 4.5 Cảnh báo & Lưu trữ (thay việc phải tự đi tìm ở trang khác)

```text
Alarm đang giám sát kênh này
  ALM-014  High/Low  HH=35°C  ·  Enabled              [ Sửa → ]
  (không có)                                          [ + Thêm alarm cho kênh này ]

Lưu trữ (Historian)
  <PointLoggingSection — giữ nguyên component hiện có>
```

`+ Thêm alarm cho kênh này` điều hướng sang `/eng/alarm-settings?newSource=UI:5`
— `AlarmSettingsPage` đọc query param này để tự thêm alarm mới với source đã
điền sẵn `{kind:'UI', channel:5}` (thay đổi nhỏ, thuộc Phase 1, không đổi API).

### 4.6 Chẩn đoán (thay "Live Data" trong Summary cũ)

```text
Value    22.4 °C          Quality  ● GOOD
Raw      6.42 kΩ           Cập nhật 2 giây trước
```

Khi quality khác `good`, hiện đúng `qualityReason` nếu producer có cấp (D-07),
không tự diễn giải "đứt dây"/"chập dây":

```text
Value    —                 Quality  ● BAD
Raw      12.1 V             qualityReason: "ADC1 fault" (nguyên văn producer)
ⓘ Bộ điều khiển hiện chỉ báo lỗi mức board (không phân biệt được kênh nào —
  IOP_FAULT_UI_OV gộp cả 16 kênh). Chẩn đoán từng kênh cần mở rộng firmware,
  xem Phase 3.
```

Giữ nguyên: chart trực tiếp, min/max/avg, ô Note (đang ở `AiSummary` cũ).

---

## 5. Bảng đổi nhãn (cũ → mới) và lý do

| Nhãn cũ | Nhãn mới | Lý do |
|---|---|---|
| "Signal Type" (`0 = Không hoạt động` … `8 = ...`) | "Electrical Mode" (7 lựa chọn, không đánh số) | Tách khỏi Sensor Profile; số thứ tự thanh ghi không có ý nghĩa với người cấu hình |
| "3 = NTC" | Sensor Profile: NTC10k / NTC20k | Đúng biến thể thật trên Rev A, không gộp |
| "Tiếp điểm hở trực tiếp/đảo" | "NO — Thường hở" / "NC — Thường đóng" | Thuật ngữ quen thuộc với thợ điện, giữ ánh xạ nội bộ y nguyên |
| "Display Min/Max" | "Quy đổi sang kỹ thuật" (0V=...) | Tên cũ không nói rõ đây là quy đổi 2 điểm raw→engineering |
| "Filter Samples" (nhãn ngầm hiểu là debounce cho digital) | "Số mẫu lọc trung bình động" + ghi chú rõ chưa có debounce riêng | Trung thực, không ngụ ý có tính năng chưa tồn tại |
| "Sensor Calibration" | "Hiệu chuẩn" + rõ "chỉ 1 điểm (offset)" | Tránh kỳ vọng sai về gain/2-point |
| (không có) | Banner "Chế độ phụ trợ không cách ly" khi chọn Dry Contact | ADR-010 — tránh hiểu nhầm thành DI công nghiệp |

---

## 6. Trạng thái không đổi (giữ để giảm rủi ro regression)

- `StateBlock` cho loading/error (đã đúng theo FE-DATA-02) — giữ nguyên.
- `PointNameConflictNotice`, `PointLoggingSection` — giữ nguyên, chỉ đổi vị trí sang tab 4.5.
- Route gate `/eng/inputs` = `admin` — giữ nguyên trong Phase 1.
- API `GET/PUT /api/v1/system/config/io` — không đổi field, không đổi payload shape.
- `InputsOverviewModal` (bảng tổng quan 16 kênh) — giữ nguyên, chỉ cập nhật cột "Signal" để hiện Electrical Mode + Sensor Profile thay vì số.

---

## 7. Câu hỏi cần PM/CTO/UX Lead chốt trước khi code Phase 1

1. **`+ Thêm alarm cho kênh này` có chấp nhận đổi `AlarmSettingsPage` đọc query param mới không?** Đây là thay đổi nhỏ nhưng đụng vào trang khác — cần xác nhận không phá luồng điều hướng hiện có.
2. **Ẩn hẳn hay hiện "sắp có" cho debounce riêng / calibration gain / fault detection per-channel?** Đề xuất trong tài liệu này là ẩn hẳn (không quảng cáo tính năng chưa có), nhưng nếu team muốn định vị roadmap rõ ràng hơn cho khách hàng thì cần quyết định cách hiện "Sắp có" nhất quán (giống mẫu Alarm Settings đã làm với type deferred).
3. **Có mở rộng route `/eng/inputs` cho `operator`/`viewer` xem read-only không?** Ngoài phạm vi tài liệu này; nếu có sẽ ảnh hưởng cách thiết kế nút Lưu/khoá field theo role (pattern đã dùng ở Modbus RTU).

Không câu hỏi nào ở trên chặn việc bắt đầu Phase 1 phần không phụ thuộc (VD:
đổi nhãn, tách Electrical Mode/Sensor Profile, tab Scaling) — chỉ chặn đúng ba
hạng mục liệt kê.

### Quyết định PM/CTO 2026-08-14 (chốt cả 3 câu hỏi, mở khoá Phase 1 toàn bộ)

| # | Câu hỏi | Quyết định | Lý do |
|---|---|---|---|
| 1 | `AlarmSettingsPage` đọc query param mới? | **Đồng ý** — nhận cả `newSource` (thêm alarm mới, source điền sẵn) và `edit` (chọn sẵn alarm có ID trùng khi mở trang, dùng chung cho nút "Sửa →" ở tab 4.5) | Thay đổi nhỏ, chỉ đọc thêm query param tuỳ chọn lúc mount, không phá luồng điều hướng/chọn dòng thủ công hiện có |
| 2 | Ẩn hẳn hay hiện "Sắp có" cho debounce riêng/calibration gain/fault detection per-channel? | **Ẩn hẳn** (theo đề xuất mặc định của tài liệu này) | Tránh quảng cáo tính năng chưa tồn tại; ghi chú giới hạn bằng copy trung thực ngay tại chỗ (vd "Chỉ hỗ trợ hiệu chuẩn 1 điểm") thay vì nhãn "Sắp có" rời rạc |
| 3 | Mở rộng route `/eng/inputs` cho `operator`/`viewer`? | **Không** — giữ nguyên gate `admin` trong Phase 1 | Ngoài phạm vi redesign này; nới quyền cần xét riêng ảnh hưởng khoá field theo role, để lại cho một quyết định khác |

Cả ba quyết định trên áp dụng cho Phase 1 implement — xem Nhật ký triển khai
ở §12.

---

## 12. Nhật ký triển khai Phase 1 (2026-08-14)

Toàn bộ 13 task Phase 1 của
[Plan 55](../03_implementation/55_UI_UNIVERSAL_INPUT_REDESIGN_PLAN.md) đã
triển khai trong cùng phiên duyệt thiết kế này — xem plan để có bảng
task→file→acceptance criteria→trạng thái chi tiết và số đo kiểm chứng thật.
