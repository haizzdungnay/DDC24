# Modbus RTU — UI/UX Design (Web) DDC-24 Rev A

**ID:** UX-WEB-MBRTU-001
**Phiên bản:** 0.1
**Trạng thái:** In Review
**Ngày:** 2026-08-04
**Chủ quản đề xuất:** UX Lead + Product Owner
**Trace ngược:** [PROD-MBRTU-001](../01_product/MODBUS_RTU_PRODUCT_REQUIREMENTS.md) `UC-MBRTU-001..018`
**Trace xuôi:** [DDD-FE-MBRTU-001](../02_design/software/MODBUS_RTU_FE_DESIGN.md),
[ICD-API-MBRTU-001](../02_design/interfaces/MODBUS_RTU_API_SPEC.md)

> Wireframe dưới đây là **layout intent** dạng ASCII, không phải asset thiết kế
> pixel-perfect. Token màu/spacing lấy từ `apps/web-ui/src/shared/theme/tokens.ts`;
> tài liệu này không định nghĩa token mới.

## 1. Nguyên tắc chung cho cả năm page

| Nguyên tắc | Diễn giải bắt buộc |
|---|---|
| Authority-first | Mọi số liệu hiển thị phải đến từ API. Không có số liệu ⇒ hiện `—` hoặc `unknown`, **không** hiện `0` và **không** hiện `Online`. |
| Không suy diễn quality | FE không tính `quality` từ `online`/`consecutive_errors`. Quality và reason đến từ authority. |
| Candidate rõ ràng | Sửa cấu hình là sửa **candidate**. Người dùng phải thấy "có thay đổi chưa apply" và nút Apply/Discard tách bạch. |
| Xác nhận khi nguy hiểm | Mọi hành động ghi register, xoá và apply đều có hộp thoại nêu đích danh đối tượng. |
| Hiển thị đơn vị và convention | Address luôn kèm nhãn `zero-based`; nếu hiện `4xxxx` phải ghi rõ là reference. |
| Trạng thái đầy đủ | Mỗi vùng dữ liệu phải có bốn state: loading, empty, error, offline. |
| Không khoá bàn phím | Mọi control có label liên kết, focus ring rõ, thao tác được bằng bàn phím. |

### 1.1 Điều hướng

```text
Engineering
└── Modbus RTU
    ├── Overview        /eng/modbus-rtu                (mặc định)
    ├── Devices         /eng/modbus-rtu/devices
    ├── Points          /eng/modbus-rtu/points
    ├── Mapping         /eng/modbus-rtu/mapping
    └── Diagnostics     /eng/modbus-rtu/diagnostics
```

Hiện tại menu chỉ có một mục `/eng/modbus-rtu` với route min-role `admin`. Thiết kế
này tách năm route và **hạ min-role xuống `viewer`** cho Overview/Devices/Points/
Diagnostics; mutation vẫn do server chặn. Lý do: Viewer phải giám sát được theo
`PR-MBRTU-001`/`PR-MBRTU-007`, nhưng hiện Viewer không vào được trang. Đây là gap
`G-UX-01` và cần `OD-MBRTU-009`.

