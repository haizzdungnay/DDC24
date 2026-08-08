# Hồ sơ đầu vào cho thiết kế lại UX — MK-DDC-24

**Mã:** UX-INPUT-001
**Ngày:** 2026-08-08
**Người nhận:** đội thiết kế UX
**Nguồn dữ liệu:** đọc trực tiếp từ source tại commit `18bd295` (nhánh `main`), không trích lại tài liệu cũ.

---

## 0. Đọc gì trước — 3 điều dễ hiểu sai

1. **Đây không phải controller HVAC.** Định vị sản phẩm là *BMS Edge Automation Controller* đa domain, HVAC chỉ là use case đầu tiên. Thiết kế UX **không được đóng cứng theo AHU/FCU**.
2. **Chỉ có 3 role, không phải 4.** Backend chỉ biết `viewer` / `operator` / `admin`. Không có "Technician" và "Engineer" như câu hỏi giả định.
3. **`contracts/openapi/openapi.yaml` KHÔNG phải as-built.** Một số endpoint có trong spec nhưng **chưa được cài trong backend Go** (OTA, tải log, danh sách object BACnet, graph validate/deploy). Chi tiết ở §7.3. Đừng thiết kế màn hình cho chúng như thể đã có.

---

## 1. DDC-24 dùng cho hệ nào?

**Trả lời: programmable generic DDC, không phải controller theo thiết bị.**

Triết lý engineering ghi trong `docs/01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md` §7:

> Không "chọn AHU template → bị khóa theo AHU". Thay vào đó: Component mẫu + User custom component (composite) → Wiresheet/Canvas → Validator → Deploy graph.json → Runtime.

### Application domains chính thức (§3 cùng tài liệu)

| Domain | Ví dụ ứng dụng |
|---|---|
| **HVAC** | AHU, FCU, fan, pump, valve, damper |
| **Pump / Water** | tank level, áp suất, duty/standby pump, dry-run protection |
| **Lighting** | zone control, schedule, occupancy input |
| **Energy** | đọc meter, threshold alarm, peak/load monitor, pulse counting |
| **Environment** | nhiệt độ, độ ẩm, CO2, PM2.5, áp suất |
| **Alarm / Interlock** | fire/door contact, equipment trip, shutdown/interlock logic |
| **Gateway** | bridge Modbus RTU/TCP → BACnet/IP cho BMS |
| **Data acquisition** | local IO → BMS/API |

### Không phải là gì

| LÀ | KHÔNG phải |
|---|---|
| BMS Edge Automation Controller | HVAC-only controller |
| Component-based local controller (runtime riêng) | I/O module thường |
| Protocol gateway Modbus↔BACnet kiêm controller | Gateway pass-through đơn giản |
| Local-first automation node (chạy khi mất BMS) | Cloud-dependent IoT device |
| Commissioning bằng web/form/JSON | PLC IDE clone / Niagara clone |

### Hệ quả cho UX

- **Không có "AHU dashboard"** dựng sẵn. Dashboard phải là *point-centric* và cho người dùng tự nhóm.
- Chiller **không** nằm trong danh sách domain — không thiết kế màn riêng cho chiller.
- Lighting **có** trong danh sách nhưng thể hiện qua schedule + occupancy input, không phải màn hình lighting riêng.
- Chiếc "áo" cần mặc được cho cả 8 domain ⇒ ưu tiên **tag/nhóm do người dùng đặt** hơn là taxonomy cứng của nhà sản xuất.

---

## 2. User roles và quyền

### 2.1 Thang quyền — chỉ 3 bậc

Nguồn: `apps/web-api/internal/app/auth.go` (`roleRank`), mirror ở `apps/web-ui/src/features/auth/roles.ts`.

```
viewer (1)  <  operator (2)  <  admin (3)
```

Quyền là **thang bậc cộng dồn**, không phải ma trận rời rạc: `admin` làm được mọi thứ `operator` làm được, `operator` làm được mọi thứ `viewer` làm được.

Frontend chỉ gate **để người dùng không đi vào trang mà mọi nút đều 403** — hàng rào thật nằm ở server. Ghi rõ trong `roles.ts:8-10`.

### 2.2 Ma trận quyền theo hành động

| Hành động | viewer | operator | admin |
|---|:---:|:---:|:---:|
| Xem point / alarm / trend / schedule / trạng thái hệ thống | ✅ | ✅ | ✅ |
| Xem cấu hình mạng, trạng thái NTP | ✅ | ✅ | ✅ |
| Xem Modbus RTU (bus/device/point/diagnostics/mapping/export) | ✅ | ✅ | ✅ |
| Đổi mật khẩu của chính mình | ✅ | ✅ | ✅ |
| Mô phỏng schedule (`simulate`) | ✅ | ✅ | ✅ |
| **Ghi giá trị point (force/override)** | ❌ | ✅ | ✅ |
| **Ack / Suppress / Return alarm** | ❌ | ✅ | ✅ |
| **Commissioning test một point** | ❌ | ✅ | ✅ |
| **Enable / Disable schedule** | ❌ | ✅ | ✅ |
| **Test connection / read-test thiết bị Modbus** | ❌ | ✅ | ✅ |
| Sửa metadata point (tag/tên) | ❌ | ❌ | ✅ |
| Tạo/sửa/xoá Virtual Point | ❌ | ❌ | ✅ |
| Cấu hình I/O, safe-state, BACnet, fieldbus | ❌ | ❌ | ✅ |
| Cấu hình alarm settings | ❌ | ❌ | ✅ |
| Tạo/sửa/xoá/publish/rollback schedule | ❌ | ❌ | ✅ |
| Đổi cấu hình mạng, thời gian, thiết bị | ❌ | ❌ | ✅ |
| Quản lý user (tạo/sửa/xoá/reset password) | ❌ | ❌ | ✅ |
| Cấu hình historian policy (`PUT /trends/config`) | ❌ | ❌ | ✅ |
| Apply cấu hình Modbus, import config, write-test | ❌ | ❌ | ✅ |