### 1.2 Banner trạng thái cấu hình (dùng lại ở cả năm page)

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ● Active rev 42 · checksum 9f3a…c1  |  ⚠ Candidate rev 43 có 3 thay đổi │
│   [Xem khác biệt]  [Apply cấu hình]  [Huỷ candidate]                     │
└──────────────────────────────────────────────────────────────────────────┘
```

- Không có candidate ⇒ banner rút gọn còn dòng `Active rev N`.
- Đang apply ⇒ banner chuyển spinner + text `Đang áp dụng… chờ iobus xác nhận`.
- Apply lỗi ⇒ banner đỏ, giữ nguyên `Active rev N`, hiện mã lỗi và nút `Thử lại`.

---

## 2. Page A — Modbus RTU Overview

**Mục tiêu:** trả lời trong 5 giây: hệ Modbus RTU có khoẻ không, hỏng ở đâu.

**User role:** Viewer trở lên (chỉ đọc).

**Workflow:** vào trang → đọc 4 KPI → nhìn hai thẻ bus → nếu có bất thường thì bấm
vào thẻ bus hoặc dòng sự kiện để nhảy sang Devices/Diagnostics đã lọc sẵn.

### 2.1 Layout

```text
┌ Modbus RTU · Tổng quan ─────────────────────────────── [Làm mới] [Tự động ⟳ 5s] ┐
│ [Banner trạng thái cấu hình]                                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│ ┌ Tổng Device ─┐ ┌ Online ──┐ ┌ Offline ─┐ ┌ Fault/Config ┐                     │
│ │      12      │ │    9     │ │    2     │ │      1       │                     │
│ └──────────────┘ └──────────┘ └──────────┘ └──────────────┘                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│ ┌ RS485-1 ───────────────────────┐ ┌ RS485-2 ───────────────────────┐          │
│ │ ● OPEN  19200 8N1              │ │ ○ UNAVAILABLE                  │          │
│ │ Device 8 (7 online)            │ │ Device 4 (2 online)            │          │
│ │ Poll latency  p50 24 ms        │ │ Poll latency  —                │          │
│ │               p95 61 ms        │ │               —                │          │
│ │ Timeout 12 · CRC 0             │ │ Timeout — · CRC —              │          │
│ │ Bus utilization  38 % (ước tính)│ │ —                              │          │
│ │ [Xem thiết bị]                  │ │ ⚠ Cổng chưa có capability      │          │
│ └────────────────────────────────┘ └────────────────────────────────┘          │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Sự kiện giao tiếp gần đây                                    [Xem tất cả →]     │
│ 10:41:02  RS485-1  MTR-01   OFFLINE → ONLINE                                    │
│ 10:38:55  RS485-1  VFD-03   TIMEOUT (3 liên tiếp)                               │
│ 10:31:10  RS485-2  —        PORT_DOWN: không mở được cổng                       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component và field

| Component | Field | Nguồn | Định dạng |
|---|---|---|---|
| KPI card ×4 | tổng/online/offline/fault | `GET /modbus/overview` | số nguyên; `—` nếu thiếu |
| Bus card ×2 | `bus_id`, `open_state`, serial, số device, latency p50/p95, timeout, CRC, utilization | `GET /modbus/overview` | latency ms 0 chữ số thập phân; utilization % có nhãn `(ước tính)` |
| Event feed | thời gian, bus, device, sự kiện | `GET /modbus/events?limit=10` | thời gian local, tooltip UTC |

`Bus utilization` **luôn** kèm chữ `(ước tính)` vì là giá trị tính toán từ baud và
kích thước frame, không phải đo trên dây.

### 2.3 State

| State | Thể hiện |
|---|---|
| Loading | skeleton cho 4 KPI + 2 bus card; không hiện `0` |
| Empty | "Chưa cấu hình Modbus RTU Device nào." + nút `Thêm thiết bị` (Engineer+) |
| Error | banner đỏ + mã lỗi + `Thử lại`; giữ dữ liệu cũ kèm nhãn `dữ liệu lúc HH:mm` |
| Offline (mất telemetry) | mọi số đo → `—`, bus card viền xám, dòng `iobus chưa publish telemetry` |

### 2.4 Acceptance criteria

- AC-A1: khi API trả 503, không ô số nào hiển thị `0`; tất cả là `—`.
- AC-A2: khi một bus `unavailable`, thẻ bus đó không hiện latency/CRC giả.
- AC-A3: tổng `online + offline + fault + disabled` = tổng Device.
- AC-A4: bấm KPI `Offline` mở Devices với filter `connection_status=OFFLINE`.
- AC-A5: auto-refresh mặc định 5 s, tắt được, và dừng khi tab ẩn.

---

## 3. Page B — Modbus Device Manager

**Mục tiêu:** quản lý vòng đời Device và tham số bus/serial.

**User role:** xem = Viewer; thêm/sửa/xoá/enable/apply = Engineer; test connection = Operator.

**Workflow:** chọn bus (tab) → xem danh sách → `Thêm`/`Sửa` mở drawer form →
`Lưu vào candidate` → banner báo có thay đổi → `Test kết nối` (tuỳ chọn) →
`Apply cấu hình` → chờ ACK → danh sách cập nhật `connection_status`.

### 3.1 Layout

```text
┌ Modbus RTU · Thiết bị ──────────────────── [+ Thêm thiết bị] [Import] [Export] ┐
│ [Banner trạng thái cấu hình]                                                   │
│ ( Tất cả | RS485-1 | RS485-2 )     Lọc: [trạng thái ▾] [tìm tên/slave…]        │
├────────────────────────────────────────────────────────────────────────────────┤
│ □ │ Tên          │ Bus     │ Slave │ Serial   │ Poll/TO/Retry │ Trạng thái │ ⋯ │
│ □ │ MTR-01       │ RS485-1 │   1   │ 19200 8N1│ 1000/300/2    │ ● ONLINE   │ ⋯ │
│ □ │ VFD-03       │ RS485-1 │   3   │ 19200 8N1│ 1000/300/2    │ ◐ DEGRADED │ ⋯ │
│ □ │ PM-07        │ RS485-2 │   7   │ 9600 8E1 │ 2000/500/1    │ ○ OFFLINE  │ ⋯ │
│ □ │ TEST-09      │ RS485-2 │   9   │ 9600 8E1 │ 1000/300/2    │ ⊘ DISABLED │ ⋯ │
│ □ │ BAD-11       │ RS485-1 │  11   │ —        │ —             │ ▲ CONFIG   │ ⋯ │
├────────────────────────────────────────────────────────────────────────────────┤
│ Đã chọn 2  [Enable] [Disable] [Xoá]                        1–5 / 12   ◀ 1 2 ▶ │
└────────────────────────────────────────────────────────────────────────────────┘

Drawer "Sửa thiết bị MTR-01"
┌──────────────────────────────────────────────────────────┐
│ Device ID  MTR-01            (không đổi được)             │
│ Tên hiển thị   [Đồng hồ điện tầng 1        ]              │
│ Bus            (•) RS485-1   ( ) RS485-2                  │
│ Slave ID       [1    ]  1..247, unique trong bus          │
│ ── Tham số serial (thuộc bus, áp dụng cho mọi thiết bị) ──│
│ Baud [19200 ▾] Data bit [8] (cố định) Parity [N ▾]        │
│ Stop bit [1 ▾]                                            │
│ ⓘ Đổi tham số serial ảnh hưởng toàn bộ thiết bị trên      │
│   RS485-1 (8 thiết bị).                                   │
│ ── Chu kỳ ────────────────────────────────────────────────│
│ Poll interval [1000] ms   Timeout [300] ms  Retry [2]     │
│ Stale sau [3000] ms       Offline sau [6000] ms           │
│ [x] Enabled     [x] Readback sau khi ghi                  │
│                                                           │
│ [Test kết nối]        [Huỷ]  [Lưu vào candidate]          │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Field và validation (client-side, phản chiếu server)

| Field | Ràng buộc UI | Thông báo lỗi |
|---|---|---|
| `display_name` | 1..64, trim | "Tên thiết bị không được để trống." |
| `bus_id` | radio 2 lựa chọn; bus `unavailable` bị disable kèm tooltip | "RS485-2 chưa có capability trên phần cứng này." |
| `slave_id` | số nguyên 1..247; kiểm trùng trong cùng bus ngay khi nhập | "Slave ID 3 đã được VFD-03 dùng trên RS485-1." |
| `baud/parity/stop` | select; đổi giá trị hiện cảnh báo phạm vi bus | "Thay đổi này áp dụng cho 8 thiết bị trên RS485-1." |
| `data_bits` | luôn `8`, disabled | tooltip "Modbus RTU cố định 8 data bit." |
| `poll_interval_ms` | 100..60000 | "Poll interval phải trong 100–60000 ms." |
| `timeout_ms` | 20..5000 và `< poll_interval_ms` | "Timeout phải nhỏ hơn poll interval." |
| `retry_count` | 0..3 | "Retry phải trong 0–3." |
| `stale_after_ms` | `≥ poll + timeout` | "Stale phải ≥ poll + timeout (1300 ms)." |
| `offline_after_ms` | `> stale_after_ms` | "Offline phải lớn hơn stale." |

Validation client là **trợ giúp**, không phải authority: server luôn validate lại và
FE phải hiển thị được lỗi server theo `path` trả về.

### 3.3 Trạng thái Device hiển thị

| Trạng thái | Ký hiệu | Màu | Tooltip |
|---|---|---|---|
| `ONLINE` | ● | success | "Lần đọc thành công gần nhất: HH:mm:ss" |
| `DEGRADED` | ◐ | warning | "Dữ liệu cũ hơn ngưỡng stale." |
| `OFFLINE` | ○ | danger | "Không đọc được từ HH:mm:ss. Đang thử lại mỗi 5 s." |
| `DISABLED` | ⊘ | neutral | "Thiết bị bị tắt, không chiếm băng thông bus." |
| `CONFIG_ERROR` | ▲ | danger | lý do cụ thể, ví dụ "Không tìm thấy profile" |
| `INITIALIZING` | ◌ | info | "Đang chờ lần đọc thành công đầu tiên." |

### 3.4 Test kết nối (UC-MBRTU-008)

```text
┌ Test kết nối · MTR-01 ────────────────────────────┐
│ Bus RS485-1 · Slave 1 · 19200 8N1                 │
│ Phép thử: đọc 1 register tại địa chỉ [0    ]      │
│ ⓘ Thao tác này chỉ ĐỌC, không thay đổi cấu hình.  │
│                          [Huỷ]  [Chạy test]       │
├───────────────────────────────────────────────────┤
│ Kết quả: ✔ Phản hồi sau 21 ms                     │
│ Raw 0x04D2 (1234) · CRC OK · retry 0              │
└───────────────────────────────────────────────────┘
```

Kết quả thất bại phải nói rõ **loại** lỗi: `TIMEOUT` ("thiết bị không trả lời — kiểm
tra dây, slave ID, baud"), `CRC_ERROR` ("khung lỗi — kiểm tra nhiễu/termination"),
`DEVICE_EXCEPTION 02` ("thiết bị từ chối địa chỉ register"), `PORT_UNAVAILABLE`.

### 3.5 API được gọi

`GET /modbus/config`, `GET /modbus/devices`, `POST/PUT/DELETE /modbus/devices*`,
`POST /modbus/devices/{id}/enabled`, `POST /modbus/devices/{id}/test-connection`,
`POST /modbus/config/apply`, `POST /modbus/config/rollback`.

### 3.6 Acceptance criteria

- AC-B1: Viewer thấy danh sách nhưng mọi nút mutation bị disable kèm lý do quyền.
- AC-B2: nhập slave ID trùng ⇒ lỗi inline trước khi gọi API.
- AC-B3: `Lưu vào candidate` **không** làm iobus restart; chỉ `Apply` mới làm.
- AC-B4: Apply thất bại ⇒ danh sách vẫn hiển thị cấu hình `Active rev N` cũ.
- AC-B5: xoá Device còn Point ⇒ hộp thoại liệt kê Point và chặn, không xoá ngầm.
- AC-B6: `Test kết nối` không tạo revision mới và không xuất hiện trong candidate diff.

---

## 4. Page C — Modbus Point Manager

**Mục tiêu:** khai báo register map và quan sát giá trị thật của từng Point.

**User role:** xem = Viewer; CRUD/import/export = Engineer; read test = Operator; write test = Admin.

**Workflow:** chọn Device (dropdown/tab) → xem bảng Point → `Thêm Point` hoặc `Sửa`
→ `Lưu vào candidate` → `Apply` → quan sát cột Value/Quality/Timestamp cập nhật.

### 4.1 Layout

```text
┌ Modbus RTU · Điểm ──── Thiết bị: [MTR-01 ▾] ─ [+ Thêm Point] [Import CSV] [Export ▾] ┐
│ [Banner trạng thái cấu hình]                                                          │
│ Lọc: [register type ▾] [quality ▾] [tìm tag/tên…]                                     │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ Tag / Point ID │ Register        │ Kiểu        │ Scale·Offset │ Value    │ Quality │ ⋯│
│ MTR1.kWh       │ holding @0x0064 │ float32     │ ×0.1 +0      │ 1 234,5  │ ● GOOD  │ ⋯│
│ MB-7F2A1C09    │ (4-00101 ref)   │ big/high_low│ kWh          │ 10:41:02 │         │  │
│────────────────┼─────────────────┼─────────────┼──────────────┼──────────┼─────────┼──│
│ MTR1.Run       │ coil @0x0000    │ bool        │ —            │ TRUE     │ ◐ STALE │ ⋯│
│ MB-8A31D5B2    │ (0-00001 ref)   │ R/W         │              │ 10:38:55 │ TIMEOUT │  │
│────────────────┼─────────────────┼─────────────┼──────────────┼──────────┼─────────┼──│
│ MTR1.Alarm     │ holding @0x0010 │ bool bit 3  │ —            │ —        │ ▲ CONFIG│ ⋯│
│ MB-11C0FE44    │                 │             │              │ —        │ overlap │  │
├───────────────────────────────────────────────────────────────────────────────────────┤
│                                                       1–3 / 24    ◀ 1 2 3 ▶          │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