### 2.3 Ma trận route ↔ quyền tối thiểu (as-built)

Nguồn: `apps/web-ui/src/features/auth/roles.ts:51-69`.

| Route | Tối thiểu |
|---|---|
| `/`, `/monitor`, `/alarms`, `/alarms/history`, `/trends`, `/me`, `/help`, `/eng/diagram`, `/eng/aux`, `/settings/display`, `/settings/network` | `viewer` |
| `/eng/modbus-rtu` (mọi tab) | `viewer` |
| `/eng/commissioning`, `/eng/outputs` | `operator` |
| `/eng/inputs`, `/eng/virtual-points`, `/eng/alarm-settings`, `/eng/scheduler`, `/eng/user-parameters`, `/settings/time`, `/settings/device`, `/settings/users` | `admin` |

Hai quyết định đáng chú ý, đừng đảo ngược khi thiết kế lại:

- **`/monitor` cố ý để `viewer`.** Chặn cả trang sẽ lấy mất khả năng quan sát của ca trực chỉ-đọc. Nút ép giá trị *bên trong* trang mới cần `operator` và được khoá riêng ở đó.
- **`/eng/modbus-rtu` để `viewer`** theo quyết định PM/CTO Đ-04 (2026-08-04): người vận hành phải giám sát được Modbus. Các control đổi cấu hình bị `disable` trong trang cho role không phải admin.

### 2.4 Gợi ý mapping sang ngôn ngữ của bạn

Nếu bạn muốn dùng Operator/Technician/Engineer/Admin trong bản thiết kế, đây là ánh xạ khả dĩ **mà không cần đổi backend**:

| Tên bạn dùng | Role thật | Ghi chú |
|---|---|---|
| Operator (ca trực) | `viewer` | chỉ xem |
| Technician | `operator` | force point, ack alarm, commissioning |
| Engineer | `admin` | cấu hình I/O, VP, schedule, alarm |
| Admin (IT) | `admin` | trùng Engineer — backend không tách |

**Nếu bạn thật sự cần 4 role tách bạch thì đó là thay đổi backend**, không phải thay đổi UX. Cần quyết định trước khi vẽ.

---

## 3. I/O thực tế

### 3.1 Số kênh vật lý — Rev A

Nguồn chân lý: `contracts/shm/mkddc_shm.h:67-74`.

```c
#define KX_N_UI   16   /* 16 Universal Input analog (ADR-010) */
#define KX_N_DI   8    /* RESERVED: DI là SKU tuỳ chọn; base SKU luôn = 0 trong SHM */
#define KX_N_AO   4
#define KX_N_DO   4
```

| Loại | Số kênh | Ghi chú |
|---|---:|---|
| **UI** (Universal Input) | **16** | analog đa năng, cấu hình được từng kênh |
| **AO** (Analog Output) | **4** | qua DAC8554 |
| **DO** (Digital Output) | **4** | relay dry-contact |
| **DI** riêng | **0 trên base SKU** | ⚠️ xem cảnh báo dưới |

> ⚠️ **ADR-010 — đừng vẽ 8 DI vào UI.** Rev A base SKU **không lắp 8 DI công nghiệp riêng**. Dry-contact của UI là *chế độ phụ trợ, không cách ly*. Ứng dụng cần DI công nghiệp phải dùng module/SKU isolated-DI tuỳ chọn, và chỉ được hiển thị khi `BOARD_CAP_MAP` báo capability tương ứng. Slot `KX_N_DI = 8` trong SHM là chỗ dành sẵn, không phải phần cứng đang có.

### 3.2 Signal type của UI — 9 chế độ

Nguồn: `apps/web-ui/src/shared/i18n.tsx:128-136` + `apps/web-ui/src/shared/types.ts:961-968`.

| Mã | Nhãn hiển thị | Nhóm |
|---:|---|---|
| 0 | Không hoạt động | disabled |
| 1 | 0–10 V | analog |
| 2 | 2–10 V **hoặc** 4–20 mA (chọn bằng cờ `analogCurrent`) | analog |
| 3 | NTC | analog |
| 4 | Tiếp điểm hở trực tiếp | digital contact |
| 5 | Tiếp điểm hở đảo | digital contact |
| 6 | Ngõ vào biến trở | analog |
| 7 | Điều khiển ánh sáng / phát hiện chuyển động | analog |
| 8 | Ngõ vào đếm xung | analog |

Signal type 2 là loại **duy nhất** có sub-mode (Volt vs Dòng) ⇒ form phải hiện thêm một field khi và chỉ khi chọn type 2. Signal type 0 khoá `unit` và `mathFunction` về 0.

Ngoài ra có **range multiplier** 6 mức (x1, x10, x100, và 3 biến thể căn bậc hai) quyết định dải cảm biến −50…205 / −500…2050 / −5000…20500.

### 3.3 AO

- 4 kênh, mode `0 = 0–10 V`, `1 = 4–20 mA` (`ao_mode[]` trong SHM).
- **Chủ sở hữu ghi khác nhau**: `ao_setpoint[]` và `do_cmd[]` do **core** ghi; `ao_mode[]` do **iobus** ghi sau khi ACK `SET_AO_CFG`. UI không ghi thẳng SHM.
- Giá trị mặc định an toàn: 0 V / 4 mA.

### 3.4 Point ảo và point ngoại vi