Mỗi hàng chiếm hai dòng: dòng trên là dữ liệu chính, dòng dưới là ID/reference/
timestamp/reason. Cách này giữ được đủ 12 thuộc tính mà không cần cuộn ngang.

### 4.2 Form Point

```text
┌ Sửa Point · MTR1.kWh ─────────────────────────────────────────┐
│ Point ID   MB-7F2A1C09              (không đổi được)          │
│ Thiết bị   [MTR-01 ▾]                                         │
│ Tag name   [MTR1.kWh          ]  unique toàn hệ thống         │
│ Tên hiển thị [Điện năng tổng   ]                              │
│ ── Register ──────────────────────────────────────────────────│
│ Loại   [Holding Register ▾]                                   │
│ Địa chỉ [100   ] zero-based   ⓘ tham chiếu hiển thị: 4-00101  │
│ Bit index [—   ] chỉ dùng cho bool trích từ word              │
│ Kiểu dữ liệu [float32 ▾]                                      │
│ Byte order [Big ▾]   Word order [High→Low ▾]                  │
│ Quyền  ( ) Read   (•) Read/Write                              │
│ ── Kỹ thuật ──────────────────────────────────────────────────│
│ Scale [0.1  ]  Offset [0    ]  Đơn vị [kWh   ]                │
│ Min [0      ]  Max [999999]  (tuỳ chọn, dùng cho ghi + range) │
│ Poll riêng [—     ] ms (bỏ trống = theo thiết bị 1000 ms)     │
│ Default [0   ]  Safe [—    ]                                  │
│ [x] Enabled                                                   │
│ ── Xem trước ─────────────────────────────────────────────────│
│ Chiếm 2 register: 100–101. Không chồng lấn Point khác. ✔      │
│ raw 12345 → engineering 1 234,5 kWh                           │
│                                                               │
│ [Đọc thử]  [Ghi thử]        [Huỷ]  [Lưu vào candidate]        │
└───────────────────────────────────────────────────────────────┘
```