| Loại | Sức chứa | Nguồn |
|---|---:|---|
| **Virtual Point (VP)** | **464** tổng | `apps/web-api/internal/app/virtualpoint.go:20` |
| VP không log | ≤ 256 | `:21` |
| VP log 1000 ms | ≤ 128 | `:22` |
| VP log 100 ms | ≤ 64 | `:23` |
| VP log 10 ms | ≤ 16 (kênh chẩn đoán, không vĩnh viễn) | `:24` |
| **Modbus RTU Point (EXT)** | **256** | `KX_N_EXT`, `modbusrtu/validate.go:89` |
| Modbus slave publish được | 32 | `KX_N_FB_SLAVE` |
| Bus RS-485 publish được | 4 (Rev A dùng **1**) | `KX_N_FB_BUS` |

Ngoài ra SHM còn: `KX_N_AV = 32` (Analog Value), `KX_N_BV = 16` (Binary Value), `KX_N_MSV = 8` (Multi-State Value) — đây là object BACnet, không phải kênh vật lý.

**VP signal type:** `boolean | integer | float | string | datetime`. VP kiểu `string`/`datetime` **không log được**.

### 3.5 Chất lượng và độ tin cậy của giá trị — quan trọng cho UI

Đây là thứ hay bị bỏ sót trong thiết kế nhưng có thật trong dữ liệu:

- **Quality (5 mức xuất hiện trong API):** `good | uncertain | bad | stale | offline`
- **Reliability per-channel:** enum BACnet, ví dụ `COMMUNICATION_FAILURE (6)`
- **Cờ trạng thái point:** `fault: bool`, `forced: bool`, `writable: bool`, `online: bool`
- **Riêng Modbus point còn có:** `quality_reason`, `bus_id`, `slave_addr`, `exception_code`

> **Luật D-07 của dự án: FE hiển thị nguyên văn producer, hiện `unknown` khi thiếu, TUYỆT ĐỐI không suy diễn.** Đã từng có finding vì FE bịa dữ liệu simulator ở chế độ live. Thiết kế phải có **state hiển thị cho "không biết"**, không được mặc định về 0 hay "OK".

### 3.6 Mỗi UI point còn mang cả giá trị raw

`ui_value[]` (đã scale, đơn vị kỹ thuật: °C, %) **và** `ui_raw[]` (điện áp/dòng thô trước scale) + `ui_unit[]`, `ui_raw_unit[]`. Màn commissioning và chẩn đoán cần cả hai — thiết kế nên có chỗ cho cặp giá trị này.

---

## 4. Protocol thực sự support

### 4.1 Hiện trạng

| Protocol | Trạng thái | Bằng chứng |
|---|---|---|
| **Ethernet / IPv4** | ✅ có, có transaction 5 bước | `apps/netcfg/`, `POST /network/transaction/{action}` |
| **Modbus RTU master (RS-485)** | ✅ có, đầy đủ nhất | `apps/iobus/adapters/modbus_rtu/`, 44 endpoint `/modbus/*` |
| **Modbus TCP client** | ✅ có trong iobus | `modbus_tcp.cpp/hpp`, gọi ở `bootstrap/main.cpp:372,505` |
| **BACnet/IP server** | ⚠️ có code, **feature-gated OFF mặc định** | `apps/iobus/CMakeLists.txt:24` — `option(MKDDC_ENABLE_BACNET … OFF)` |
| **HMI cục bộ (LVGL/DRM)** | ⚠️ feature-gated | `apps/hmi/`, `MKDDC_ENABLE_HMI` mặc định OFF |
| **BACnet MS/TP** | ❌ **không có** | không có adapter; các tham chiếu ARCH-R010 MS/TP trong docs là stale |
| **RS-485 cổng thứ 2** | ❌ **không có ở Rev A** | quyết định Đ-01 (2026-08-04) |

### 4.2 Số cổng RS-485 — điểm đã chốt, đừng vẽ 2 cổng

Baseline cũ ghi `2 × Modbus RTU`. Khảo sát board production Foxlinx ngày 2026-08-04 xác nhận **chỉ còn một UART rảnh** sau khi `ttyS2` dành cho MCU.

> **Quyết định PM/CTO (Đ-01): Rev A dùng 01 cổng Modbus RTU.** Cổng thứ hai chỉ mở khi phần cứng xác nhận có transceiver và đường đấu nối thực tế.

Tài liệu `PRODUCT_DEFINITION` §4 vẫn còn câu "RS485-1, RS485-2" — **đó là chỗ stale, không phải as-built**. `PRODUCT.md` mới hơn và đúng.

**Còn mở (Đ-02):** cơ chế điều khiển hướng truyền RS-485 (tự động hay GPIO) chưa được phần cứng xác nhận.

### 4.3 Tham số bus — thuộc DÂY, không thuộc thiết bị

Ghi rõ trong `openapi.yaml:2231-2235`:

> Tham số serial thuộc về **DÂY**, không thuộc thiết bị: hai thiết bị trên cùng dây không thể chạy hai baud khác nhau, nên để baud ở Device là mời người dùng lưu một cấu hình không thể thực thi.

Model dữ liệu: `Bus (port, baud, parity, stop_bits, enabled)` → `Device (addr, poll_ms, enabled)` → `Point (register, data_type, scale…)`. **UX phải phản ánh cây 3 tầng này**, không được cho đặt baud ở tầng device.

Kiểu dữ liệu point Modbus: `bool | int16 | uint16 | int32 | uint32 | float32`.

### 4.4 Trạng thái bus có sẵn để hiển thị

`state` là **chuỗi ngắn**, không phải enum số: `CLOSED | OPENING | RUNNING | PORT_ERROR | DRAINING | SWAPPING | CONFIG_ERROR`.

Metric thật đo bởi BusWorker (`kx_bus_metrics_t`): `total_transactions`, `total_errors`, `port_reopens`, `latency_p50_us`, `latency_p95_us`, `latency_max_us`, `utilization_pct_x100`.

> Lưu ý lịch sử: trước đây trang Overview lấy p50/p95/utilization từ **hằng số viết cứng** trong handler Go — giao diện hiển thị số không do thiết bị nào sinh ra. Đã sửa (MBR-B305). Đừng thiết kế widget nào mà không có nguồn số thật đằng sau.

Metric slave (`kx_slave_metrics_t`): `last_seen_ms`, `total_polls`, `total_errors`, `online`, `bus_id`, `addr`.

---

## 5. Alarm model

### 5.1 Severity — **5 cấp**, không phải 3 và không phải 4

Nguồn: `apps/web-api/internal/app/dto.go:358` + `openapi.yaml`.

```
critical | high | medium | low | info
```

### 5.2 Priority khi cấu hình — 5 giá trị

Nguồn: `alarmsettingsapi.go:123`.

```
low | medium | high | critical | flexible
```

`flexible` **bắt buộc** phải kèm ít nhất một `severityRule` (`{severity, op, value}`, op ∈ tập `validSeverityRuleOps`) — nghĩa là severity được suy ra từ độ lớn vi phạm chứ không cố định. Đây là tính năng đáng khai thác trong UX: một alarm "nhiệt độ cao" có thể là `medium` ở 28 °C và `critical` ở 35 °C.

### 5.3 Trạng thái vòng đời alarm

```
active | unack | acked | shelved
```

Cộng thêm cờ `active: bool` và `returnable: bool` để UI biết nút "Return" có bật được không.

### 5.4 Alarm type — 8 loại, chỉ 3 loại đang chạy

Nguồn: `dto.go:168-175` + `alarmsettingsapi.go:226-229`.

| Mã | Loại | Trạng thái |
|---:|---|---|
| 0 | Disabled | ✅ |
| 1 | High/Low Input (HH/H/L/LL + hysteresis) | ✅ **đang dùng** |
| 2 | Setpoint Deviation | ⛔ **deferred** — phải `enabled=false` |
| 3 | Runtime Hours | ✅ |
| 4 | Fan State | ⛔ deferred |
| 5 | Digital Output | ⛔ deferred |
| 6 | Analog Output | ⛔ deferred |
| 7 | PI Sequence | ⛔ deferred |

Backend **từ chối** lưu nếu bật một loại deferred: `"alarm type %d not yet supported; must be disabled"`.

> UX phải hiển thị 5 loại này là **"sắp có"** một cách trung thực, hoặc ẩn hẳn. Không được để người dùng chọn rồi ăn lỗi validate.

### 5.5 Tham số ngưỡng

`hh`, `h`, `l`, `ll`, `hysteresis`, `runtimeHours`, `delayS`, `clearMode`, `publishBacnet`, `notificationClass`.

Một alarm setting có thể có **nhiều `sources`** (mảng `{channel, pointId}`) — không phải quan hệ 1:1 với point.

### 5.6 Ba hành động trên alarm (đều `operator`+)

| Hành động | Endpoint | Ngữ nghĩa |
|---|---|---|
| **Ack** | `POST /alarms/{id}/ack` | Nếu đang active → `acked` cho tới khi clear. Nếu đã clear nhưng latched unack → **biến mất khỏi danh sách**. Body tuỳ chọn `{durationS}` cho ack **hết hạn**; không body = ack vĩnh viễn (hành vi cũ). |
| **Suppress** | `POST /alarms/{id}/suppress` | Ẩn alarm active/latched trong khoảng thời gian chọn, hoặc vĩnh viễn tới khi core restart. Body **bắt buộc**: `{durationS}` hoặc `{permanent: true}`. Đây là nút "Off" trong Alarm log. |
| **Return** | `POST /alarms/{id}/return` | Undo ack khi điều kiện alarm **vẫn còn đúng**. Id đã clear hoặc đang active trả 404. |

### 5.7 Alarm history — lưu bền, có filter

`GET /alarm-history`, đọc JSONL trên thiết bị. Filter AND với nhau, giá trị phân cách phẩy được OR:

- `event`: `started, acked, returned, ended, setting_created, setting_changed, setting_deleted`
- `severity`, `status`, `from`, `to`, `text`, `alarm`, `name`, `limit` (`limit=all` lấy hết)

Bản ghi thay đổi cấu hình mang cả `before` và `after` (full `AlarmSetting`) ⇒ **UI có đủ dữ liệu để làm diff view**.

---

## 6. Các action được phép trên UI

### 6.1 Điều khiển point — quan trọng nhất, và có một ràng buộc cứng

**Endpoint:** `PUT /points/{id}` — role `operator`+

```json
{ "value": 23.5, "release": false }
```

> **Contract Freeze 2026-06-11: REST KHÔNG expose BACnet priority 1..16.**
> Mọi lệnh từ web đi vào **đúng một mức: "Local manual" (mức 2)**. Client **không được chọn priority**.
> `release: true` = nhả manual override (relinquish mức 2).

**Sáu mức priority của core** (`PRODUCT_DEFINITION` §13) — hiển thị được, nhưng web chỉ ghi được mức 2:

| Mức | Nguồn | Web ghi được? |
|---:|---|:---:|
| 1 | Fire / Safety | ❌ |
| 2 | **Local manual** | ✅ ← mọi lệnh web |
| 3 | BACnet command | ❌ (qua BACnet/IP) |
| 4 | Schedule | ❌ |
| 5 | Local logic | ❌ |
| 6 | Default | ❌ |