Khối **Xem trước** là bắt buộc: nó hiển thị dải register bị chiếm, kết quả kiểm tra
overlap và một phép quy đổi mẫu. Đây là cách rẻ nhất để chặn lỗi register map trước
khi ra hiện trường.

### 4.3 Đọc thử / Ghi thử

```text
Đọc thử (Operator+)              Ghi thử (Admin) — hai bước
┌────────────────────────┐       ┌ Bước 1 ─────────────────────────────┐
│ Kết quả: raw 12345     │       │ Giá trị hiện tại  1 234,5 kWh       │
│ engineering 1 234,5 kWh│       │ Giá trị mới      [1300     ] kWh    │
│ 21 ms · CRC OK         │       │ Giới hạn 0 … 999999                 │
└────────────────────────┘       │                  [Huỷ] [Tiếp tục]   │
                                 ├ Bước 2 — xác nhận ──────────────────┤
                                 │ ⚠ Ghi vào thiết bị thật             │
                                 │ MTR-01 · RS485-1 · slave 1          │
                                 │ Holding 100 (4-00101), float32      │
                                 │ 1 234,5 → 1 300,0 kWh               │
                                 │ Hành động được ghi audit.           │
                                 │            [Huỷ] [Xác nhận ghi]     │
                                 └─────────────────────────────────────┘
```