**Hệ quả UX:** không thiết kế priority selector 16 mức kiểu Niagara. Thay vào đó cần:
- một nút **Override** rõ ràng (ghi mức 2),
- một nút **Release** rõ ràng (nhả mức 2),
- và một **chỉ báo "ai đang thắng"** — vì lệnh mức 2 có thể bị mức 1 đè.

Point trả về có `priority: string`, `forced: bool`, `overrideExpiresInS: uint32` ⇒ UI hiển thị được "đang bị ép, còn N giây".

Chỉ VP có `writable: true` mới ghi được qua endpoint này.

### 6.2 Bảng đầy đủ các action

| Nhóm | Action | Endpoint | Role |
|---|---|---|:---:|
| **Point** | Force/Override giá trị | `PUT /points/{id}` | operator |
| | Release override | `PUT /points/{id}` + `release=true` | operator |
| | Sửa tag/tên hiển thị | `PUT /points/{id}/config` | admin |
| | Bật/tắt logging từng point | `PUT /trends/config` | admin |
| **Alarm** | Ack (có thể kèm thời hạn) | `POST /alarms/{id}/ack` | operator |
| | Suppress (thời hạn / vĩnh viễn) | `POST /alarms/{id}/suppress` | operator |
| | Return (undo ack) | `POST /alarms/{id}/return` | operator |
| | Sửa cấu hình alarm | `PUT /alarm-settings` | admin |
| **Commissioning** | Test một point DO/AO | `POST /commissioning/points/{id}/test` | operator |
| **Schedule** | Enable / Disable | `POST /schedules/{id}/enable`\|`disable` | operator |
| | Simulate (dry-run) | `POST /schedules/{id}/simulate` | **viewer** |
| | Validate | `POST /schedules/{id}/validate` | admin |
| | Publish | `POST /schedules/{id}/publish` | admin |
| | Rollback về revision cũ | `POST /schedules/{id}/rollback` | admin |
| | Tạo/sửa/xoá | `POST`/`PUT`/`DELETE /schedules[/{id}]` | admin |
| **Modbus** | Test connection thiết bị | `POST /modbus/devices/{id}/test-connection` | operator |
| | Read test (đọc thử thanh ghi) | `POST /modbus/read-test` | operator |
| | Write test | `POST /modbus/write-test` | admin |
| | Bật/tắt thiết bị | `PUT /modbus/devices/{id}/enabled` | admin |
| | Sửa candidate → xem diff → apply | `PUT /modbus/config/candidate` → `GET /modbus/config/diff` → `POST /modbus/config/apply` | admin |
| | Export / Import cấu hình | `GET /modbus/export` / `POST /modbus/import` | viewer / admin |
| **Mạng** | Giao dịch 5 bước | `POST /network/transaction/{validate\|stage\|apply\|confirm\|rollback}` | admin |
| **Hệ thống** | Cấu hình I/O + safe-state nguyên tử | `PUT /system/config/io-bundle` | admin |
| | Cấu hình thiết bị / thời gian / BACnet / fieldbus | `PUT /system/config/*` | admin |
| **User** | Tạo/sửa/xoá/reset password | `/users*` | admin |
| | Đổi mật khẩu của mình | `POST /me/change-password` | viewer |
| **Trend** | Export CSV | `GET /history/export.csv` | viewer |

### 6.3 ❌ KHÔNG có (đừng thiết kế)

| Action bạn hỏi | Trạng thái |
|---|---|
| **Restart service** | ❌ **không có endpoint nào**. Chỉ có ghi chú nội bộ trong `config.go:51` về "phương án restart service có gián đoạn I/O" — không expose ra API. |
| **Reboot thiết bị** | ❌ không có endpoint. `POST /ota/apply` (đáng lẽ reboot) chỉ có trong spec, **chưa cài**. |
| **Upload firmware / OTA** | ❌ có trong `openapi.yaml` (`/ota/upload`, `/ota/apply`, `/ota/status`) nhưng **không tồn tại trong code Go**. |
| **Tải log** | ❌ `/logs/download` có trong spec, **chưa cài**. |
| **Force AO với priority tự chọn** | ❌ bị Contract Freeze cấm (§6.1). |

### 6.4 Giao dịch mạng — pattern 5 bước, đáng học

Đây là pattern an toàn nhất trong hệ thống và **nên nhân rộng ra UX các phần khác**:

```
validate → stage → apply → confirm → rollback
```

- `validate`/`stage` cần **candidate**; `apply`/`confirm`/`rollback` cần **transactionId**.
- Response `rejected` vẫn trả **HTTP 200** kèm `reasonCode` + `state` authoritative ⇒ UI phải đọc body, không chỉ status code.
- Lỗi adapter/socket trả 502/503.
- Mỗi POST ghi đúng một audit event **không chứa** candidate/DNS/token.
- `confirm` là chốt an toàn: đổi IP mà không confirm kịp → tự rollback (tránh tự khoá mình ra khỏi thiết bị).

Modbus dùng pattern tương tự nhẹ hơn: `candidate → diff → apply`.

---

## 7. BE/API hiện có

### 7.1 Tổng quan

- **Ngôn ngữ:** Go (`apps/web-api`)
- **Số route đăng ký:** **99** (`apps/web-api/internal/app/http.go`)
- **Base path:** `/api/v1`
- **Public (không auth):** `GET /health`, `GET /api/v1/health`, `POST /api/v1/auth/login`
- **Realtime:** `GET /api/v1/ws/monitor` (WebSocket, auth riêng qua `requireWSAuth`)
- **Spec:** `contracts/openapi/openapi.yaml` (141 KB) — ⚠️ **không đồng bộ 100% với code**, xem §7.3.

### 7.2 WebSocket monitor — kênh realtime chính

`GET /api/v1/ws/monitor`

- Client gửi subscribe: `{ all: true }` hoặc `{ ids: ["UI-01", "AO-02", ...] }`
- Server đẩy `{ points: PointDTO[], fingerprint }`
- Có **fingerprint** để bỏ qua frame không đổi ⇒ **thiết kế UI nên tận dụng: không animate lại khi fingerprint không đổi.**

### 7.3 ⚠️ Endpoint có trong spec nhưng CHƯA CÀI

Đã kiểm bằng grep toàn bộ `apps/web-api/internal/` (loại trừ file test):

| Endpoint trong `openapi.yaml` | Có trong code Go? |
|---|:---:|
| `POST /ota/upload` | ❌ |
| `POST /ota/apply` | ❌ |
| `GET /ota/status` | ❌ |
| `GET /logs/download` | ❌ |
| `GET /bacnet/objects` | ❌ |
| `POST /graph/validate` | ❌ |
| `POST /graph/deploy` | ❌ |

**Đây là nguồn hiểu sai lớn nhất nếu bạn thiết kế từ openapi.yaml.** Danh sách 99 route ở §7.5 mới là as-built.

### 7.4 Cấu trúc `PointDTO` — object trung tâm của mọi màn hình

```jsonc
{
  "id": "UI-01",                       // canonical, ổn định
  "tag": "AHU1_SAT",                   // technical tag do người dùng đặt
  "name": "Room temperature",          // display name, ≤64 ký tự, unique trong namespace
  "kind": "UI",                        // UI | AO | DO | virtual | modbus_rtu
  "value": 23.5,
  "unit": "°C",
  "raw": 4.7,                          // giá trị điện thô trước scale
  "rawUnit": "V",
  "quality": "good",                   // good|uncertain|bad|stale|offline
  "source": "local_physical_io",       // local_physical_io | virtual_point | modbus_rtu
  "priority": "local_manual",
  "overrideExpiresInS": 300,
  "updatedAt": "2026-08-08T09:15:30Z",
  "fault": false,
  "forced": true,
  "signalType": "float",
  "writable": true,
  "logEnabled": true,
  "logIntervalMs": 1000,               // 1000 | 100 | 10

  // Alias tương thích — cùng dữ liệu, tên khác
  "point_id": "UI-01",
  "tag_name": "AHU1_SAT",
  "display_name": "Room temperature",
  "data_type": "float",
  "timestamp": "2026-08-08T09:15:30Z",
  "read_write": "read_write",          // read | read_write
  "default_value": 0,
  "safe_value": 0,

  // Chỉ có với point Modbus RTU
  "quality_reason": "timeout",
  "bus_id": 1,
  "slave_addr": 12,
  "exception_code": 0,
  "online": true
}
```

> Lưu ý: DTO có **cặp trường trùng nghĩa** (`id`/`point_id`, `tag`/`tag_name`, `name`/`display_name`, `updatedAt`/`timestamp`). Đây là nợ tương thích, không phải hai khái niệm khác nhau. Đừng hiển thị cả hai.

### 7.5 Danh sách đầy đủ 99 route (as-built)

<details>
<summary>Bấm để mở</summary>

```
GET    /health                                              (public)
GET    /api/v1/health                                       (public)
POST   /api/v1/auth/login                                   (public)
POST   /api/v1/auth/logout                                  viewer
GET    /api/v1/ws/monitor                                   (WS auth riêng)

GET    /api/v1/system/status                                viewer
GET    /api/v1/me                                           viewer
POST   /api/v1/me/change-password                           viewer

GET    /api/v1/points                                       viewer
GET    /api/v1/points/{id}                                  viewer
PUT    /api/v1/points/{id}                                  operator   ← force/release
PUT    /api/v1/points/{id}/config                           admin
GET    /api/v1/virtual-points                               viewer
POST   /api/v1/virtual-points                               admin
PUT    /api/v1/virtual-points/{id}                          admin
DELETE /api/v1/virtual-points/{id}                          admin

GET    /api/v1/alarms                                       viewer
GET    /api/v1/alarm-history                                viewer
POST   /api/v1/alarms/{id}/ack                              operator
POST   /api/v1/alarms/{id}/suppress                         operator
POST   /api/v1/alarms/{id}/return                           operator
GET    /api/v1/alarm-settings                               viewer
PUT    /api/v1/alarm-settings                               admin

GET    /api/v1/history                                      viewer
GET    /api/v1/history/export.csv                           viewer
GET    /api/v1/trends/config                                viewer
PUT    /api/v1/trends/config                                admin

GET    /api/v1/schedules                                    viewer
POST   /api/v1/schedules                                    admin
GET    /api/v1/schedules/{id}                               viewer
PUT    /api/v1/schedules/{id}                               admin
DELETE /api/v1/schedules/{id}                               admin
POST   /api/v1/schedules/{id}/validate                      admin
POST   /api/v1/schedules/{id}/simulate                      viewer
POST   /api/v1/schedules/{id}/publish                       admin
POST   /api/v1/schedules/{id}/enable                        operator
POST   /api/v1/schedules/{id}/disable                       operator
GET    /api/v1/schedules/{id}/revisions                     viewer
POST   /api/v1/schedules/{id}/rollback                      admin
GET    /api/v1/schedules/{id}/runtime                       viewer
GET    /api/v1/schedules/{id}/audit                         viewer

POST   /api/v1/commissioning/points/{id}/test               operator

GET    /api/v1/modbus/devices                               viewer
POST   /api/v1/modbus/devices                               admin
PUT    /api/v1/modbus/devices/{id}                          admin
DELETE /api/v1/modbus/devices/{id}                          admin
PUT    /api/v1/modbus/devices/{id}/enabled                  admin
POST   /api/v1/modbus/devices/{id}/test-connection          operator
GET    /api/v1/modbus/points                                viewer
POST   /api/v1/modbus/points                                admin
PUT    /api/v1/modbus/points/{id}                           admin
DELETE /api/v1/modbus/points/{id}                           admin
GET    /api/v1/modbus/buses                                 viewer
PUT    /api/v1/modbus/buses/{bus_id}                        admin
GET    /api/v1/modbus/ports                                 viewer
GET    /api/v1/modbus/overview                              viewer
GET    /api/v1/modbus/diagnostics                           viewer
GET    /api/v1/modbus/events                                viewer
GET    /api/v1/modbus/mapping                               viewer
GET    /api/v1/modbus/config/state                          viewer
GET    /api/v1/modbus/config/candidate                      viewer
PUT    /api/v1/modbus/config/candidate                      admin
DELETE /api/v1/modbus/config/candidate                      admin
GET    /api/v1/modbus/config/diff                           viewer
POST   /api/v1/modbus/config/apply                          admin
GET    /api/v1/modbus/export                                viewer
POST   /api/v1/modbus/import                                admin
POST   /api/v1/modbus/read-test                             operator
POST   /api/v1/modbus/write-test                            admin

GET    /api/v1/network                                      viewer
PUT    /api/v1/network                                      admin
GET    /api/v1/network/transaction                          viewer
POST   /api/v1/network/transaction/{action}                 admin

GET/PUT /api/v1/system/config                               admin
GET/PUT /api/v1/system/config/device                        admin
GET/PUT /api/v1/system/config/network                       admin
GET/PUT /api/v1/system/config/io                            admin
GET/PUT /api/v1/system/config/safe-state                    admin
GET/PUT /api/v1/system/config/io-bundle                     admin
GET/PUT /api/v1/system/config/virtual-points                admin
GET/PUT /api/v1/system/config/bacnet                        admin
GET/PUT /api/v1/system/config/fieldbus                      admin
GET/PUT /api/v1/system/config/time                          admin
GET    /api/v1/system/time/status                           viewer

GET    /api/v1/users                                        admin
POST   /api/v1/users                                        admin
PUT    /api/v1/users/{username}                             admin
DELETE /api/v1/users/{username}                             admin
POST   /api/v1/users/{username}/reset-password              admin
```