Nút `Ghi thử` bị **disable** khi: Point `read`, quality không phải `GOOD`, Device
không `ONLINE`, hoặc có candidate chưa apply. Mỗi lý do hiện thành tooltip riêng —
không dùng một câu chung.

### 4.4 Import/Export

- `Import CSV`: chọn file → **preview** bảng thay đổi (thêm N, sửa M, lỗi K) →
  chỉ khi `K=0` mới bật nút `Nạp vào candidate`. Lỗi hiển thị theo dòng và cột.
- `Export ▾`: `CSV (điểm)` hoặc `JSON (toàn bộ cấu hình)`; tên file
  `modbus-rtu-points-rev<N>-<YYYYMMDD>.csv`.
- Import không bao giờ apply trực tiếp; luôn qua candidate.

### 4.5 State

| State | Thể hiện |
|---|---|
| Loading | skeleton 5 hàng |
| Empty (chưa có device) | "Hãy tạo Modbus RTU Device trước." + link sang Devices |
| Empty (device chưa có point) | "Thiết bị này chưa có Point." + nút `Thêm Point` |
| Error | banner + giữ bảng cũ có nhãn thời điểm |
| Offline runtime | cột Value/Quality/Timestamp → `—`, badge `Không có telemetry` |

### 4.6 Acceptance criteria

- AC-C1: cột Value chỉ hiện số khi `quality ∈ {GOOD, STALE, OFFLINE}`; `BAD`/`CONFIG_ERROR` hiện `—`.
- AC-C2: `STALE`/`OFFLINE` hiện giá trị cuối kèm timestamp cũ và nhãn rõ ràng, không đổi màu như GOOD.
- AC-C3: đổi `data_type` sang 32-bit tự cập nhật khối Xem trước thành 2 register và chạy lại kiểm tra overlap.
- AC-C4: register overlap không lưu được vào candidate.
- AC-C5: `Ghi thử` yêu cầu đúng hai bước xác nhận và hiện giá trị cũ → mới.
- AC-C6: import file có 1 dòng lỗi ⇒ không dòng nào được nạp.
- AC-C7: đổi `tag_name` không đổi `point_id` hiển thị.

---

## 5. Page D — Point Mapping

**Mục tiêu:** xác nhận Modbus RTU Point đã vào Point Database DDC-24 đúng và không xung đột.

**User role:** xem = Viewer; sửa mapping = Engineer.

**Workflow:** vào trang → xem trạng thái mapping của mọi Point → sửa tag/DDC Point ID
ở các dòng cảnh báo → `Kiểm tra lại` → `Lưu vào candidate` → `Apply`.

### 5.1 Layout