</details>

---

## 8. Danh sách page hiện tại

### 8.1 Cây điều hướng as-built

Nguồn: `apps/web-ui/src/app/App.tsx` + `apps/web-ui/src/shared/components/NavRail.tsx`.

Sidebar chia **3 nhóm**:

```
📊 GIÁM SÁT (viewer)
├── /                       Dashboard
├── /monitor                Monitor           ← danh sách point realtime
├── /alarms                 Alarm log
│   └── /alarms/history     Alarm history
└── /trends                 Trends

⚙️  KỸ THUẬT (Engineering)
├── /eng/scheduler          Scheduler         [admin]
│   ├── (index)             Grid — danh sách schedule
│   ├── /runtime            Runtime
│   └── /:id                Editor
│       └── tabs: Weekly · Exception · Target · Simulate · History
├── /eng/commissioning      Commissioning     [operator]
├── /eng/programming        Programming       ⚠️ gated (xem 8.3)
├── /eng/inputs             Inputs Config     [admin]
├── /eng/outputs            Outputs Config    [operator]
├── /eng/virtual-points     Virtual Points    [admin]
├── /eng/modbus-rtu         Modbus RTU        [viewer]
│   └── tabs: Overview · Ports · Devices · Points · Mapping · Diagnostics
├── /eng/alarm-settings     Alarm settings    [admin]
├── /eng/diagram            Controller Diagram
├── /eng/aux                Aux Functions     (ẩn khỏi nav)
└── /eng/user-parameters    User Parameters   [admin] (ẩn khỏi nav)

🔧 CÀI ĐẶT
├── /settings/display       Display
├── /settings/users         Users             [admin]
├── /settings/network       Network
├── /settings/time          Time/Date         [admin]
└── /settings/device        Device            [admin]

Khác
├── /login                  Login (ngoài shell)
├── /me                     User Info
└── /help                   Help
```

**Tổng: ~24 route hiển thị được**, chưa tính tab con. Tính cả tab: **~35 màn hình**.

### 8.2 Redirect tương thích (giữ link cũ)

`/users` → `/settings/users` · `/network` → `/settings/network` · `/scheduler` → `/eng/scheduler` · `/commissioning` → `/eng/commissioning` · `/eng/virtual-io` → `/eng/virtual-points` · `/settings` → `/settings/device` · `*` → `/`

### 8.3 Trang bị gate hoặc ẩn — kiểm trước khi thiết kế

| Trang | Tình trạng |
|---|---|
| `/eng/programming` | Chỉ hiện khi cờ `LEGACY_GRAPH_DEMO_ENABLED` bật; nếu tắt → `UnavailableFeaturePage`. **Program Runtime (ST/FBD) đang ở giai đoạn C0, chưa release.** |
| `/eng/user-parameters` | Đã **comment-out** khỏi NavRail (`NavRail.tsx:45`) |
| `/eng/aux` | Đã **comment-out** khỏi NavRail (`NavRail.tsx:46`) |
| `/validator` | Redirect về `/eng/programming` hoặc `/` |

### 8.4 Screenshot có sẵn

Ảnh chụp trên board thật, tại `apps/web-ui/board-evidence/`:

```
01-admin-dashboard.png        Dashboard, role admin
02-viewer-forbidden.png       Trạng thái 403 với viewer
03-commissioning-confirm.png  Hộp xác nhận trước khi ghi
04-commissioning-written.png  Sau khi ghi thành công
05-theme-dark.png             Dark theme
06-mobile-drawer.png          Drawer trên mobile
07-users.png                  Quản lý user
```