```text
┌ Modbus RTU · Ánh xạ Point ────────────────── [Kiểm tra lại] [Lưu vào candidate] ┐
│ Tổng 24 Point · ✔ Hợp lệ 21 · ⚠ Cảnh báo 1 · ✖ Lỗi 2                            │
│ Lọc: (•) Tất cả ( ) Chỉ lỗi ( ) Chỉ cảnh báo                                     │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Modbus Point        │ Kiểu    │ → DDC Point ID │ Tag name      │ Trạng thái      │
│ MTR-01 / holding100 │ float32 │ MB-7F2A1C09    │ MTR1.kWh      │ ✔ Đã ánh xạ     │
│ MTR-01 / coil0      │ bool    │ MB-8A31D5B2    │ MTR1.Run      │ ✔ Đã ánh xạ     │
│ VFD-03 / holding20  │ int16   │ MB-3C77A180    │ AHU1.Speed    │ ✖ Tag trùng     │
│                     │         │                │               │   với UI-05     │
│ PM-07 / input40     │ uint32  │ MB-91B2E0C4    │ PM7.Total     │ ✖ Kiểu không    │
│                     │         │                │               │   tương thích   │
│ PM-07 / holding9    │ float32 │ MB-55D0AA31    │ PM7.Temp      │ ⚠ Chưa enabled  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Luật kiểm tra hiển thị

| Kiểm tra | Kết quả | Hành vi UI |
|---|---|---|
| Tag unique toàn namespace (Local I/O + Virtual + Modbus RTU) | ✖ nếu trùng | chỉ rõ Point đang giữ tag và đường dẫn cấu hình của nó |
| `data_type` ↔ Point Database type | ✖ nếu không biểu diễn được | nêu cặp kiểu và lý do (ví dụ `uint32` không vào được slot `float` hiện tại) |
| Point ID ổn định | ✖ nếu payload cố đổi | "Point ID không được thay đổi." |
| Point `enabled=false` | ⚠ | "Point tồn tại nhưng không được poll." |
| Device `enabled=false` | ⚠ | "Thiết bị đang tắt." |
| Vượt capacity 64 Point | ✖ | "Vượt giới hạn 64 Modbus RTU Point." |

**Nút `Lưu vào candidate` bị disable khi còn bất kỳ dòng ✖.** Đây là yêu cầu tường
minh của `PR-MBRTU-010`: không cho lưu mapping không hợp lệ.

### 5.3 Acceptance criteria

- AC-D1: còn ✖ ⇒ không lưu được, và nút disable có tooltip nêu số lỗi.
- AC-D2: mỗi ✖ chỉ đích danh đối tượng xung đột, không dùng thông báo chung chung.
- AC-D3: sửa tag xong bấm `Kiểm tra lại` cập nhật trạng thái mà không mất chỉnh sửa khác.
- AC-D4: mapping hợp lệ nhưng Point disabled hiện ⚠, không hiện ✔.

---

## 6. Page E — Diagnostics

**Mục tiêu:** khoanh vùng nguyên nhân lỗi giao tiếp bằng số liệu, không bằng phỏng đoán.

**User role:** Viewer trở lên (chỉ đọc). Nút `Reset counter` (nếu mở) là Admin — hiện chưa thiết kế, xem `OD-MBRTU-008`.

### 6.1 Layout

```text
┌ Modbus RTU · Chẩn đoán ────────────── [Làm mới] [Tự động ⟳ 5s] [Xuất CSV] ┐
│ Bus: ( Tất cả | RS485-1 | RS485-2 )                                        │
├────────────────────────────────────────────────────────────────────────────┤
│ ┌ RS485-1 ────────────────────────────────────────────────────────────────┐│
│ │ open · 19200 8N1 · tx 128 430 · rx 128 002 · CRC 0 · timeout 12         ││
│ │ scheduler overrun 3 · utilization 38 % (ước tính) · reconnect 0         ││
│ │ boot id 4f2c… · counters từ 2026-08-04 06:12:03                         ││
│ └─────────────────────────────────────────────────────────────────────────┘│
├────────────────────────────────────────────────────────────────────────────┤
│ Thiết bị │ Req   │ OK    │ Lỗi │ Timeout │ CRC │ Exc │ Liên tiếp │ Poll ms │
│ MTR-01   │ 42 100│ 42 088│  12 │      12 │   0 │   0 │        0  │ 21 / 63 │
│ VFD-03   │ 42 100│ 41 900│ 200 │     180 │  18 │   2 │        3  │ 24 / 310│
│ PM-07    │  8 400│      0│8 400│    8 400│   0 │   0 │      412  │ — / —   │
│                                                     (Poll ms = last / max) │
├────────────────────────────────────────────────────────────────────────────┤
│ Chi tiết VFD-03                                                            │
│ Lần thành công gần nhất  10:38:55 (2 phút trước)                           │
│ Reconnect                4 lần · lần cuối 10:39:10                         │
│ Exception code           02 ILLEGAL_DATA_ADDRESS ×2                        │
│ Point lỗi                AHU1.Speed (DECODE_ERROR ×2)                      │
└────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Field bắt buộc

Request count, success/failure count, timeout, CRC error, exception code (kèm tên),
last successful communication, poll duration (last/max), reconnect count,
consecutive errors, scheduler overrun, bus utilization ước tính, `producer_boot_id`
và mốc bắt đầu đếm.

`producer_boot_id` + mốc bắt đầu là bắt buộc: nếu không có, người đọc không biết
counter đã bị reset do restart hay không, và mọi so sánh đều sai.

### 6.3 State

| State | Thể hiện |
|---|---|
| Loading | skeleton bảng |
| Empty | "Chưa có thiết bị nào được cấu hình." |
| Error | banner + `Thử lại` |
| Offline | toàn bộ số → `unknown`, banner `iobus chưa publish telemetry Modbus RTU`; **không** hiển thị 0 |

### 6.4 Acceptance criteria

- AC-E1: telemetry vắng ⇒ mọi ô là `unknown`, không phải `0`.
- AC-E2: counter luôn kèm `boot id` và thời điểm bắt đầu đếm.
- AC-E3: exception code hiện cả số và tên chuẩn.
- AC-E4: `Poll ms` phân biệt rõ last và max, không gộp một số.
- AC-E5: `Xuất CSV` chứa đúng số liệu đang hiển thị và mốc thời gian.

---

## 7. Ma trận quyền theo hành động

| Hành động | Viewer | Operator | Engineer | Admin |
|---|:--:|:--:|:--:|:--:|
| Xem Overview/Devices/Points/Mapping/Diagnostics | ✔ | ✔ | ✔ | ✔ |
| Test kết nối | ✖ | ✔ | ✔ | ✔ |
| Đọc thử register | ✖ | ✔ | ✔ | ✔ |
| Thêm/sửa/xoá Device, Point | ✖ | ✖ | ✔ | ✔ |
| Enable/Disable | ✖ | ✖ | ✔ | ✔ |
| Import/Export | ✖ | ✖ | ✔ | ✔ |
| Apply/Rollback cấu hình | ✖ | ✖ | ✔ | ✔ |
| Ghi thử register | ✖ | ✖ | ✖ | ✔ |

UI **ẩn hoặc disable** control ngoài quyền và luôn kèm lý do; server vẫn là nơi
quyết định cuối. FE không được nới lỏng hơn server (ADR-021).

## 8. Accessibility và responsive

- Mọi input có `<label>` liên kết hoặc `aria-label` mô tả đủ nghĩa (không phải chỉ "Baud").
- Trạng thái không chỉ dùng màu: luôn kèm ký hiệu (●◐○⊘▲) và text.
- Bảng có `<caption>` và scope header; hàng hai dòng dùng `aria-describedby`.
- Hộp thoại ghi/xoá là modal có focus trap, `Esc` huỷ, nút nguy hiểm không phải nút mặc định.
- Breakpoint < 768 px: bảng chuyển card list, giữ đủ Tag/Register/Value/Quality.
- Số liệu dùng định dạng locale theo ngôn ngữ đang chọn (VI dùng dấu phẩy thập phân).

## 9. Gap so với FE hiện tại

| ID | Thiết kế | FE As-Built | Mức |
|---|---|---|---|
| G-UX-01 | 5 page, Viewer đọc được | 1 page, route min-role `admin` | P0 |
| G-UX-02 | Candidate/Apply tách bạch | mỗi CRUD tự apply + restart iobus | P0 |
| G-UX-03 | Overview + bus card | không có | P1 |
| G-UX-04 | Mapping page với chặn lưu khi lỗi | không có | P1 |
| G-UX-05 | Test connection / read test / write test | không có | P0 |
| G-UX-06 | Import/Export CSV/JSON | không có | P1 |
| G-UX-07 | Loading/empty/error/offline riêng cho từng vùng | chỉ một dòng `status` chung | P1 |
| G-UX-08 | Quality từ authority, 5 trạng thái | bảng diagnostics suy diễn `online ? GOOD : consecutive_errors ? OFFLINE : STALE` | P0 |
| G-UX-09 | Xác nhận trước khi xoá | `Xoá` gọi API ngay, không xác nhận | P0 |
| G-UX-10 | Address kèm nhãn zero-based | hiện `@{address}` không có convention | P2 |

## Revision history

| Phiên bản | Ngày | Trạng thái | Thay đổi |
|---|---|---|---|
| 0.1 | 2026-08-04 | In Review | Tạo UI/UX spec 5 page, wireframe, validation, state, quyền và gap FE |