Test E2E chạy trên board: `apps/web-ui/e2e-board/board-page-audit.spec.ts`, `board-ux.spec.ts`.

### 8.5 HMI cục bộ (nếu quan tâm)

Màn LVGL/DRM riêng, feature-gated, 5 screen: `screen_home`, `screen_io`, `screen_alarm`, `screen_control`, `screen_service`. Đây là **surface khác**, không dùng chung design system với web.

---

## 9. Historian / Trends — dữ liệu cho biểu đồ

| Khía cạnh | Chi tiết |
|---|---|
| **Query** | `GET /history?point=UI-01,AO-01&from=…&to=…` — bounds nửa mở `[from, to)` |
| **Số point mỗi query** | 1–8 |
| **maxPoints** | 1–5000, mặc định 5000 |
| **Resolution** | `auto` (chỉ dùng khi query) + 11 mức: `1s, 3s, 5s, 15s, 30s, 1m, 3m, 5m, 15m, 30m, 60m` |
| **Tier** | RAM tail + hot SQLite 48 h + archive. **Backend merge, FE tuyệt đối không tự merge tier.** |
| **`source`** | `cache` (giới hạn 24 h, dùng cho preset) / `database` (bỏ tier RAM, dùng cho Custom range) |
| **Kết quả thiếu** | `complete=false` + mảng `gaps` ⇒ **UI phải vẽ được khoảng trống, không nối liền qua gap** |
| **Policy state** | `off | scheduled | recording` per point |
| **Retention** | 1..max theo interval; lỗi trả `historian_retention_invalid` |
| **Export CSV** | cùng iterator với JSON; header comment `#` mang `from/to/complete/tiersUsed`, gap là dòng `# gap,...` |

Cột CSV: `pointId, generation, time, value, min, max, sum, count, quality, source, tier`.

> `min/max/sum/count` cho thấy dữ liệu **đã được aggregate** ở resolution thô ⇒ biểu đồ nên vẽ được band min–max chứ không chỉ đường trung bình.

---

## 10. Ràng buộc thiết kế bắt buộc tuân thủ

Đây là các luật đã có finding thật trong dự án, không phải khuyến nghị:

1. **D-07 — không bịa dữ liệu.** FE hiển thị nguyên văn producer, hiện `unknown` khi thiếu. Đã có finding `FE-DIAG-01`: `ControllerDiagram` bịa dữ liệu simulator ở chế độ live. Mọi widget phải truy được về một trường dữ liệu thật.
2. **Không hằng số viết cứng thay số đo.** Trang Modbus Overview từng hiển thị p50/p95/utilization từ hằng số trong handler Go (MBR-B305). Số nào không đo được thì hiện "—".
3. **Frontend không được nới lỏng hơn backend.** Gate của FE chỉ để tránh trang toàn nút 403; hàng rào thật ở server.
4. **`index.html` phải `no-cache`.** Đã có sự cố trên board Foxlinx 2026-08-06: người dùng không thấy tab mới vì trình duyệt giữ `index.html` cũ. Asset có hash thì cache 1 năm + `immutable`.
5. **Tiếng Việt là ngôn ngữ chính.** i18n có sẵn 2 locale (`apps/web-ui/src/shared/i18n.tsx`); mọi nhãn phải qua `t()`.
6. **Nút mutation phải `disable` theo role, không phải ẩn trang.** Pattern đã dùng ở Modbus RTU — viewer xem được trang, nút sửa bị khoá.

---

## 11. Tóm tắt cho 4 nhóm quan trọng nhất

| # | Câu hỏi | Trả lời một dòng |
|---|---|---|
| **1** | Hệ nào? | **Programmable generic DDC**, 8 domain, HVAC chỉ là use case đầu tiên. Không template cứng. |
| **2** | Roles? | **3 role thang bậc**: `viewer` < `operator` < `admin`. Không có Technician/Engineer tách riêng. |
| **3** | I/O? | **16 UI** (9 signal type) + **4 AO** (0–10 V / 4–20 mA) + **4 DO** relay. **0 DI** trên base SKU. Cộng 464 VP + 256 Modbus point. |
| **6** | Action? | Force/Release point (**luôn mức 2 Local manual, không chọn priority**), ack/suppress/return alarm, commissioning test, enable/disable schedule, apply cấu hình theo transaction. **Không có** restart service, reboot, OTA. |

---

## 12. Ba câu hỏi ngược lại cần CHƯƠNG chốt trước khi vẽ

1. **4 role hay 3 role?** Nếu bản thiết kế cần Operator/Technician/Engineer/Admin tách bạch thì phải sửa `roleRank` ở backend Go + `ROLE_RANK` ở FE. Đây là thay đổi hợp đồng, không phải thay đổi giao diện.
2. **5 loại alarm deferred (type 2, 4, 5, 6, 7) — ẩn hay hiện "sắp có"?** Backend từ chối lưu nếu bật. Cần chốt cách thể hiện.
3. **`/eng/programming` (ST/FBD) có nằm trong phạm vi thiết kế lại không?** Runtime đang ở giai đoạn C0, chưa release, trang đang bị cờ tắt. Nếu có, thiết kế sẽ chạy trước implementation một quãng dài.

---

*Mọi số liệu trong tài liệu này đọc trực tiếp từ source tại `18bd295`. Khi source đổi, tài liệu này thành stale — kiểm lại `contracts/shm/mkddc_shm.h`, `apps/web-api/internal/app/http.go` và `apps/web-ui/src/app/App.tsx` trước khi tin.*
